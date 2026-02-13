import React, { useState, useEffect, useMemo } from 'react';
import { ChangeOrder, ChangeOrderStatus } from '../../types/changeOrder';
import { Order } from '../../types/order';
import { collection, getDocs, query, orderBy, Timestamp } from 'firebase/firestore';
import { db } from '../../config/firebase';
import { ChangeOrderDetails } from './ChangeOrderDetails';

interface ChangeOrdersListProps {
  onNavigateToChangeOrder?: (orderId: string, changeOrderId?: string) => void;
}

const STATUS_STYLES: Record<string, { bg: string; color: string; label: string }> = {
  draft: { bg: '#f5f5f5', color: '#666', label: 'Draft' },
  pending_signature: { bg: '#e3f2fd', color: '#1565c0', label: 'Awaiting Signature' },
  signed: { bg: '#e8f5e9', color: '#2e7d32', label: 'Signed' },
  cancelled: { bg: '#ffebee', color: '#c62828', label: 'Cancelled' },
  superseded: { bg: '#f5f5f5', color: '#999', label: 'Superseded' },
};

const STATUS_FILTERS: { value: ChangeOrderStatus | 'all'; label: string }[] = [
  { value: 'all', label: 'All' },
  { value: 'draft', label: 'Draft' },
  { value: 'pending_signature', label: 'Awaiting Signature' },
  { value: 'signed', label: 'Signed' },
  { value: 'cancelled', label: 'Cancelled' },
  { value: 'superseded', label: 'Superseded' },
];

type SortField = 'changeOrderNumber' | 'createdAt' | 'orderNumber' | 'status' | 'depositDiff';
type SortDirection = 'asc' | 'desc';

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
    });
  } catch {
    return '-';
  }
}

function formatCurrency(value: number): string {
  return new Intl.NumberFormat('en-US', {
    style: 'currency',
    currency: 'USD',
    minimumFractionDigits: 0,
    maximumFractionDigits: 0,
  }).format(value);
}

function formatDiff(value: number): string {
  if (value === 0) return '$0';
  const sign = value > 0 ? '+' : '';
  return `${sign}${formatCurrency(value)}`;
}

// Extract CO number for sorting (CO-00001 -> 1)
function extractCONumber(coNumber: string): number {
  const match = coNumber.match(/CO-(\d+)/);
  return match ? parseInt(match[1], 10) : 0;
}

export function ChangeOrdersList({ onNavigateToChangeOrder }: ChangeOrdersListProps) {
  const [changeOrders, setChangeOrders] = useState<ChangeOrder[]>([]);
  const [orders, setOrders] = useState<Record<string, Order>>({});
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [statusFilter, setStatusFilter] = useState<ChangeOrderStatus | 'all'>('all');
  const [searchTerm, setSearchTerm] = useState('');
  const [selectedChangeOrder, setSelectedChangeOrder] = useState<ChangeOrder | null>(null);

  // Sorting
  const [sortField, setSortField] = useState<SortField>('changeOrderNumber');
  const [sortDirection, setSortDirection] = useState<SortDirection>('desc');

  // Additional filters
  const [changeTypeFilter, setChangeTypeFilter] = useState<'all' | 'price' | 'customer' | 'building'>('all');
  const [dateFilter, setDateFilter] = useState<'all' | 'today' | 'week' | 'month'>('all');

  useEffect(() => {
    loadData();
  }, []);

  const loadData = async () => {
    setLoading(true);
    setError(null);
    try {
      // Load change orders
      const coQuery = query(
        collection(db, 'change_orders'),
        orderBy('createdAt', 'desc')
      );
      const coSnapshot = await getDocs(coQuery);
      const coData = coSnapshot.docs.map((doc) => ({
        id: doc.id,
        ...doc.data(),
      })) as ChangeOrder[];
      setChangeOrders(coData);

      // Load orders to get customer names
      const ordersQuery = query(collection(db, 'orders'));
      const ordersSnapshot = await getDocs(ordersQuery);
      const ordersMap: Record<string, Order> = {};
      ordersSnapshot.docs.forEach((doc) => {
        ordersMap[doc.id] = { id: doc.id, ...doc.data() } as Order;
      });
      setOrders(ordersMap);
    } catch (err) {
      console.error('Failed to load change orders:', err);
      setError('Failed to load change orders');
    } finally {
      setLoading(false);
    }
  };

  // Get customer name for a change order
  const getCustomerName = (co: ChangeOrder): string => {
    const order = orders[co.orderId];
    if (!order?.customer) return '-';
    const firstName = order.customer.firstName || '';
    const lastName = order.customer.lastName || '';
    return `${firstName} ${lastName}`.trim() || '-';
  };

  // Filter and sort change orders
  const filteredAndSortedChangeOrders = useMemo(() => {
    let filtered = [...changeOrders];

    // Filter by status
    if (statusFilter !== 'all') {
      filtered = filtered.filter((co) => co.status === statusFilter);
    }

    // Filter by change type
    if (changeTypeFilter !== 'all') {
      filtered = filtered.filter((co) => {
        const hasCustomerChanges = co.customerChanges && co.customerChanges.length > 0;
        const hasBuildingChanges = co.buildingChanges && co.buildingChanges.length > 0;
        const hasPriceChanges = co.differences.subtotalDiff !== 0 || co.differences.depositDiff !== 0;

        switch (changeTypeFilter) {
          case 'price': return hasPriceChanges;
          case 'customer': return hasCustomerChanges;
          case 'building': return hasBuildingChanges;
          default: return true;
        }
      });
    }

    // Filter by date
    if (dateFilter !== 'all') {
      const now = new Date();
      const startOfDay = new Date(now.getFullYear(), now.getMonth(), now.getDate());
      const startOfWeek = new Date(startOfDay);
      startOfWeek.setDate(startOfWeek.getDate() - startOfWeek.getDay());
      const startOfMonth = new Date(now.getFullYear(), now.getMonth(), 1);

      filtered = filtered.filter((co) => {
        if (!co.createdAt) return false;
        const coDate = co.createdAt.toDate ? co.createdAt.toDate() : new Date((co.createdAt as any).seconds * 1000);

        switch (dateFilter) {
          case 'today': return coDate >= startOfDay;
          case 'week': return coDate >= startOfWeek;
          case 'month': return coDate >= startOfMonth;
          default: return true;
        }
      });
    }

    // Filter by search term (including customer name)
    if (searchTerm.trim()) {
      const term = searchTerm.toLowerCase();
      filtered = filtered.filter((co) => {
        const customerName = getCustomerName(co).toLowerCase();
        return (
          co.changeOrderNumber.toLowerCase().includes(term) ||
          co.orderNumber.toLowerCase().includes(term) ||
          co.reason.toLowerCase().includes(term) ||
          customerName.includes(term)
        );
      });
    }

    // Sort
    filtered.sort((a, b) => {
      let comparison = 0;

      switch (sortField) {
        case 'changeOrderNumber':
          comparison = extractCONumber(a.changeOrderNumber) - extractCONumber(b.changeOrderNumber);
          break;
        case 'orderNumber':
          comparison = a.orderNumber.localeCompare(b.orderNumber);
          break;
        case 'status':
          comparison = a.status.localeCompare(b.status);
          break;
        case 'depositDiff':
          comparison = a.differences.depositDiff - b.differences.depositDiff;
          break;
        case 'createdAt':
        default:
          const aTime = a.createdAt?.seconds || 0;
          const bTime = b.createdAt?.seconds || 0;
          comparison = aTime - bTime;
          break;
      }

      return sortDirection === 'desc' ? -comparison : comparison;
    });

    return filtered;
  }, [changeOrders, orders, statusFilter, changeTypeFilter, dateFilter, searchTerm, sortField, sortDirection]);

  const handleSort = (field: SortField) => {
    if (sortField === field) {
      setSortDirection(sortDirection === 'asc' ? 'desc' : 'asc');
    } else {
      setSortField(field);
      setSortDirection('desc');
    }
  };

  const getSortIcon = (field: SortField) => {
    if (sortField !== field) return '↕';
    return sortDirection === 'desc' ? '↓' : '↑';
  };

  const getStatusCounts = () => {
    const counts: Record<string, number> = {
      all: changeOrders.length,
      draft: 0,
      pending_signature: 0,
      signed: 0,
      cancelled: 0,
      superseded: 0,
    };

    changeOrders.forEach((co) => {
      if (counts[co.status] !== undefined) {
        counts[co.status]++;
      }
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

  // Calculate totals for filtered results
  const totals = useMemo(() => {
    return filteredAndSortedChangeOrders.reduce((acc, co) => ({
      subtotalChange: acc.subtotalChange + co.differences.subtotalDiff,
      depositChange: acc.depositChange + co.differences.depositDiff,
    }), { subtotalChange: 0, depositChange: 0 });
  }, [filteredAndSortedChangeOrders]);

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
            {changeOrders.length} total change orders
          </p>
        </div>
        <button onClick={loadData} style={styles.refreshButton}>
          ↻ Refresh
        </button>
      </div>

      {error && <div style={styles.error}>{error}</div>}

      {/* Summary Cards */}
      <div style={styles.summaryCards}>
        <div style={{ ...styles.summaryCard, borderLeftColor: '#ff9800' }}>
          <div style={styles.summaryValue}>{statusCounts.draft}</div>
          <div style={styles.summaryLabel}>Draft</div>
        </div>
        <div style={{ ...styles.summaryCard, borderLeftColor: '#2196F3' }}>
          <div style={styles.summaryValue}>{statusCounts.pending_signature}</div>
          <div style={styles.summaryLabel}>Awaiting Signature</div>
        </div>
        <div style={{ ...styles.summaryCard, borderLeftColor: '#4caf50' }}>
          <div style={styles.summaryValue}>{statusCounts.signed}</div>
          <div style={styles.summaryLabel}>Signed</div>
        </div>
        <div style={{ ...styles.summaryCard, borderLeftColor: '#f44336' }}>
          <div style={styles.summaryValue}>{statusCounts.cancelled + statusCounts.superseded}</div>
          <div style={styles.summaryLabel}>Cancelled/Superseded</div>
        </div>
      </div>

      {/* Filters Row 1: Status */}
      <div style={styles.filtersSection}>
        <div style={styles.filterGroup}>
          <label style={styles.filterLabel}>Status:</label>
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
                <span style={styles.filterCount}>({statusCounts[filter.value] || 0})</span>
              </button>
            ))}
          </div>
        </div>
      </div>

      {/* Filters Row 2: Additional Filters */}
      <div style={styles.filtersSection}>
        <div style={styles.filterGroup}>
          <label style={styles.filterLabel}>Change Type:</label>
          <select
            value={changeTypeFilter}
            onChange={(e) => setChangeTypeFilter(e.target.value as any)}
            style={styles.select}
          >
            <option value="all">All Types</option>
            <option value="price">Price Changes</option>
            <option value="customer">Customer Changes</option>
            <option value="building">Building Changes</option>
          </select>
        </div>

        <div style={styles.filterGroup}>
          <label style={styles.filterLabel}>Date:</label>
          <select
            value={dateFilter}
            onChange={(e) => setDateFilter(e.target.value as any)}
            style={styles.select}
          >
            <option value="all">All Time</option>
            <option value="today">Today</option>
            <option value="week">This Week</option>
            <option value="month">This Month</option>
          </select>
        </div>

        <div style={styles.filterGroup}>
          <label style={styles.filterLabel}>Sort By:</label>
          <select
            value={`${sortField}-${sortDirection}`}
            onChange={(e) => {
              const [field, dir] = e.target.value.split('-') as [SortField, SortDirection];
              setSortField(field);
              setSortDirection(dir);
            }}
            style={styles.select}
          >
            <option value="changeOrderNumber-desc">CO# (Newest First)</option>
            <option value="changeOrderNumber-asc">CO# (Oldest First)</option>
            <option value="createdAt-desc">Date (Newest First)</option>
            <option value="createdAt-asc">Date (Oldest First)</option>
            <option value="orderNumber-asc">Order # (A-Z)</option>
            <option value="orderNumber-desc">Order # (Z-A)</option>
            <option value="depositDiff-desc">Deposit Change (High to Low)</option>
            <option value="depositDiff-asc">Deposit Change (Low to High)</option>
          </select>
        </div>

        <div style={{ ...styles.filterGroup, flex: 1 }}>
          <label style={styles.filterLabel}>Search:</label>
          <input
            type="text"
            value={searchTerm}
            onChange={(e) => setSearchTerm(e.target.value)}
            placeholder="Search CO#, Order#, customer, reason..."
            style={styles.searchInput}
          />
        </div>
      </div>

      {/* Results Info */}
      <div style={styles.resultsInfo}>
        <span>
          Showing <strong>{filteredAndSortedChangeOrders.length}</strong> of {changeOrders.length} change orders
        </span>
        {filteredAndSortedChangeOrders.length > 0 && (
          <span style={styles.totalsSummary}>
            Total Impact:
            <span style={{ color: totals.subtotalChange >= 0 ? '#2e7d32' : '#c62828', marginLeft: '8px' }}>
              Subtotal {formatDiff(totals.subtotalChange)}
            </span>
            <span style={{ color: totals.depositChange >= 0 ? '#2e7d32' : '#c62828', marginLeft: '16px' }}>
              Deposit {formatDiff(totals.depositChange)}
            </span>
          </span>
        )}
      </div>

      {/* Table */}
      {filteredAndSortedChangeOrders.length === 0 ? (
        <div style={styles.emptyState}>
          <p>No change orders found</p>
          {(statusFilter !== 'all' || changeTypeFilter !== 'all' || dateFilter !== 'all' || searchTerm) && (
            <button
              onClick={() => {
                setStatusFilter('all');
                setChangeTypeFilter('all');
                setDateFilter('all');
                setSearchTerm('');
              }}
              style={styles.clearFilterButton}
            >
              Clear all filters
            </button>
          )}
        </div>
      ) : (
        <div style={styles.tableContainer}>
          <table style={styles.table}>
            <thead>
              <tr>
                <th style={styles.th} onClick={() => handleSort('changeOrderNumber')}>
                  CO # {getSortIcon('changeOrderNumber')}
                </th>
                <th style={styles.th} onClick={() => handleSort('orderNumber')}>
                  Order # {getSortIcon('orderNumber')}
                </th>
                <th style={styles.th}>Customer</th>
                <th style={styles.th} onClick={() => handleSort('status')}>
                  Status {getSortIcon('status')}
                </th>
                <th style={styles.th}>Reason</th>
                <th style={styles.thRight}>New Total</th>
                <th style={styles.thRight}>Subtotal Δ</th>
                <th style={styles.thRight} onClick={() => handleSort('depositDiff')}>
                  Deposit Δ {getSortIcon('depositDiff')}
                </th>
                <th style={styles.th}>Changes</th>
                <th style={styles.th} onClick={() => handleSort('createdAt')}>
                  Created {getSortIcon('createdAt')}
                </th>
              </tr>
            </thead>
            <tbody>
              {filteredAndSortedChangeOrders.map((co) => {
                const statusStyle = STATUS_STYLES[co.status] || STATUS_STYLES.draft;
                const hasCustomerChanges = co.customerChanges && co.customerChanges.length > 0;
                const hasBuildingChanges = co.buildingChanges && co.buildingChanges.length > 0;
                const customerName = getCustomerName(co);

                return (
                  <tr
                    key={co.id}
                    style={styles.tr}
                    onClick={() => handleRowClick(co)}
                    onMouseEnter={(e) => e.currentTarget.style.backgroundColor = '#f8f9fa'}
                    onMouseLeave={(e) => e.currentTarget.style.backgroundColor = 'transparent'}
                  >
                    <td style={styles.td}>
                      <span style={styles.coNumber}>{co.changeOrderNumber}</span>
                    </td>
                    <td style={styles.td}>
                      <span style={styles.orderNumber}>{co.orderNumber}</span>
                    </td>
                    <td style={styles.td}>
                      <span style={styles.customerName}>{customerName}</span>
                    </td>
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
                      <span style={styles.reasonText} title={co.reason}>{co.reason}</span>
                    </td>
                    <td style={styles.tdRight}>
                      <span style={styles.totalValue}>
                        {formatCurrency(co.newValues.subtotalBeforeTax + (co.newValues.extraMoneyFluff || 0))}
                      </span>
                    </td>
                    <td style={styles.tdRight}>
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
                    <td style={styles.tdRight}>
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
                          <span style={styles.changeTagCustomer}>Customer</span>
                        )}
                        {hasBuildingChanges && (
                          <span style={styles.changeTagBuilding}>Building</span>
                        )}
                        {co.differences.subtotalDiff !== 0 && (
                          <span style={styles.changeTagPrice}>Price</span>
                        )}
                        {!hasCustomerChanges && !hasBuildingChanges && co.differences.subtotalDiff === 0 && (
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
    maxWidth: '1600px',
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
  filtersSection: {
    display: 'flex',
    gap: '16px',
    marginBottom: '16px',
    flexWrap: 'wrap',
    alignItems: 'flex-end',
  },
  filterGroup: {
    display: 'flex',
    flexDirection: 'column',
    gap: '4px',
  },
  filterLabel: {
    fontSize: '12px',
    fontWeight: 500,
    color: '#666',
    textTransform: 'uppercase',
  },
  statusFilters: {
    display: 'flex',
    gap: '6px',
    flexWrap: 'wrap',
  },
  filterButton: {
    padding: '6px 12px',
    backgroundColor: 'white',
    border: '1px solid #ddd',
    borderRadius: '16px',
    fontSize: '13px',
    cursor: 'pointer',
    display: 'flex',
    alignItems: 'center',
    gap: '4px',
    transition: 'all 0.2s',
  },
  filterButtonActive: {
    backgroundColor: '#2196F3',
    borderColor: '#2196F3',
    color: 'white',
  },
  filterCount: {
    fontSize: '11px',
    opacity: 0.8,
  },
  select: {
    padding: '8px 12px',
    border: '1px solid #ddd',
    borderRadius: '4px',
    fontSize: '14px',
    backgroundColor: 'white',
    minWidth: '160px',
  },
  searchInput: {
    padding: '8px 12px',
    border: '1px solid #ddd',
    borderRadius: '4px',
    fontSize: '14px',
    width: '100%',
    minWidth: '250px',
  },
  resultsInfo: {
    display: 'flex',
    justifyContent: 'space-between',
    alignItems: 'center',
    padding: '12px 16px',
    backgroundColor: '#f5f5f5',
    borderRadius: '8px 8px 0 0',
    fontSize: '14px',
    color: '#666',
  },
  totalsSummary: {
    fontWeight: 500,
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
    borderRadius: '0 0 8px 8px',
    overflow: 'auto',
    boxShadow: '0 1px 3px rgba(0,0,0,0.1)',
  },
  table: {
    width: '100%',
    borderCollapse: 'collapse',
    minWidth: '1200px',
  },
  th: {
    padding: '12px 14px',
    textAlign: 'left',
    backgroundColor: '#fafafa',
    borderBottom: '2px solid #e0e0e0',
    fontSize: '12px',
    fontWeight: 600,
    color: '#555',
    textTransform: 'uppercase',
    cursor: 'pointer',
    whiteSpace: 'nowrap',
    userSelect: 'none',
  },
  thRight: {
    padding: '12px 14px',
    textAlign: 'right',
    backgroundColor: '#fafafa',
    borderBottom: '2px solid #e0e0e0',
    fontSize: '12px',
    fontWeight: 600,
    color: '#555',
    textTransform: 'uppercase',
    cursor: 'pointer',
    whiteSpace: 'nowrap',
    userSelect: 'none',
  },
  tr: {
    cursor: 'pointer',
    transition: 'background-color 0.15s',
  },
  td: {
    padding: '12px 14px',
    borderBottom: '1px solid #eee',
    fontSize: '13px',
    color: '#333',
    verticalAlign: 'middle',
  },
  tdRight: {
    padding: '12px 14px',
    borderBottom: '1px solid #eee',
    fontSize: '13px',
    color: '#333',
    textAlign: 'right',
    verticalAlign: 'middle',
  },
  tdReason: {
    padding: '12px 14px',
    borderBottom: '1px solid #eee',
    fontSize: '13px',
    color: '#333',
    maxWidth: '200px',
    verticalAlign: 'middle',
  },
  coNumber: {
    fontWeight: 600,
    color: '#1565c0',
    fontFamily: 'monospace',
  },
  orderNumber: {
    color: '#666',
    fontFamily: 'monospace',
  },
  customerName: {
    fontWeight: 500,
  },
  statusBadge: {
    padding: '4px 10px',
    borderRadius: '12px',
    fontSize: '11px',
    fontWeight: 500,
    display: 'inline-block',
    whiteSpace: 'nowrap',
  },
  reasonText: {
    display: 'block',
    overflow: 'hidden',
    textOverflow: 'ellipsis',
    whiteSpace: 'nowrap',
  },
  totalValue: {
    fontWeight: 600,
    color: '#333',
  },
  diffValue: {
    fontWeight: 600,
    fontFamily: 'monospace',
  },
  changeTags: {
    display: 'flex',
    gap: '4px',
    flexWrap: 'wrap',
  },
  changeTagCustomer: {
    padding: '2px 6px',
    backgroundColor: '#e8f5e9',
    color: '#2e7d32',
    borderRadius: '4px',
    fontSize: '10px',
    fontWeight: 600,
    textTransform: 'uppercase',
  },
  changeTagBuilding: {
    padding: '2px 6px',
    backgroundColor: '#fff3e0',
    color: '#e65100',
    borderRadius: '4px',
    fontSize: '10px',
    fontWeight: 600,
    textTransform: 'uppercase',
  },
  changeTagPrice: {
    padding: '2px 6px',
    backgroundColor: '#e3f2fd',
    color: '#1565c0',
    borderRadius: '4px',
    fontSize: '10px',
    fontWeight: 600,
    textTransform: 'uppercase',
  },
  noChanges: {
    color: '#999',
  },
};
