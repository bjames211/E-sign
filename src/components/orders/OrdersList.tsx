import React, { useState, useEffect } from 'react';
import { OrderCard } from './OrderCard';
import { OrderDetails } from './OrderDetails';
import { Order, OrderStatus } from '../../types/order';
import { getOrdersPaginated, deleteOrder, cancelOrder } from '../../services/orderService';
import { getChangeOrdersForOrder } from '../../services/changeOrderService';
import { QueryDocumentSnapshot, DocumentData } from 'firebase/firestore';
import { useAuth } from '../../contexts/AuthContext';

const PAGE_SIZE = 50;

const STATUS_FILTERS: { value: OrderStatus | 'all'; label: string }[] = [
  { value: 'all', label: 'All Orders' },
  { value: 'draft', label: 'Drafts' },
  { value: 'pending_payment', label: 'Pending Payment' },
  { value: 'sent_for_signature', label: 'Awaiting Signature' },
  { value: 'signed', label: 'Signed' },
  { value: 'ready_for_manufacturer', label: 'Ready for Manufacturer' },
  { value: 'cancelled', label: 'Cancelled' },
];

interface OrdersListProps {
  onNavigateToChangeOrder?: (orderId: string, changeOrderId?: string) => void;
  initialOrderNumber?: string | null;
  onInitialOrderHandled?: () => void;
}

// Effective values from live change orders
interface EffectiveCOValues {
  deposit: number;
  total: number;
  changeOrderNumber?: string;
}

export function OrdersList({ onNavigateToChangeOrder, initialOrderNumber, onInitialOrderHandled }: OrdersListProps) {
  const { user } = useAuth();
  const [orders, setOrders] = useState<Order[]>([]);
  const [filteredOrders, setFilteredOrders] = useState<Order[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [selectedOrder, setSelectedOrder] = useState<Order | null>(null);
  const [openWithPaymentApproval, setOpenWithPaymentApproval] = useState(false);
  const [statusFilter, setStatusFilter] = useState<OrderStatus | 'all'>('all');
  const [searchTerm, setSearchTerm] = useState('');
  // Map of orderId -> effective CO values for orders with pending_signature COs
  const [effectiveCOValuesMap, setEffectiveCOValuesMap] = useState<Record<string, EffectiveCOValues>>({});
  const [lastDoc, setLastDoc] = useState<QueryDocumentSnapshot<DocumentData> | null>(null);
  const [hasMore, setHasMore] = useState(false);
  const [totalCount, setTotalCount] = useState(0);
  const [loadingMore, setLoadingMore] = useState(false);

  useEffect(() => {
    loadOrders();
  }, []);

  useEffect(() => {
    filterOrders();
  }, [orders, statusFilter, searchTerm]);

  // Auto-select order from URL parameter
  useEffect(() => {
    if (initialOrderNumber && orders.length > 0 && !selectedOrder) {
      const order = orders.find(o => o.orderNumber === initialOrderNumber);
      if (order) {
        setSelectedOrder(order);
        onInitialOrderHandled?.();
      }
    }
  }, [initialOrderNumber, orders, selectedOrder, onInitialOrderHandled]);

  const loadOrders = async () => {
    setLoading(true);
    setError(null);
    try {
      const result = await getOrdersPaginated(PAGE_SIZE);
      setOrders(result.orders);
      setLastDoc(result.lastDoc);
      setHasMore(result.hasMore);
      setTotalCount(result.totalCount);
      await loadCOValues(result.orders);
    } catch (err) {
      setError('Failed to load orders');
      console.error(err);
    } finally {
      setLoading(false);
    }
  };

  const loadMoreOrders = async () => {
    if (!hasMore || loadingMore) return;
    setLoadingMore(true);
    try {
      const result = await getOrdersPaginated(PAGE_SIZE, lastDoc);
      setOrders(prev => [...prev, ...result.orders]);
      setLastDoc(result.lastDoc);
      setHasMore(result.hasMore);
      await loadCOValues(result.orders, true);
    } catch (err) {
      console.error('Failed to load more orders:', err);
    } finally {
      setLoadingMore(false);
    }
  };

  const loadCOValues = async (ordersList: Order[], append = false) => {
    const ordersWithPendingCOs = ordersList.filter(o => o.activeChangeOrderStatus === 'pending_signature' && o.id);
    if (ordersWithPendingCOs.length > 0) {
      const coPromises = ordersWithPendingCOs.map(async (order) => {
        try {
          const cos = await getChangeOrdersForOrder(order.id!);
          const liveCO = cos.find(co => co.status === 'pending_signature');
          if (liveCO) {
            return {
              orderId: order.id!,
              values: {
                deposit: liveCO.newValues.deposit,
                total: liveCO.newValues.subtotalBeforeTax + (liveCO.newValues.extraMoneyFluff || 0),
                changeOrderNumber: liveCO.changeOrderNumber,
              } as EffectiveCOValues,
            };
          }
          return null;
        } catch (err) {
          console.error(`Failed to load COs for ${order.orderNumber}:`, err);
          return null;
        }
      });

      const results = await Promise.all(coPromises);
      const newMap: Record<string, EffectiveCOValues> = {};
      results.forEach(result => {
        if (result) {
          newMap[result.orderId] = result.values;
        }
      });
      setEffectiveCOValuesMap(prev => append ? { ...prev, ...newMap } : newMap);
    } else if (!append) {
      setEffectiveCOValuesMap({});
    }
  };

  const filterOrders = () => {
    let filtered = [...orders];

    // Filter by status
    if (statusFilter !== 'all') {
      filtered = filtered.filter((order) => order.status === statusFilter);
    }

    // Filter by search term
    if (searchTerm.trim()) {
      const term = searchTerm.toLowerCase();
      filtered = filtered.filter(
        (order) =>
          order.orderNumber.toLowerCase().includes(term) ||
          order.customer.firstName.toLowerCase().includes(term) ||
          order.customer.lastName.toLowerCase().includes(term) ||
          order.customer.email.toLowerCase().includes(term)
      );
    }

    setFilteredOrders(filtered);
  };

  const handleSendForSignature = async (orderId: string, managerApprovalCode?: string, testMode?: boolean) => {
    // Call the e-sign bridge function
    const response = await fetch(
      `${import.meta.env.VITE_FUNCTIONS_URL || ''}/sendOrderForSignature`,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          orderId,
          managerApprovalCode,
          // Use same code for payment approval
          paymentApprovalCode: managerApprovalCode,
          testMode,
        }),
      }
    );

    const data = await response.json();

    // Check if saved as draft needing manager approval
    if (data.savedAsDraft && data.requiresManagerApproval) {
      await loadOrders();
      return {
        requiresManagerApproval: true,
        savedAsDraft: true,
        validationErrors: data.validationErrors,
        validationWarnings: data.validationWarnings,
        message: data.message,
      };
    }

    // Check if manager approval is required (deposit discrepancy)
    if (data.requiresManagerApproval) {
      return {
        requiresManagerApproval: true,
        validationErrors: data.validationErrors,
        validationWarnings: data.validationWarnings,
        message: data.message,
      };
    }

    // Check if payment approval is required (manual payment types)
    if (data.requiresPaymentApproval) {
      // Don't reload orders yet - let the approval dialog show first
      return {
        requiresPaymentApproval: true,
        paymentType: data.paymentType,
        message: data.message,
      };
    }

    // Check if Stripe verification failed
    if (data.stripeVerificationFailed) {
      await loadOrders();
      return {
        stripeVerificationFailed: true,
        error: data.error,
        stripeVerification: data.stripeVerification,
        message: data.error,
      };
    }

    // Check if Stripe amount mismatch (needs approval)
    if (data.stripeAmountMismatch) {
      await loadOrders();
      return {
        requiresPaymentApproval: true,
        stripeAmountMismatch: true,
        stripeVerification: data.stripeVerification,
        message: data.message,
      };
    }

    if (!data.success) {
      throw new Error(data.error || 'Failed to send for signature');
    }

    // Reload orders to get updated status
    await loadOrders();
    setSelectedOrder(null);
    return undefined;
  };

  const handleDelete = async (orderId: string) => {
    await deleteOrder(orderId);
    await loadOrders();
  };

  const handleCancelOrder = async (orderId: string, reason: string) => {
    await cancelOrder(orderId, reason, user?.uid || 'unknown', user?.email || 'unknown');
    await loadOrders();
    setSelectedOrder(null);
  };

  const handleApprovePaymentFromCard = (orderId: string) => {
    const order = orders.find((o) => o.id === orderId);
    if (order) {
      setOpenWithPaymentApproval(true);
      setSelectedOrder(order);
    }
  };

  const handleCancelSignature = async (orderId: string) => {
    const response = await fetch(
      `${import.meta.env.VITE_FUNCTIONS_URL || ''}/cancelSignature`,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ orderId }),
      }
    );

    const data = await response.json();

    if (!data.success) {
      throw new Error(data.error || 'Failed to cancel signature');
    }

    // Reload orders to get updated status
    await loadOrders();
  };

  const handleCloseDetails = () => {
    setSelectedOrder(null);
    setOpenWithPaymentApproval(false);
  };

  const getStatusCounts = () => {
    const counts: Record<OrderStatus | 'all', number> = {
      all: orders.length,
      draft: 0,
      pending_payment: 0,
      sent_for_signature: 0,
      signed: 0,
      ready_for_manufacturer: 0,
      cancelled: 0,
    };

    orders.forEach((order) => {
      counts[order.status]++;
    });

    return counts;
  };

  const statusCounts = getStatusCounts();

  if (loading) {
    return (
      <div style={styles.container}>
        <div style={styles.loading}>Loading orders...</div>
      </div>
    );
  }

  return (
    <div style={styles.container}>
      <div style={styles.header}>
        <h2 style={styles.title}>Orders</h2>
        <p style={styles.subtitle}>Showing {orders.length} of {totalCount} orders</p>
      </div>

      {error && <div style={styles.error}>{error}</div>}

      {/* Filters */}
      <div style={styles.filters}>
        <div style={styles.statusFilters}>
          {STATUS_FILTERS.map((filter) => (
            <button
              key={filter.value}
              onClick={() => setStatusFilter(filter.value)}
              style={{
                ...styles.filterButton,
                ...(statusFilter === filter.value ? styles.filterButtonActive : {}),
              }}
            >
              {filter.label}
              <span style={styles.filterCount}>({statusCounts[filter.value]})</span>
            </button>
          ))}
        </div>
        <input
          type="text"
          value={searchTerm}
          onChange={(e) => setSearchTerm(e.target.value)}
          placeholder="Search orders..."
          style={styles.searchInput}
        />
      </div>

      {/* Orders Grid */}
      {filteredOrders.length === 0 ? (
        <div style={styles.emptyState}>
          <p>No orders found</p>
          {statusFilter !== 'all' && (
            <button
              onClick={() => setStatusFilter('all')}
              style={styles.clearFilterButton}
            >
              Clear filters
            </button>
          )}
        </div>
      ) : (
        <>
          <div style={styles.grid}>
            {filteredOrders.map((order) => (
              <OrderCard
                key={order.id}
                order={order}
                onClick={() => setSelectedOrder(order)}
                onApprovePayment={handleApprovePaymentFromCard}
                effectiveCOValues={order.id ? effectiveCOValuesMap[order.id] : undefined}
              />
            ))}
          </div>
          {hasMore && (
            <div style={{ textAlign: 'center', padding: '24px' }}>
              <button
                onClick={loadMoreOrders}
                disabled={loadingMore}
                style={{
                  padding: '12px 32px',
                  fontSize: 14,
                  fontWeight: 500,
                  color: '#fff',
                  backgroundColor: loadingMore ? '#90caf9' : '#2196F3',
                  border: 'none',
                  borderRadius: 8,
                  cursor: loadingMore ? 'default' : 'pointer',
                }}
              >
                {loadingMore ? 'Loading...' : `Load More (${totalCount - orders.length} remaining)`}
              </button>
            </div>
          )}
        </>
      )}

      {/* Order Details Modal */}
      {selectedOrder && (
        <OrderDetails
          order={selectedOrder}
          onClose={handleCloseDetails}
          onSendForSignature={handleSendForSignature}
          onDelete={handleDelete}
          onCancelOrder={handleCancelOrder}
          onCancelSignature={handleCancelSignature}
          openWithPaymentApproval={openWithPaymentApproval}
          onRefresh={loadOrders}
          onNavigateToChangeOrder={onNavigateToChangeOrder}
        />
      )}
    </div>
  );
}

const styles: Record<string, React.CSSProperties> = {
  container: {
    maxWidth: '1200px',
    margin: '0 auto',
    padding: '24px',
  },
  header: {
    marginBottom: '24px',
  },
  title: {
    margin: '0 0 8px 0',
    fontSize: '24px',
    fontWeight: 600,
  },
  subtitle: {
    margin: 0,
    color: '#666',
  },
  loading: {
    textAlign: 'center',
    padding: '60px',
    color: '#666',
  },
  error: {
    padding: '16px',
    marginBottom: '24px',
    backgroundColor: '#ffebee',
    color: '#c62828',
    borderRadius: '8px',
    fontSize: '14px',
  },
  filters: {
    display: 'flex',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: '24px',
    gap: '16px',
    flexWrap: 'wrap',
  },
  statusFilters: {
    display: 'flex',
    gap: '8px',
    flexWrap: 'wrap',
  },
  filterButton: {
    padding: '8px 16px',
    backgroundColor: 'white',
    border: '1px solid #ddd',
    borderRadius: '20px',
    fontSize: '14px',
    cursor: 'pointer',
    display: 'flex',
    alignItems: 'center',
    gap: '6px',
    transition: 'all 0.2s',
  },
  filterButtonActive: {
    backgroundColor: '#2196F3',
    borderColor: '#2196F3',
    color: 'white',
  },
  filterCount: {
    fontSize: '12px',
    opacity: 0.8,
  },
  searchInput: {
    padding: '10px 16px',
    border: '1px solid #ddd',
    borderRadius: '4px',
    fontSize: '14px',
    width: '250px',
  },
  emptyState: {
    textAlign: 'center',
    padding: '60px',
    backgroundColor: 'white',
    borderRadius: '8px',
    color: '#666',
  },
  clearFilterButton: {
    marginTop: '16px',
    padding: '8px 16px',
    backgroundColor: '#2196F3',
    color: 'white',
    border: 'none',
    borderRadius: '4px',
    cursor: 'pointer',
  },
  grid: {
    display: 'grid',
    gridTemplateColumns: 'repeat(auto-fill, minmax(320px, 1fr))',
    gap: '20px',
  },
};
