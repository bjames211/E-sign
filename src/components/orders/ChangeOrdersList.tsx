import React, { useState, useEffect } from 'react';
import { ChangeOrder, ChangeOrderStatus } from '../../types/changeOrder';
import { collection, getDocs, query, orderBy, Timestamp } from 'firebase/firestore';
import { db } from '../../config/firebase';
import { ChangeOrderDetails } from './ChangeOrderDetails';

interface ChangeOrdersListProps {
  onNavigateToChangeOrder?: (orderId: string, changeOrderId?: string) => void;
}

const STATUS_STYLES: Record<ChangeOrderStatus, { bg: string; color: string; label: string }> = {
  draft: { bg: '#f5f5f5', color: '#666', label: 'Draft' },
  pending_signature: { bg: '#e3f2fd', color: '#1565c0', label: 'Awaiting Signature' },
  signed: { bg: '#e8f5e9', color: '#2e7d32', label: 'Signed' },
  cancelled: { bg: '#ffebee', color: '#c62828', label: 'Cancelled' },
};

const STATUS_FILTERS: { value: ChangeOrderStatus | 'all'; label: string }[] = [
  { value: 'all', label: 'All' },
  { value: 'draft', label: 'Draft' },
  { value: 'pending_signature', label: 'Awaiting Signature' },
  { value: 'signed', label: 'Signed' },
  { value: 'cancelled', label: 'Cancelled' },
];

function formatDate(timestamp: Timestamp | any | undefined): string {
  if (!timestamp) return '-';
  try {
    let date: Date;
    if (timestamp.toDate && typeof timestamp.toDate === 'function') {
      date = timestamp.toDate();
    } else if (timestamp.seconds) {
      date = new Date(timestamp.seconds * 1000);
    } else if (timestamp instanceof Date) {
      date = timestamp;
    } else if (typeof timestamp === 'number') {
      date = new Date(timestamp);
    } else {
      return '-';
    }
    return date.toLocaleDateString('en-US', {
      month: 'short',
      day: 'numeric',
      year: 'numeric',
      hour: '2-digit',
      minute: '2-digit',
    });
  } catch {
    return '-';
  }
}

function formatDiff(value: number): string {
  if (value === 0) return '$0';
  const sign = value > 0 ? '+' : '';
  return `${sign}$${value.toLocaleString()}`;
}

export function ChangeOrdersList({ onNavigateToChangeOrder }: ChangeOrdersListProps) {
  const [changeOrders, setChangeOrders] = useState<ChangeOrder[]>([]);
  const [filteredChangeOrders, setFilteredChangeOrders] = useState<ChangeOrder[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [statusFilter, setStatusFilter] = useState<ChangeOrderStatus | 'all'>('all');
  const [searchTerm, setSearchTerm] = useState('');
  const [selectedChangeOrder, setSelectedChangeOrder] = useState<ChangeOrder | null>(null);

  useEffect(() => {
    loadChangeOrders();
  }, []);

  useEffect(() => {
    filterChangeOrders();
  }, [changeOrders, statusFilter, searchTerm]);

  const loadChangeOrders = async () => {
    setLoading(true);
    setError(null);
    try {
      const q = query(
        collection(db, 'change_orders'),
        orderBy('createdAt', 'desc')
      );
      const querySnapshot = await getDocs(q);
      const data = querySnapshot.docs.map((doc) => ({
        id: doc.id,
        ...doc.data(),
      })) as ChangeOrder[];
      setChangeOrders(data);
    } catch (err) {
      console.error('Failed to load change orders:', err);
      setError('Failed to load change orders');
    } finally {
      setLoading(false);
    }
  };

  const filterChangeOrders = () => {
    let filtered = [...changeOrders];

    // Filter by status
    if (statusFilter !== 'all') {
      filtered = filtered.filter((co) => co.status === statusFilter);
    }

    // Filter by search term
    if (searchTerm.trim()) {
      const term = searchTerm.toLowerCase();
      filtered = filtered.filter(
        (co) =>
          co.changeOrderNumber.toLowerCase().includes(term) ||
          co.orderNumber.toLowerCase().includes(term) ||
          co.reason.toLowerCase().includes(term)
      );
    }

    setFilteredChangeOrders(filtered);
  };

  const getStatusCounts = () => {
    const counts: Record<ChangeOrderStatus | 'all', number> = {
      all: changeOrders.length,
      draft: 0,
      pending_signature: 0,
      signed: 0,
      cancelled: 0,
    };

    changeOrders.forEach((co) => {
      counts[co.status]++;
    });

    return counts;
  };

  const handleRowClick = (changeOrder: ChangeOrder) => {
    setSelectedChangeOrder(changeOrder);
  };

  const handleEditChangeOrder = () => {
    if (selectedChangeOrder && onNavigateToChangeOrder) {
      onNavigateToChangeOrder(selectedChangeOrder.orderId, selectedChangeOrder.id);
      setSelectedChangeOrder(null);
    }
  };

  const statusCounts = getStatusCounts();

  if (loading) {
    return (
      <div style={styles.container}>
        <div style={styles.loading}>Loading change orders...</div>
      </div>
    );
  }

  return (
    <div style={styles.container}>
      <div style={styles.header}>
        <div>
          <h2 style={styles.title}>Change Orders</h2>
          <p style={styles.subtitle}>
            {changeOrders.length} total change orders - Track and audit all order modifications
          </p>
        </div>
        <button onClick={loadChangeOrders} style={styles.refreshButton}>
          Refresh
        </button>
      </div>

      {error && <div style={styles.error}>{error}</div>}

      {/* Summary Cards */}
      <div style={styles.summaryCards}>
        <div style={styles.summaryCard}>
          <div style={styles.summaryValue}>{statusCounts.draft}</div>
          <div style={styles.summaryLabel}>Draft</div>
        </div>
        <div style={styles.summaryCard}>
          <div style={styles.summaryValue}>{statusCounts.pending_signature}</div>
          <div style={styles.summaryLabel}>Awaiting Signature</div>
        </div>
        <div style={styles.summaryCard}>
          <div style={styles.summaryValue}>{statusCounts.signed}</div>
          <div style={styles.summaryLabel}>Signed</div>
        </div>
        <div style={{ ...styles.summaryCard, borderColor: '#ffcdd2' }}>
          <div style={styles.summaryValue}>{statusCounts.cancelled}</div>
          <div style={styles.summaryLabel}>Cancelled</div>
        </div>
      </div>

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
          placeholder="Search by CO#, Order#, or reason..."
          style={styles.searchInput}
        />
      </div>

      {/* Table */}
      {filteredChangeOrders.length === 0 ? (
        <div style={styles.emptyState}>
          <p>No change orders found</p>
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
        <div style={styles.tableContainer}>
          <table style={styles.table}>
            <thead>
              <tr>
                <th style={styles.th}>Change Order #</th>
                <th style={styles.th}>Order #</th>
                <th style={styles.th}>Status</th>
                <th style={styles.th}>Reason</th>
                <th style={styles.th}>Subtotal Change</th>
                <th style={styles.th}>Deposit Change</th>
                <th style={styles.th}>Customer/Building</th>
                <th style={styles.th}>Created</th>
              </tr>
            </thead>
            <tbody>
              {filteredChangeOrders.map((co) => {
                const statusStyle = STATUS_STYLES[co.status];
                const hasCustomerChanges = co.customerChanges && co.customerChanges.length > 0;
                const hasBuildingChanges = co.buildingChanges && co.buildingChanges.length > 0;

                return (
                  <tr
                    key={co.id}
                    style={styles.tr}
                    onClick={() => handleRowClick(co)}
                  >
                    <td style={styles.td}>
                      <span style={styles.coNumber}>{co.changeOrderNumber}</span>
                    </td>
                    <td style={styles.td}>{co.orderNumber}</td>
                    <td style={styles.td}>
                      <span
                        style={{
                          ...styles.statusBadge,
                          backgroundColor: statusStyle.bg,
                          color: statusStyle.color,
                        }}
                      >
                        {statusStyle.label}
                      </span>
                    </td>
                    <td style={styles.tdReason}>
                      <span style={styles.reasonText}>{co.reason}</span>
                    </td>
                    <td style={styles.td}>
                      <span
                        style={{
                          ...styles.diffValue,
                          color:
                            co.differences.subtotalDiff === 0
                              ? '#666'
                              : co.differences.subtotalDiff > 0
                              ? '#2e7d32'
                              : '#c62828',
                        }}
                      >
                        {formatDiff(co.differences.subtotalDiff)}
                      </span>
                    </td>
                    <td style={styles.td}>
                      <span
                        style={{
                          ...styles.diffValue,
                          color:
                            co.differences.depositDiff === 0
                              ? '#666'
                              : co.differences.depositDiff > 0
                              ? '#2e7d32'
                              : '#c62828',
                        }}
                      >
                        {formatDiff(co.differences.depositDiff)}
                      </span>
                    </td>
                    <td style={styles.td}>
                      <div style={styles.changeTags}>
                        {hasCustomerChanges && (
                          <span style={styles.changeTag}>Customer</span>
                        )}
                        {hasBuildingChanges && (
                          <span style={styles.changeTag}>Building</span>
                        )}
                        {!hasCustomerChanges && !hasBuildingChanges && (
                          <span style={styles.noChanges}>-</span>
                        )}
                      </div>
                    </td>
                    <td style={styles.td}>{formatDate(co.createdAt)}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}

      {/* Change Order Details Modal */}
      {selectedChangeOrder && (
        <ChangeOrderDetails
          changeOrder={selectedChangeOrder}
          onClose={() => setSelectedChangeOrder(null)}
          onEdit={handleEditChangeOrder}
        />
      )}
    </div>
  );
}

const styles: Record<string, React.CSSProperties> = {
  container: {
    maxWidth: '1400px',
    margin: '0 auto',
    padding: '24px',
  },
  header: {
    display: 'flex',
    justifyContent: 'space-between',
    alignItems: 'flex-start',
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
  refreshButton: {
    padding: '8px 16px',
    backgroundColor: '#f5f5f5',
    color: '#333',
    border: '1px solid #ddd',
    borderRadius: '4px',
    fontSize: '14px',
    cursor: 'pointer',
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
  summaryCards: {
    display: 'grid',
    gridTemplateColumns: 'repeat(4, 1fr)',
    gap: '16px',
    marginBottom: '24px',
  },
  summaryCard: {
    backgroundColor: 'white',
    borderRadius: '8px',
    padding: '20px',
    textAlign: 'center',
    border: '1px solid #e0e0e0',
    borderLeft: '4px solid #2196F3',
  },
  summaryValue: {
    fontSize: '32px',
    fontWeight: 600,
    color: '#333',
  },
  summaryLabel: {
    fontSize: '14px',
    color: '#666',
    marginTop: '4px',
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
    width: '300px',
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
  tableContainer: {
    backgroundColor: 'white',
    borderRadius: '8px',
    overflow: 'hidden',
    boxShadow: '0 1px 3px rgba(0,0,0,0.1)',
  },
  table: {
    width: '100%',
    borderCollapse: 'collapse',
  },
  th: {
    padding: '14px 16px',
    textAlign: 'left',
    backgroundColor: '#f5f5f5',
    borderBottom: '2px solid #e0e0e0',
    fontSize: '13px',
    fontWeight: 600,
    color: '#333',
  },
  tr: {
    cursor: 'pointer',
    transition: 'background-color 0.15s',
  },
  td: {
    padding: '14px 16px',
    borderBottom: '1px solid #eee',
    fontSize: '14px',
    color: '#333',
  },
  tdReason: {
    padding: '14px 16px',
    borderBottom: '1px solid #eee',
    fontSize: '14px',
    color: '#333',
    maxWidth: '250px',
  },
  coNumber: {
    fontWeight: 600,
    color: '#1565c0',
  },
  statusBadge: {
    padding: '4px 10px',
    borderRadius: '12px',
    fontSize: '12px',
    fontWeight: 500,
    display: 'inline-block',
  },
  reasonText: {
    display: 'block',
    overflow: 'hidden',
    textOverflow: 'ellipsis',
    whiteSpace: 'nowrap',
  },
  diffValue: {
    fontWeight: 500,
  },
  changeTags: {
    display: 'flex',
    gap: '4px',
    flexWrap: 'wrap',
  },
  changeTag: {
    padding: '2px 8px',
    backgroundColor: '#e3f2fd',
    color: '#1565c0',
    borderRadius: '4px',
    fontSize: '11px',
    fontWeight: 500,
  },
  noChanges: {
    color: '#999',
  },
};
