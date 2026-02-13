import React, { useState, useEffect } from 'react';
import { collection, query, orderBy, onSnapshot, Timestamp } from 'firebase/firestore';
import { db } from '../../config/firebase';
import { useAuth } from '../../contexts/AuthContext';
import { Order } from '../../types/order';
import { OrderDetails } from '../orders/OrderDetails';
import { deleteOrder } from '../../services/orderService';

interface ChangeOrder {
  id: string;
  parentOrderId: string;
  changeOrderNumber: string;
  status: string;
  newValues: {
    subtotalBeforeTax: number;
    extraMoneyFluff: number;
    deposit: number;
  };
}

interface OrderWithStatus extends Order {
  id: string;
  // Derived status fields
  paymentStatus: 'pending' | 'paid' | 'partial' | 'none';
  signatureStatus: 'pending' | 'sent' | 'signed' | 'none';
  sentToMfgStatus: 'pending' | 'sent' | 'none';
  // Calculated values
  orderTotal: number;           // Original order total
  adjustedTotal: number;        // Total after change orders (effective)
  depositRequired: number;      // Current deposit required (effective)
  depositPaid: number;          // Amount actually paid
  depositBalance: number;       // Remaining balance (effective)
  // Change order info
  hasChangeOrders: boolean;
  changeOrderCount: number;
  hasLiveCO: boolean;           // Has pending_signature CO
  liveCONumber?: string;        // CO number if live
  // OK to Pay (commission ready)
  okToPay: boolean;
}

interface MonthGroup {
  month: string;
  monthKey: string;
  orders: OrderWithStatus[];
  totalSales: number;
  totalAdjusted: number;
  paidCount: number;
  signedCount: number;
  pendingCount: number;
  okToPayCount: number;
  okToPayAmount: number;
}

interface SalesDashboardProps {
  onOrderClick?: (orderNumber: string) => void;
  onNavigateToChangeOrder?: (orderId: string, changeOrderId?: string) => void;
}

type DatePreset = 'all' | 'this-month' | 'last-month' | 'this-quarter' | 'ytd' | 'custom';

interface DateRange {
  start: Date | null;
  end: Date | null;
}

// Helper to get date range from preset
function getDateRangeFromPreset(preset: DatePreset): DateRange {
  const now = new Date();
  const year = now.getFullYear();
  const month = now.getMonth();

  switch (preset) {
    case 'this-month':
      return {
        start: new Date(year, month, 1),
        end: new Date(year, month + 1, 0, 23, 59, 59),
      };
    case 'last-month':
      return {
        start: new Date(year, month - 1, 1),
        end: new Date(year, month, 0, 23, 59, 59),
      };
    case 'this-quarter': {
      const quarterStart = Math.floor(month / 3) * 3;
      return {
        start: new Date(year, quarterStart, 1),
        end: new Date(year, quarterStart + 3, 0, 23, 59, 59),
      };
    }
    case 'ytd':
      return {
        start: new Date(year, 0, 1),
        end: new Date(year, 11, 31, 23, 59, 59),
      };
    case 'all':
    default:
      return { start: null, end: null };
  }
}

export function SalesDashboard({ onNavigateToChangeOrder }: SalesDashboardProps) {
  const { userRole, userName, viewAsUser } = useAuth();
  const isSalesRep = userRole === 'sales_rep';
  // For sales reps: lock filter to their name. For admin viewing-as: use that user's name.
  const forcedSalesPerson = isSalesRep
    ? (viewAsUser?.name || userName || null)
    : null;

  const [orders, setOrders] = useState<Order[]>([]);
  const [changeOrders, setChangeOrders] = useState<Record<string, ChangeOrder[]>>({});
  const [loading, setLoading] = useState(true);
  const [expandedMonths, setExpandedMonths] = useState<Set<string>>(new Set());
  const [filterSalesPerson, setFilterSalesPerson] = useState<string>(forcedSalesPerson || 'all');
  const [salesPersons, setSalesPersons] = useState<string[]>([]);
  const [viewMode, setViewMode] = useState<'all' | 'pending' | 'ok-to-pay'>('all');
  const [selectedOrder, setSelectedOrder] = useState<Order | null>(null);
  const [datePreset, setDatePreset] = useState<DatePreset>('this-month');
  const [customDateRange, setCustomDateRange] = useState<DateRange>({ start: null, end: null });
  const [showCustomDatePicker, setShowCustomDatePicker] = useState(false);
  const [actionInProgress, setActionInProgress] = useState<string | null>(null); // orderId being processed

  // Keep filter in sync when forcedSalesPerson changes (e.g. admin switches view-as user)
  useEffect(() => {
    if (forcedSalesPerson) {
      setFilterSalesPerson(forcedSalesPerson);
    }
  }, [forcedSalesPerson]);

  // Load orders
  useEffect(() => {
    const q = query(
      collection(db, 'orders'),
      orderBy('createdAt', 'desc')
    );

    const unsubscribe = onSnapshot(q, (snapshot) => {
      const ordersData: Order[] = [];
      const salesPersonSet = new Set<string>();

      snapshot.forEach((doc) => {
        const data = doc.data() as Order;
        ordersData.push({ ...data, id: doc.id } as Order & { id: string });
        if (data.salesPerson) {
          salesPersonSet.add(data.salesPerson);
        }
      });

      setOrders(ordersData);
      setSalesPersons(Array.from(salesPersonSet).sort());
      setLoading(false);

      // Auto-expand current month
      const currentMonth = new Date().toISOString().slice(0, 7);
      setExpandedMonths(new Set([currentMonth]));
    });

    return unsubscribe;
  }, []);

  // Load change orders
  useEffect(() => {
    const q = query(
      collection(db, 'change_orders'),
      orderBy('createdAt', 'desc')
    );

    const unsubscribe = onSnapshot(q, (snapshot) => {
      const coByOrder: Record<string, ChangeOrder[]> = {};

      snapshot.forEach((doc) => {
        const data = doc.data();
        // ChangeOrder uses 'orderId' field, not 'parentOrderId'
        const orderId = data.orderId;
        if (!orderId) return; // Skip if no orderId

        const co: ChangeOrder = {
          id: doc.id,
          parentOrderId: orderId,
          changeOrderNumber: data.changeOrderNumber,
          status: data.status,
          newValues: {
            subtotalBeforeTax: data.newValues?.subtotalBeforeTax || 0,
            extraMoneyFluff: data.newValues?.extraMoneyFluff || 0,
            deposit: data.newValues?.deposit || 0,
          },
        };

        if (!coByOrder[orderId]) {
          coByOrder[orderId] = [];
        }
        coByOrder[orderId].push(co);
      });

      setChangeOrders(coByOrder);
    });

    return unsubscribe;
  }, []);

  // Process orders with change order data
  const processedOrders = React.useMemo(() => {
    return orders.map((data): OrderWithStatus => {
      const orderId = (data as any).id;
      const orderCOs = changeOrders[orderId] || [];

      // Check for LIVE change order (pending_signature)
      // Check BOTH the order's activeChangeOrderStatus field AND the CO's status
      const hasLiveCOFlag = (data as any).activeChangeOrderStatus === 'pending_signature';
      const liveCO = orderCOs.find(co => co.status === 'pending_signature') ||
                     (hasLiveCOFlag ? orderCOs.find(co => co.status !== 'signed' && co.status !== 'cancelled') : null);

      // Calculate effective values (use live CO if present)
      const originalTotal = (data.pricing?.subtotalBeforeTax || 0) + (data.pricing?.extraMoneyFluff || 0);
      const effectiveTotal = liveCO
        ? liveCO.newValues.subtotalBeforeTax + (liveCO.newValues.extraMoneyFluff || 0)
        : originalTotal;

      // Effective deposit (from live CO or ledger summary or pricing)
      const effectiveDeposit = liveCO
        ? liveCO.newValues.deposit
        : (data.ledgerSummary?.depositRequired || data.pricing?.deposit || 0);

      const depositPaid = data.ledgerSummary?.netReceived || 0;

      // Effective balance based on effective deposit
      const effectiveBalance = effectiveDeposit - depositPaid;

      // Derive payment status from effective balance
      let paymentStatus: 'pending' | 'paid' | 'partial' | 'none' = 'none';
      if (depositPaid > 0) {
        if (effectiveBalance <= 0) {
          paymentStatus = 'paid';
        } else {
          paymentStatus = 'partial';
        }
      } else if (data.payment?.status === 'pending') {
        paymentStatus = 'pending';
      } else if (data.payment?.status === 'paid' || data.payment?.status === 'manually_approved') {
        paymentStatus = 'paid';
      }

      // Derive signature status
      let signatureStatus: 'pending' | 'sent' | 'signed' | 'none' = 'none';
      if (data.signedAt) {
        signatureStatus = 'signed';
      } else if (data.sentForSignatureAt) {
        signatureStatus = 'sent';
      } else if (paymentStatus === 'paid' || paymentStatus === 'partial') {
        signatureStatus = 'pending';
      }

      // Derive sent to manufacturer status
      let sentToMfgStatus: 'pending' | 'sent' | 'none' = 'none';
      if (data.readyForManufacturerAt || (data as any).sentToManufacturerAt) {
        sentToMfgStatus = 'sent';
      } else if (data.signedAt) {
        sentToMfgStatus = 'pending';
      }

      // Change order info
      const hasChangeOrders = data.hasChangeOrders || orderCOs.length > 0;
      const changeOrderCount = data.changeOrderCount || orderCOs.length;

      // OK to Pay logic: Payment complete + Signed + Sent to Manufacturer
      const okToPay = paymentStatus === 'paid' &&
                      signatureStatus === 'signed' &&
                      sentToMfgStatus === 'sent';

      return {
        ...data,
        id: orderId,
        paymentStatus,
        signatureStatus,
        sentToMfgStatus,
        orderTotal: originalTotal,
        adjustedTotal: effectiveTotal,
        depositRequired: effectiveDeposit,
        depositPaid,
        depositBalance: effectiveBalance,
        hasChangeOrders,
        changeOrderCount,
        hasLiveCO: !!liveCO || hasLiveCOFlag,
        liveCONumber: liveCO?.changeOrderNumber || (hasLiveCOFlag ? 'CO' : undefined),
        okToPay,
      };
    });
  }, [orders, changeOrders]);

  // Get active date range
  const activeDateRange = React.useMemo(() => {
    if (datePreset === 'custom') {
      return customDateRange;
    }
    return getDateRangeFromPreset(datePreset);
  }, [datePreset, customDateRange]);

  // Filter orders
  const filteredOrders = React.useMemo(() => {
    let filtered = processedOrders;

    // Filter by date range
    if (activeDateRange.start || activeDateRange.end) {
      filtered = filtered.filter(o => {
        let orderDate: Date;
        if (o.createdAt && typeof (o.createdAt as any).toDate === 'function') {
          orderDate = (o.createdAt as Timestamp).toDate();
        } else if (o.createdAt && (o.createdAt as any).seconds) {
          orderDate = new Date((o.createdAt as any).seconds * 1000);
        } else {
          return true; // Include orders without dates
        }

        if (activeDateRange.start && orderDate < activeDateRange.start) return false;
        if (activeDateRange.end && orderDate > activeDateRange.end) return false;
        return true;
      });
    }

    // Filter by sales person
    if (filterSalesPerson !== 'all') {
      filtered = filtered.filter(o => o.salesPerson === filterSalesPerson);
    }

    // Filter by view mode
    if (viewMode === 'pending') {
      filtered = filtered.filter(o =>
        o.paymentStatus === 'pending' ||
        o.signatureStatus === 'pending' ||
        o.signatureStatus === 'sent' ||
        o.sentToMfgStatus === 'pending'
      );
    } else if (viewMode === 'ok-to-pay') {
      filtered = filtered.filter(o => o.okToPay);
    }

    return filtered;
  }, [processedOrders, filterSalesPerson, viewMode, activeDateRange]);

  // Group orders by month
  const groupedByMonth = React.useMemo(() => {
    const groups: Record<string, MonthGroup> = {};

    filteredOrders.forEach((order) => {
      let date: Date;
      if (order.createdAt && typeof (order.createdAt as any).toDate === 'function') {
        date = (order.createdAt as Timestamp).toDate();
      } else if (order.createdAt && (order.createdAt as any).seconds) {
        date = new Date((order.createdAt as any).seconds * 1000);
      } else {
        date = new Date();
      }

      const monthKey = date.toISOString().slice(0, 7);
      const monthName = date.toLocaleDateString('en-US', { month: 'long', year: 'numeric' });

      if (!groups[monthKey]) {
        groups[monthKey] = {
          month: monthName,
          monthKey,
          orders: [],
          totalSales: 0,
          totalAdjusted: 0,
          paidCount: 0,
          signedCount: 0,
          pendingCount: 0,
          okToPayCount: 0,
          okToPayAmount: 0,
        };
      }

      groups[monthKey].orders.push(order);
      groups[monthKey].totalSales += order.orderTotal;
      groups[monthKey].totalAdjusted += order.adjustedTotal;

      if (order.paymentStatus === 'paid') groups[monthKey].paidCount++;
      if (order.signatureStatus === 'signed') groups[monthKey].signedCount++;
      if (order.paymentStatus === 'pending' || order.signatureStatus === 'pending' || order.signatureStatus === 'sent') {
        groups[monthKey].pendingCount++;
      }
      if (order.okToPay) {
        groups[monthKey].okToPayCount++;
        groups[monthKey].okToPayAmount += order.adjustedTotal;
      }
    });

    return Object.values(groups).sort((a, b) => b.monthKey.localeCompare(a.monthKey));
  }, [filteredOrders]);

  // Calculate overall stats
  const stats = React.useMemo(() => {
    return {
      totalOrders: filteredOrders.length,
      totalSales: filteredOrders.reduce((sum, o) => sum + o.orderTotal, 0),
      totalAdjusted: filteredOrders.reduce((sum, o) => sum + o.adjustedTotal, 0),
      paidCount: filteredOrders.filter(o => o.paymentStatus === 'paid').length,
      signedCount: filteredOrders.filter(o => o.signatureStatus === 'signed').length,
      pendingPayment: filteredOrders.filter(o => o.paymentStatus === 'pending' || o.paymentStatus === 'partial').length,
      pendingSignature: filteredOrders.filter(o => o.signatureStatus === 'pending' || o.signatureStatus === 'sent').length,
      withChangeOrders: filteredOrders.filter(o => o.hasChangeOrders).length,
      withLiveCOs: filteredOrders.filter(o => o.hasLiveCO).length,
      okToPayCount: filteredOrders.filter(o => o.okToPay).length,
      okToPayAmount: filteredOrders.filter(o => o.okToPay).reduce((sum, o) => sum + o.adjustedTotal, 0),
    };
  }, [filteredOrders]);

  const toggleMonth = (monthKey: string) => {
    setExpandedMonths(prev => {
      const next = new Set(prev);
      if (next.has(monthKey)) {
        next.delete(monthKey);
      } else {
        next.add(monthKey);
      }
      return next;
    });
  };

  // Order details modal handlers
  const handleOrderClick = (order: OrderWithStatus) => {
    // Convert OrderWithStatus back to Order for the modal
    setSelectedOrder(order as Order);
  };

  const handleCloseDetails = () => {
    setSelectedOrder(null);
  };

  const handleSendForSignature = async (orderId: string, managerApprovalCode?: string, testMode?: boolean) => {
    const response = await fetch(
      `${import.meta.env.VITE_FUNCTIONS_URL || ''}/sendOrderForSignature`,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ orderId, managerApprovalCode, paymentApprovalCode: managerApprovalCode, testMode }),
      }
    );
    const data = await response.json();

    if (data.requiresManagerApproval || data.requiresPaymentApproval || data.savedAsDraft) {
      return data;
    }
    if (data.stripeVerificationFailed || data.stripeAmountMismatch) {
      return data;
    }
    if (!data.success) {
      throw new Error(data.error || 'Failed to send for signature');
    }
    setSelectedOrder(null);
    return undefined;
  };

  const handleDelete = async (orderId: string) => {
    await deleteOrder(orderId);
    setSelectedOrder(null);
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
  };

  // Quick action: Resend signature request
  const handleResendSignature = async (e: React.MouseEvent, orderId: string, orderNumber: string) => {
    e.stopPropagation(); // Prevent row click
    if (actionInProgress) return;

    setActionInProgress(orderId);
    try {
      const response = await fetch(
        `${import.meta.env.VITE_FUNCTIONS_URL || ''}/resendSignature`,
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ orderId }),
        }
      );
      const data = await response.json();
      if (data.success) {
        alert(`Signature request resent for ${orderNumber}`);
      } else {
        alert(data.error || 'Failed to resend signature');
      }
    } catch (err) {
      console.error('Resend error:', err);
      alert('Failed to resend signature request');
    } finally {
      setActionInProgress(null);
    }
  };

  // Quick action: Send reminder email
  const handleSendReminder = async (e: React.MouseEvent, orderId: string, orderNumber: string) => {
    e.stopPropagation(); // Prevent row click
    if (actionInProgress) return;

    setActionInProgress(orderId);
    try {
      const response = await fetch(
        `${import.meta.env.VITE_FUNCTIONS_URL || ''}/sendReminder`,
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ orderId }),
        }
      );
      const data = await response.json();
      if (data.success) {
        alert(`Reminder sent for ${orderNumber}`);
      } else {
        alert(data.error || 'Failed to send reminder');
      }
    } catch (err) {
      console.error('Reminder error:', err);
      alert('Failed to send reminder');
    } finally {
      setActionInProgress(null);
    }
  };

  const formatCurrency = (amount: number) => {
    return new Intl.NumberFormat('en-US', {
      style: 'currency',
      currency: 'USD',
      minimumFractionDigits: 0,
      maximumFractionDigits: 0,
    }).format(amount);
  };

  const formatDate = (timestamp: any): string => {
    if (!timestamp) return '-';
    try {
      let date: Date;
      if (timestamp.toDate) {
        date = timestamp.toDate();
      } else if (timestamp.seconds) {
        date = new Date(timestamp.seconds * 1000);
      } else {
        return '-';
      }
      return date.toLocaleDateString('en-US', { month: 'numeric', day: 'numeric', year: 'numeric' });
    } catch {
      return '-';
    }
  };

  const getStatusBadge = (status: string, type: 'payment' | 'signature' | 'mfg' | 'oktopay') => {
    const configs: Record<string, { bg: string; color: string; label: string }> = {
      'payment-paid': { bg: '#c8e6c9', color: '#1b5e20', label: 'Paid' },
      'payment-partial': { bg: '#fff3e0', color: '#e65100', label: 'Partial' },
      'payment-pending': { bg: '#ffecb3', color: '#ff6f00', label: 'Pending' },
      'payment-none': { bg: '#f5f5f5', color: '#9e9e9e', label: '-' },
      'signature-signed': { bg: '#c8e6c9', color: '#1b5e20', label: 'Yes' },
      'signature-sent': { bg: '#bbdefb', color: '#1565c0', label: 'Sent' },
      'signature-pending': { bg: '#ffecb3', color: '#ff6f00', label: 'Pending' },
      'signature-none': { bg: '#f5f5f5', color: '#9e9e9e', label: '-' },
      'mfg-sent': { bg: '#c8e6c9', color: '#1b5e20', label: 'Yes' },
      'mfg-pending': { bg: '#ffecb3', color: '#ff6f00', label: 'Pending' },
      'mfg-none': { bg: '#f5f5f5', color: '#9e9e9e', label: '-' },
      'oktopay-true': { bg: '#c8e6c9', color: '#1b5e20', label: '✓ Ready' },
      'oktopay-false': { bg: '#f5f5f5', color: '#9e9e9e', label: '-' },
    };

    const key = `${type}-${status}`;
    const config = configs[key] || { bg: '#f5f5f5', color: '#666', label: status };

    return (
      <span
        style={{
          display: 'inline-block',
          padding: '2px 8px',
          borderRadius: '4px',
          fontSize: '12px',
          fontWeight: 500,
          backgroundColor: config.bg,
          color: config.color,
          minWidth: '50px',
          textAlign: 'center',
        }}
      >
        {config.label}
      </span>
    );
  };

  if (loading) {
    return (
      <div style={styles.container}>
        <div style={styles.loading}>Loading sales data...</div>
      </div>
    );
  }

  return (
    <div style={styles.container}>
      {/* Header */}
      <div style={styles.header}>
        <h2 style={styles.title}>Sales Dashboard</h2>
        <div style={styles.filterRow}>
          {/* View Mode Toggle */}
          <div style={styles.viewToggle}>
            <button
              onClick={() => setViewMode('all')}
              style={{
                ...styles.toggleButton,
                backgroundColor: viewMode === 'all' ? '#1976d2' : '#f5f5f5',
                color: viewMode === 'all' ? 'white' : '#666',
              }}
            >
              All
            </button>
            <button
              onClick={() => setViewMode('pending')}
              style={{
                ...styles.toggleButton,
                backgroundColor: viewMode === 'pending' ? '#ff9800' : '#f5f5f5',
                color: viewMode === 'pending' ? 'white' : '#666',
              }}
            >
              Pending
            </button>
            <button
              onClick={() => setViewMode('ok-to-pay')}
              style={{
                ...styles.toggleButton,
                backgroundColor: viewMode === 'ok-to-pay' ? '#4caf50' : '#f5f5f5',
                color: viewMode === 'ok-to-pay' ? 'white' : '#666',
              }}
            >
              OK to Pay
            </button>
          </div>

          {!forcedSalesPerson ? (
            <>
              <label style={styles.filterLabel}>Sales Rep:</label>
              <select
                value={filterSalesPerson}
                onChange={(e) => setFilterSalesPerson(e.target.value)}
                style={styles.filterSelect}
              >
                <option value="all">All Sales Reps</option>
                {salesPersons.map((sp) => (
                  <option key={sp} value={sp}>{sp}</option>
                ))}
              </select>
            </>
          ) : (
            <span style={{ fontSize: 14, color: '#666', fontWeight: 500 }}>
              {forcedSalesPerson}
            </span>
          )}
        </div>
      </div>

      {/* Date Range Filter */}
      <div style={styles.dateFilterRow}>
        <div style={styles.datePresets}>
          {[
            { value: 'this-month', label: 'This Month' },
            { value: 'last-month', label: 'Last Month' },
            { value: 'this-quarter', label: 'This Quarter' },
            { value: 'ytd', label: 'YTD' },
            { value: 'all', label: 'All Time' },
            { value: 'custom', label: 'Custom' },
          ].map((preset) => (
            <button
              key={preset.value}
              onClick={() => {
                setDatePreset(preset.value as DatePreset);
                if (preset.value === 'custom') {
                  setShowCustomDatePicker(true);
                } else {
                  setShowCustomDatePicker(false);
                }
              }}
              style={{
                ...styles.datePresetButton,
                backgroundColor: datePreset === preset.value ? '#1976d2' : 'white',
                color: datePreset === preset.value ? 'white' : '#333',
                borderColor: datePreset === preset.value ? '#1976d2' : '#ddd',
              }}
            >
              {preset.label}
            </button>
          ))}
        </div>

        {/* Show date range info */}
        {activeDateRange.start && activeDateRange.end && (
          <div style={styles.dateRangeInfo}>
            {activeDateRange.start.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })}
            {' - '}
            {activeDateRange.end.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })}
          </div>
        )}

        {/* Custom date picker */}
        {showCustomDatePicker && (
          <div style={styles.customDatePicker}>
            <div style={styles.dateInputGroup}>
              <label style={styles.dateInputLabel}>From:</label>
              <input
                type="date"
                value={customDateRange.start ? customDateRange.start.toISOString().split('T')[0] : ''}
                onChange={(e) => {
                  const date = e.target.value ? new Date(e.target.value + 'T00:00:00') : null;
                  setCustomDateRange(prev => ({ ...prev, start: date }));
                }}
                style={styles.dateInput}
              />
            </div>
            <div style={styles.dateInputGroup}>
              <label style={styles.dateInputLabel}>To:</label>
              <input
                type="date"
                value={customDateRange.end ? customDateRange.end.toISOString().split('T')[0] : ''}
                onChange={(e) => {
                  const date = e.target.value ? new Date(e.target.value + 'T23:59:59') : null;
                  setCustomDateRange(prev => ({ ...prev, end: date }));
                }}
                style={styles.dateInput}
              />
            </div>
            <button
              onClick={() => {
                setCustomDateRange({ start: null, end: null });
              }}
              style={styles.clearDateButton}
            >
              Clear
            </button>
          </div>
        )}
      </div>

      {/* Summary Stats */}
      <div style={styles.statsGrid}>
        <div style={styles.statCard}>
          <div style={styles.statValue}>{stats.totalOrders}</div>
          <div style={styles.statLabel}>Total Orders</div>
        </div>
        <div style={styles.statCard}>
          <div style={{ ...styles.statValue, color: '#2e7d32', fontSize: '20px' }}>{formatCurrency(stats.totalAdjusted)}</div>
          <div style={styles.statLabel}>Total Sales</div>
          {stats.withLiveCOs > 0 && (
            <div style={styles.statSubtext}>{stats.withLiveCOs} with pending COs</div>
          )}
        </div>
        <div style={styles.statCard}>
          <div style={{ ...styles.statValue, color: '#1565c0' }}>{stats.paidCount}/{stats.totalOrders}</div>
          <div style={styles.statLabel}>Paid</div>
        </div>
        <div style={styles.statCard}>
          <div style={{ ...styles.statValue, color: '#2e7d32' }}>{stats.signedCount}/{stats.totalOrders}</div>
          <div style={styles.statLabel}>Signed</div>
        </div>
        <div style={styles.statCard}>
          <div style={{ ...styles.statValue, color: '#ff6f00' }}>{stats.pendingPayment + stats.pendingSignature}</div>
          <div style={styles.statLabel}>Pending</div>
        </div>
        <div style={{ ...styles.statCard, backgroundColor: '#e8f5e9', border: '2px solid #4caf50' }}>
          <div style={{ ...styles.statValue, color: '#2e7d32' }}>{stats.okToPayCount}</div>
          <div style={styles.statLabel}>OK to Pay</div>
          <div style={{ ...styles.statSubtext, color: '#2e7d32', fontWeight: 600 }}>{formatCurrency(stats.okToPayAmount)}</div>
        </div>
      </div>

      {/* Monthly Groups */}
      <div style={styles.monthsContainer}>
        {groupedByMonth.map((group) => (
          <div key={group.monthKey} style={styles.monthCard}>
            {/* Month Header */}
            <div
              style={styles.monthHeader}
              onClick={() => toggleMonth(group.monthKey)}
            >
              <div style={styles.monthHeaderLeft}>
                <span style={styles.expandIcon}>
                  {expandedMonths.has(group.monthKey) ? '▼' : '▶'}
                </span>
                <h3 style={styles.monthTitle}>{group.month}</h3>
                <span style={styles.orderCount}>({group.orders.length} orders)</span>
              </div>
              <div style={styles.monthStats}>
                <span style={styles.monthStat}>
                  <span style={styles.monthStatLabel}>Sales:</span>
                  <span style={{ color: '#2e7d32', fontWeight: 600 }}>{formatCurrency(group.totalAdjusted)}</span>
                </span>
                <span style={styles.monthStat}>
                  <span style={styles.monthStatLabel}>Paid:</span>
                  <span style={{ color: '#1565c0' }}>{group.paidCount}/{group.orders.length}</span>
                </span>
                <span style={styles.monthStat}>
                  <span style={styles.monthStatLabel}>Signed:</span>
                  <span style={{ color: '#2e7d32' }}>{group.signedCount}/{group.orders.length}</span>
                </span>
                {group.okToPayCount > 0 && (
                  <span style={{ ...styles.monthStat, backgroundColor: '#e8f5e9', padding: '2px 8px', borderRadius: '4px' }}>
                    <span style={{ color: '#2e7d32', fontWeight: 600 }}>
                      ✓ {group.okToPayCount} OK to Pay ({formatCurrency(group.okToPayAmount)})
                    </span>
                  </span>
                )}
                {group.pendingCount > 0 && (
                  <span style={{ ...styles.monthStat, color: '#ff6f00' }}>
                    {group.pendingCount} pending
                  </span>
                )}
              </div>
            </div>

            {/* Orders Table */}
            {expandedMonths.has(group.monthKey) && (
              <div style={styles.ordersTable}>
                <table style={styles.table}>
                  <thead>
                    <tr style={styles.tableHeaderRow}>
                      <th style={styles.th}>Order #</th>
                      <th style={styles.th}>Date</th>
                      <th style={styles.th}>Customer</th>
                      <th style={styles.th}>Manufacturer</th>
                      <th style={{ ...styles.th, textAlign: 'right' }}>Total</th>
                      <th style={{ ...styles.th, textAlign: 'right' }}>Deposit</th>
                      <th style={{ ...styles.th, textAlign: 'center' }}>Payment</th>
                      <th style={{ ...styles.th, textAlign: 'center' }}>Sent</th>
                      <th style={{ ...styles.th, textAlign: 'center' }}>Signed</th>
                      <th style={{ ...styles.th, textAlign: 'center' }}>To Mfg</th>
                      <th style={{ ...styles.th, textAlign: 'center' }}>OK to Pay</th>
                      <th style={{ ...styles.th, textAlign: 'center' }}>Actions</th>
                    </tr>
                  </thead>
                  <tbody>
                    {group.orders.map((order) => {
                      const customerName = order.customer?.firstName && order.customer?.lastName
                        ? `${order.customer.firstName} ${order.customer.lastName}`
                        : (order.customer as any)?.name || '-';

                      return (
                        <tr
                          key={order.id}
                          onClick={() => handleOrderClick(order)}
                          style={{
                            ...styles.tableRow,
                            backgroundColor: order.okToPay ? '#f1f8e9' :
                                           order.hasLiveCO ? '#e3f2fd' :
                                           order.hasChangeOrders ? '#fff8e1' : 'transparent',
                            cursor: 'pointer',
                          }}
                        >
                          <td style={{ ...styles.td, fontFamily: 'monospace' }}>
                            <span style={{ color: '#1565c0' }}>{order.orderNumber}</span>
                            {order.hasLiveCO && (
                              <span style={styles.liveCOBadge}>{order.liveCONumber}</span>
                            )}
                            {!order.hasLiveCO && order.hasChangeOrders && (
                              <span style={styles.coBadge}>+{order.changeOrderCount} CO</span>
                            )}
                          </td>
                          <td style={styles.td}>{formatDate(order.createdAt)}</td>
                          <td style={styles.td}>{customerName}</td>
                          <td style={styles.td}>{order.building?.manufacturer || '-'}</td>
                          <td style={{ ...styles.td, textAlign: 'right' }}>
                            <div style={{ fontWeight: 500 }}>{formatCurrency(order.adjustedTotal)}</div>
                            {order.hasLiveCO && order.adjustedTotal !== order.orderTotal && (
                              <div style={{ fontSize: '11px', color: '#999', textDecoration: 'line-through' }}>
                                {formatCurrency(order.orderTotal)}
                              </div>
                            )}
                          </td>
                          <td style={{ ...styles.td, textAlign: 'right' }}>
                            <div style={{ fontSize: '12px' }}>
                              <span style={{ color: order.depositBalance <= 0 ? '#2e7d32' : '#e65100' }}>
                                {formatCurrency(order.depositPaid)}
                              </span>
                              <span style={{ color: '#999' }}> / {formatCurrency(order.depositRequired)}</span>
                            </div>
                            {order.depositBalance > 0 && (
                              <div style={{ fontSize: '11px', color: '#c62828' }}>
                                -{formatCurrency(order.depositBalance)} due
                              </div>
                            )}
                            {order.depositBalance < 0 && (
                              <div style={{ fontSize: '11px', color: '#1565c0' }}>
                                +{formatCurrency(Math.abs(order.depositBalance))} over
                              </div>
                            )}
                          </td>
                          <td style={{ ...styles.td, textAlign: 'center' }}>
                            {getStatusBadge(order.paymentStatus, 'payment')}
                          </td>
                          <td style={{ ...styles.td, textAlign: 'center' }}>
                            {getStatusBadge(
                              order.sentForSignatureAt ? 'sent' : 'none',
                              'signature'
                            )}
                          </td>
                          <td style={{ ...styles.td, textAlign: 'center' }}>
                            {getStatusBadge(order.signatureStatus, 'signature')}
                          </td>
                          <td style={{ ...styles.td, textAlign: 'center' }}>
                            {getStatusBadge(order.sentToMfgStatus, 'mfg')}
                          </td>
                          <td style={{ ...styles.td, textAlign: 'center' }}>
                            {getStatusBadge(String(order.okToPay), 'oktopay')}
                          </td>
                          <td style={{ ...styles.td, textAlign: 'center' }}>
                            <div style={styles.actionButtons}>
                              {/* Change Order button - show for eligible orders */}
                              {order.status !== 'ready_for_manufacturer' && onNavigateToChangeOrder && (
                                <button
                                  onClick={(e) => {
                                    e.stopPropagation();
                                    onNavigateToChangeOrder(order.id);
                                  }}
                                  style={{
                                    ...styles.actionButton,
                                    backgroundColor: '#f3e5f5',
                                    color: '#7b1fa2',
                                  }}
                                  title="Create change order"
                                >
                                  +CO
                                </button>
                              )}
                              {/* Resend/Remind for orders awaiting signature */}
                              {order.signatureStatus === 'sent' && (
                                <>
                                  <button
                                    onClick={(e) => handleResendSignature(e, order.id, order.orderNumber)}
                                    disabled={actionInProgress === order.id}
                                    style={{
                                      ...styles.actionButton,
                                      backgroundColor: '#e3f2fd',
                                      color: '#1565c0',
                                    }}
                                    title="Resend signature request"
                                  >
                                    {actionInProgress === order.id ? '...' : 'Resend'}
                                  </button>
                                  <button
                                    onClick={(e) => handleSendReminder(e, order.id, order.orderNumber)}
                                    disabled={actionInProgress === order.id}
                                    style={{
                                      ...styles.actionButton,
                                      backgroundColor: '#fff3e0',
                                      color: '#e65100',
                                    }}
                                    title="Send reminder email"
                                  >
                                    {actionInProgress === order.id ? '...' : 'Remind'}
                                  </button>
                                </>
                              )}
                            </div>
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            )}
          </div>
        ))}

        {groupedByMonth.length === 0 && (
          <div style={styles.emptyState}>
            No orders found for the selected filter.
          </div>
        )}
      </div>

      {/* Order Details Modal */}
      {selectedOrder && (
        <OrderDetails
          order={selectedOrder}
          onClose={handleCloseDetails}
          onSendForSignature={handleSendForSignature}
          onDelete={handleDelete}
          onCancelSignature={handleCancelSignature}
          onNavigateToChangeOrder={onNavigateToChangeOrder ? (orderId) => {
            handleCloseDetails(); // Close the modal first
            onNavigateToChangeOrder(orderId);
          } : undefined}
        />
      )}
    </div>
  );
}

const styles: Record<string, React.CSSProperties> = {
  container: {
    padding: '24px',
    maxWidth: '1600px',
    margin: '0 auto',
  },
  loading: {
    padding: '60px',
    textAlign: 'center',
    color: '#666',
    fontSize: '16px',
  },
  header: {
    display: 'flex',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: '16px',
    flexWrap: 'wrap',
    gap: '16px',
  },
  title: {
    margin: 0,
    fontSize: '24px',
    fontWeight: 600,
    color: '#333',
  },
  filterRow: {
    display: 'flex',
    alignItems: 'center',
    gap: '16px',
    flexWrap: 'wrap',
  },
  viewToggle: {
    display: 'flex',
    gap: '4px',
    backgroundColor: '#f5f5f5',
    padding: '4px',
    borderRadius: '8px',
  },
  toggleButton: {
    padding: '8px 16px',
    border: 'none',
    borderRadius: '6px',
    fontSize: '14px',
    fontWeight: 500,
    cursor: 'pointer',
    transition: 'all 0.2s',
  },
  filterLabel: {
    fontSize: '14px',
    color: '#666',
  },
  filterSelect: {
    padding: '8px 12px',
    fontSize: '14px',
    border: '1px solid #ddd',
    borderRadius: '6px',
    minWidth: '180px',
  },
  dateFilterRow: {
    display: 'flex',
    alignItems: 'center',
    gap: '16px',
    marginBottom: '24px',
    flexWrap: 'wrap',
    backgroundColor: 'white',
    padding: '12px 16px',
    borderRadius: '8px',
    boxShadow: '0 1px 3px rgba(0,0,0,0.1)',
  },
  datePresets: {
    display: 'flex',
    gap: '8px',
    flexWrap: 'wrap',
  },
  datePresetButton: {
    padding: '6px 14px',
    fontSize: '13px',
    fontWeight: 500,
    border: '1px solid #ddd',
    borderRadius: '6px',
    cursor: 'pointer',
    transition: 'all 0.2s',
    backgroundColor: 'white',
  },
  dateRangeInfo: {
    fontSize: '13px',
    color: '#666',
    padding: '6px 12px',
    backgroundColor: '#f5f5f5',
    borderRadius: '6px',
  },
  customDatePicker: {
    display: 'flex',
    alignItems: 'center',
    gap: '12px',
    marginLeft: 'auto',
  },
  dateInputGroup: {
    display: 'flex',
    alignItems: 'center',
    gap: '6px',
  },
  dateInputLabel: {
    fontSize: '13px',
    color: '#666',
  },
  dateInput: {
    padding: '6px 10px',
    fontSize: '13px',
    border: '1px solid #ddd',
    borderRadius: '4px',
  },
  clearDateButton: {
    padding: '6px 12px',
    fontSize: '12px',
    color: '#666',
    backgroundColor: '#f5f5f5',
    border: '1px solid #ddd',
    borderRadius: '4px',
    cursor: 'pointer',
  },
  statsGrid: {
    display: 'grid',
    gridTemplateColumns: 'repeat(6, 1fr)',
    gap: '16px',
    marginBottom: '24px',
  },
  statCard: {
    backgroundColor: 'white',
    borderRadius: '8px',
    padding: '16px',
    textAlign: 'center',
    boxShadow: '0 1px 3px rgba(0,0,0,0.1)',
  },
  statValue: {
    fontSize: '24px',
    fontWeight: 700,
    color: '#333',
  },
  statLabel: {
    fontSize: '12px',
    color: '#666',
    marginTop: '4px',
    textTransform: 'uppercase',
  },
  statSubtext: {
    fontSize: '11px',
    color: '#999',
    marginTop: '4px',
  },
  monthsContainer: {
    display: 'flex',
    flexDirection: 'column',
    gap: '16px',
  },
  monthCard: {
    backgroundColor: 'white',
    borderRadius: '8px',
    boxShadow: '0 1px 3px rgba(0,0,0,0.1)',
    overflow: 'hidden',
  },
  monthHeader: {
    display: 'flex',
    justifyContent: 'space-between',
    alignItems: 'center',
    padding: '16px 20px',
    backgroundColor: '#f8f9fa',
    cursor: 'pointer',
    borderBottom: '1px solid #eee',
    flexWrap: 'wrap',
    gap: '12px',
  },
  monthHeaderLeft: {
    display: 'flex',
    alignItems: 'center',
    gap: '12px',
  },
  expandIcon: {
    fontSize: '12px',
    color: '#666',
  },
  monthTitle: {
    margin: 0,
    fontSize: '16px',
    fontWeight: 600,
    color: '#333',
  },
  orderCount: {
    fontSize: '14px',
    color: '#666',
  },
  monthStats: {
    display: 'flex',
    gap: '20px',
    flexWrap: 'wrap',
  },
  monthStat: {
    fontSize: '14px',
    display: 'flex',
    gap: '6px',
    alignItems: 'center',
  },
  monthStatLabel: {
    color: '#666',
  },
  ordersTable: {
    overflowX: 'auto',
  },
  table: {
    width: '100%',
    borderCollapse: 'collapse',
  },
  tableHeaderRow: {
    backgroundColor: '#f5f5f5',
  },
  th: {
    padding: '10px 12px',
    fontSize: '11px',
    fontWeight: 600,
    color: '#666',
    textAlign: 'left',
    textTransform: 'uppercase',
    borderBottom: '1px solid #eee',
    whiteSpace: 'nowrap',
  },
  tableRow: {
    borderBottom: '1px solid #f0f0f0',
    transition: 'background-color 0.15s',
  },
  tableRowHover: {
    backgroundColor: '#e3f2fd',
  },
  td: {
    padding: '10px 12px',
    fontSize: '13px',
    color: '#333',
  },
  coBadge: {
    display: 'inline-block',
    marginLeft: '6px',
    padding: '1px 6px',
    fontSize: '10px',
    fontWeight: 600,
    backgroundColor: '#fff3e0',
    color: '#e65100',
    borderRadius: '4px',
  },
  liveCOBadge: {
    display: 'inline-block',
    marginLeft: '6px',
    padding: '1px 6px',
    fontSize: '10px',
    fontWeight: 600,
    backgroundColor: '#e3f2fd',
    color: '#1565c0',
    borderRadius: '4px',
  },
  emptyState: {
    padding: '60px',
    textAlign: 'center',
    color: '#999',
    fontSize: '16px',
    backgroundColor: 'white',
    borderRadius: '8px',
  },
  actionButtons: {
    display: 'flex',
    gap: '4px',
    justifyContent: 'center',
  },
  actionButton: {
    padding: '4px 8px',
    fontSize: '11px',
    fontWeight: 500,
    border: 'none',
    borderRadius: '4px',
    cursor: 'pointer',
    transition: 'opacity 0.2s',
  },
};

export default SalesDashboard;
