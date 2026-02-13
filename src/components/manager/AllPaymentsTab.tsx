import React, { useState, useEffect, useCallback } from 'react';
import {
  LedgerEntryStatus,
  LedgerTransactionType,
  TRANSACTION_TYPE_LABELS,
  TRANSACTION_TYPE_COLORS,
  PAYMENT_METHOD_LABELS,
  formatCurrency,
  AllPaymentsFilters,
} from '../../types/payment';
import {
  getAllPayments,
  EnrichedLedgerEntry,
  exportPaymentsToCSV,
  downloadCSV,
} from '../../services/paymentService';

interface AllPaymentsTabProps {
  onSelectPayment: (entry: EnrichedLedgerEntry) => void;
  onApprove?: (entry: EnrichedLedgerEntry) => void;
}

// Status badge component
const StatusBadge: React.FC<{ status: LedgerEntryStatus }> = ({ status }) => {
  const statusConfig: Record<LedgerEntryStatus, { bg: string; color: string; label: string }> = {
    pending: { bg: '#fff3e0', color: '#e65100', label: 'Pending' },
    verified: { bg: '#e8f5e9', color: '#2e7d32', label: 'Verified' },
    approved: { bg: '#e8f5e9', color: '#2e7d32', label: 'Approved' },
    voided: { bg: '#ffebee', color: '#c62828', label: 'Voided' },
  };

  const config = statusConfig[status] || statusConfig.pending;

  return (
    <span
      style={{
        padding: '2px 8px',
        borderRadius: '12px',
        fontSize: '12px',
        fontWeight: 500,
        backgroundColor: config.bg,
        color: config.color,
      }}
    >
      {config.label}
    </span>
  );
};

// Type badge component
const TypeBadge: React.FC<{ type: LedgerTransactionType }> = ({ type }) => {
  const config = TRANSACTION_TYPE_COLORS[type] || { bg: '#f5f5f5', color: '#666' };
  const label = TRANSACTION_TYPE_LABELS[type] || type;

  return (
    <span
      style={{
        padding: '2px 8px',
        borderRadius: '12px',
        fontSize: '12px',
        fontWeight: 500,
        backgroundColor: config.bg,
        color: config.color,
      }}
    >
      {label}
    </span>
  );
};

export function AllPaymentsTab({ onSelectPayment, onApprove }: AllPaymentsTabProps) {
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [entries, setEntries] = useState<EnrichedLedgerEntry[]>([]);
  const [total, setTotal] = useState(0);
  const [hasMore, setHasMore] = useState(false);

  // Filter state
  const [filters, setFilters] = useState<AllPaymentsFilters>({
    status: 'all',
    transactionType: 'all',
    search: '',
    limit: 25,
    offset: 0,
  });

  // Date range state
  const [startDate, setStartDate] = useState('');
  const [endDate, setEndDate] = useState('');

  // Debounced search
  const [searchInput, setSearchInput] = useState('');

  // Load data
  const loadData = useCallback(async () => {
    setLoading(true);
    setError(null);

    try {
      const filtersToUse: AllPaymentsFilters = {
        ...filters,
        startDate: startDate ? new Date(startDate) : undefined,
        endDate: endDate ? new Date(endDate) : undefined,
      };

      const response = await getAllPayments(filtersToUse);
      setEntries(response.entries);
      setTotal(response.total);
      setHasMore(response.hasMore);
    } catch (err: any) {
      console.error('Error loading payments:', err);
      setError(err.message || 'Failed to load payments');
    } finally {
      setLoading(false);
    }
  }, [filters, startDate, endDate]);

  // Initial load
  useEffect(() => {
    loadData();
  }, [loadData]);

  // Debounce search input
  useEffect(() => {
    const timer = setTimeout(() => {
      setFilters((prev) => ({ ...prev, search: searchInput, offset: 0 }));
    }, 300);

    return () => clearTimeout(timer);
  }, [searchInput]);

  // Handle filter changes
  const handleStatusChange = (status: string) => {
    setFilters((prev) => ({
      ...prev,
      status: status as LedgerEntryStatus | 'all',
      offset: 0,
    }));
  };

  const handleTypeChange = (type: string) => {
    setFilters((prev) => ({
      ...prev,
      transactionType: type as LedgerTransactionType | 'all',
      offset: 0,
    }));
  };

  const handleDateChange = () => {
    // Reset offset when date changes
    setFilters((prev) => ({ ...prev, offset: 0 }));
  };

  // Pagination
  const handlePrevPage = () => {
    setFilters((prev) => ({
      ...prev,
      offset: Math.max(0, (prev.offset || 0) - (prev.limit || 25)),
    }));
  };

  const handleNextPage = () => {
    setFilters((prev) => ({
      ...prev,
      offset: (prev.offset || 0) + (prev.limit || 25),
    }));
  };

  // Export
  const handleExport = () => {
    if (entries.length === 0) {
      alert('No payments to export');
      return;
    }

    const csv = exportPaymentsToCSV(entries);
    const date = new Date().toISOString().split('T')[0];
    downloadCSV(csv, `payments-export-${date}.csv`);
  };

  // Format date for display
  const formatDate = (timestamp: any): string => {
    if (!timestamp) return '-';
    try {
      let date: Date;
      if (timestamp.toDate) {
        date = timestamp.toDate();
      } else if (timestamp.seconds) {
        date = new Date(timestamp.seconds * 1000);
      } else if (timestamp._seconds) {
        date = new Date(timestamp._seconds * 1000);
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
  };

  const currentPage = Math.floor((filters.offset || 0) / (filters.limit || 25)) + 1;
  const totalPages = Math.ceil(total / (filters.limit || 25));

  return (
    <div style={{ padding: '20px' }}>
      {/* Header */}
      <div
        style={{
          display: 'flex',
          justifyContent: 'space-between',
          alignItems: 'center',
          marginBottom: '20px',
        }}
      >
        <h2 style={{ margin: 0, fontSize: '20px', fontWeight: 600 }}>All Payments</h2>
        <button
          onClick={handleExport}
          disabled={loading || entries.length === 0}
          style={{
            padding: '8px 16px',
            backgroundColor: '#1976d2',
            color: 'white',
            border: 'none',
            borderRadius: '4px',
            cursor: entries.length === 0 ? 'not-allowed' : 'pointer',
            opacity: entries.length === 0 ? 0.5 : 1,
            fontSize: '14px',
          }}
        >
          Export CSV
        </button>
      </div>

      {/* Filters */}
      <div
        style={{
          display: 'flex',
          gap: '16px',
          marginBottom: '20px',
          flexWrap: 'wrap',
          alignItems: 'flex-end',
        }}
      >
        {/* Search */}
        <div style={{ flex: 1, minWidth: '200px' }}>
          <label
            style={{ display: 'block', marginBottom: '4px', fontSize: '12px', color: '#666' }}
          >
            Search
          </label>
          <input
            type="text"
            placeholder="Order #, Payment #, Stripe ID..."
            value={searchInput}
            onChange={(e) => setSearchInput(e.target.value)}
            style={{
              width: '100%',
              padding: '8px 12px',
              border: '1px solid #ddd',
              borderRadius: '4px',
              fontSize: '14px',
            }}
          />
        </div>

        {/* Status filter */}
        <div>
          <label
            style={{ display: 'block', marginBottom: '4px', fontSize: '12px', color: '#666' }}
          >
            Status
          </label>
          <select
            value={filters.status || 'all'}
            onChange={(e) => handleStatusChange(e.target.value)}
            style={{
              padding: '8px 12px',
              border: '1px solid #ddd',
              borderRadius: '4px',
              fontSize: '14px',
              minWidth: '120px',
            }}
          >
            <option value="all">All</option>
            <option value="pending">Pending</option>
            <option value="verified">Verified</option>
            <option value="approved">Approved</option>
            <option value="voided">Voided</option>
          </select>
        </div>

        {/* Type filter */}
        <div>
          <label
            style={{ display: 'block', marginBottom: '4px', fontSize: '12px', color: '#666' }}
          >
            Type
          </label>
          <select
            value={filters.transactionType || 'all'}
            onChange={(e) => handleTypeChange(e.target.value)}
            style={{
              padding: '8px 12px',
              border: '1px solid #ddd',
              borderRadius: '4px',
              fontSize: '14px',
              minWidth: '150px',
            }}
          >
            <option value="all">All Types</option>
            <option value="payment">Payment</option>
            <option value="refund">Refund</option>
            <option value="deposit_increase">Deposit Increase</option>
            <option value="deposit_decrease">Deposit Decrease</option>
          </select>
        </div>

        {/* Date range */}
        <div>
          <label
            style={{ display: 'block', marginBottom: '4px', fontSize: '12px', color: '#666' }}
          >
            From
          </label>
          <input
            type="date"
            value={startDate}
            onChange={(e) => {
              setStartDate(e.target.value);
              handleDateChange();
            }}
            style={{
              padding: '8px 12px',
              border: '1px solid #ddd',
              borderRadius: '4px',
              fontSize: '14px',
            }}
          />
        </div>

        <div>
          <label
            style={{ display: 'block', marginBottom: '4px', fontSize: '12px', color: '#666' }}
          >
            To
          </label>
          <input
            type="date"
            value={endDate}
            onChange={(e) => {
              setEndDate(e.target.value);
              handleDateChange();
            }}
            style={{
              padding: '8px 12px',
              border: '1px solid #ddd',
              borderRadius: '4px',
              fontSize: '14px',
            }}
          />
        </div>

        {/* Clear filters */}
        <button
          onClick={() => {
            setSearchInput('');
            setStartDate('');
            setEndDate('');
            setFilters({
              status: 'all',
              transactionType: 'all',
              search: '',
              limit: 25,
              offset: 0,
            });
          }}
          style={{
            padding: '8px 12px',
            backgroundColor: '#f5f5f5',
            border: '1px solid #ddd',
            borderRadius: '4px',
            cursor: 'pointer',
            fontSize: '14px',
          }}
        >
          Clear
        </button>
      </div>

      {/* Error */}
      {error && (
        <div
          style={{
            padding: '12px',
            backgroundColor: '#ffebee',
            color: '#c62828',
            borderRadius: '4px',
            marginBottom: '16px',
          }}
        >
          {error}
        </div>
      )}

      {/* Loading */}
      {loading && (
        <div style={{ textAlign: 'center', padding: '40px', color: '#666' }}>
          Loading payments...
        </div>
      )}

      {/* Table */}
      {!loading && entries.length > 0 && (
        <>
          <div style={{ overflowX: 'auto' }}>
            <table
              style={{
                width: '100%',
                borderCollapse: 'collapse',
                fontSize: '14px',
              }}
            >
              <thead>
                <tr style={{ backgroundColor: '#f5f5f5', borderBottom: '2px solid #ddd' }}>
                  <th style={{ padding: '12px', textAlign: 'left', fontWeight: 600 }}>ID</th>
                  <th style={{ padding: '12px', textAlign: 'left', fontWeight: 600 }}>Date</th>
                  <th style={{ padding: '12px', textAlign: 'left', fontWeight: 600 }}>Order</th>
                  <th style={{ padding: '12px', textAlign: 'left', fontWeight: 600 }}>Customer</th>
                  <th style={{ padding: '12px', textAlign: 'left', fontWeight: 600 }}>Type</th>
                  <th style={{ padding: '12px', textAlign: 'left', fontWeight: 600 }}>Method</th>
                  <th style={{ padding: '12px', textAlign: 'right', fontWeight: 600 }}>Amount</th>
                  <th style={{ padding: '12px', textAlign: 'right', fontWeight: 600 }}>Deposit</th>
                  <th style={{ padding: '12px', textAlign: 'right', fontWeight: 600 }}>Balance</th>
                  <th style={{ padding: '12px', textAlign: 'center', fontWeight: 600 }}>Status</th>
                  <th style={{ padding: '12px', textAlign: 'center', fontWeight: 600 }}>Actions</th>
                </tr>
              </thead>
              <tbody>
                {entries.map((entry, index) => (
                  <tr
                    key={entry.id || index}
                    onClick={() => onSelectPayment(entry)}
                    style={{
                      borderBottom: '1px solid #eee',
                      cursor: 'pointer',
                      backgroundColor: index % 2 === 0 ? 'white' : '#fafafa',
                    }}
                    onMouseEnter={(e) => {
                      (e.currentTarget as HTMLTableRowElement).style.backgroundColor = '#e3f2fd';
                    }}
                    onMouseLeave={(e) => {
                      (e.currentTarget as HTMLTableRowElement).style.backgroundColor =
                        index % 2 === 0 ? 'white' : '#fafafa';
                    }}
                  >
                    <td style={{ padding: '12px', fontFamily: 'monospace', fontSize: '13px' }}>
                      {entry.paymentNumber || entry.id?.substring(0, 8) || '-'}
                    </td>
                    <td style={{ padding: '12px' }}>{formatDate(entry.createdAt)}</td>
                    <td style={{ padding: '12px', fontFamily: 'monospace', fontSize: '13px' }}>
                      {entry.orderNumber}
                    </td>
                    <td style={{ padding: '12px' }}>{entry.customerName || '-'}</td>
                    <td style={{ padding: '12px' }}>
                      <TypeBadge type={entry.transactionType} />
                    </td>
                    <td style={{ padding: '12px' }}>
                      <span
                        style={{
                          padding: '2px 8px',
                          borderRadius: '4px',
                          fontSize: '12px',
                          backgroundColor: '#e3f2fd',
                          color: '#1565c0',
                        }}
                      >
                        {PAYMENT_METHOD_LABELS[entry.method] || entry.method || '-'}
                      </span>
                    </td>
                    <td
                      style={{
                        padding: '12px',
                        textAlign: 'right',
                        fontWeight: 500,
                        color:
                          entry.transactionType === 'refund' ||
                          entry.transactionType === 'deposit_decrease'
                            ? '#c62828'
                            : '#2e7d32',
                      }}
                    >
                      {entry.transactionType === 'refund' ||
                      entry.transactionType === 'deposit_decrease'
                        ? '-'
                        : ''}
                      {formatCurrency(entry.amount)}
                    </td>
                    <td style={{ padding: '12px', textAlign: 'right', color: '#666' }}>
                      {formatCurrency(entry.orderDeposit ?? entry.depositAtTime ?? 0)}
                    </td>
                    <td
                      style={{
                        padding: '12px',
                        textAlign: 'right',
                        fontWeight: 500,
                        color:
                          // Use orderBalance (current balance including live change orders)
                          (entry.orderBalance || 0) > 0
                            ? '#c62828'
                            : (entry.orderBalance || 0) < 0
                            ? '#1565c0'
                            : '#2e7d32',
                      }}
                    >
                      {(() => {
                        // Use current order balance (accounts for live change orders)
                        const balance = entry.orderBalance ?? 0;
                        if (balance === 0) return 'Paid';
                        if (balance > 0) return `${formatCurrency(balance)} due`;
                        return `${formatCurrency(Math.abs(balance))} over`;
                      })()}
                    </td>
                    <td style={{ padding: '12px', textAlign: 'center' }}>
                      <StatusBadge status={entry.status} />
                    </td>
                    <td style={{ padding: '12px', textAlign: 'center' }}>
                      {entry.status === 'pending' && onApprove ? (
                        <button
                          onClick={(e) => {
                            e.stopPropagation();
                            onApprove(entry);
                          }}
                          style={{
                            padding: '4px 12px',
                            backgroundColor: '#4caf50',
                            color: 'white',
                            border: 'none',
                            borderRadius: '4px',
                            fontSize: '12px',
                            cursor: 'pointer',
                            fontWeight: 500,
                          }}
                        >
                          Approve
                        </button>
                      ) : (
                        <span style={{ color: '#999' }}>-</span>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          {/* Pagination */}
          <div
            style={{
              display: 'flex',
              justifyContent: 'space-between',
              alignItems: 'center',
              marginTop: '16px',
              padding: '12px',
              backgroundColor: '#f5f5f5',
              borderRadius: '4px',
            }}
          >
            <span style={{ color: '#666', fontSize: '14px' }}>
              Showing {(filters.offset || 0) + 1}-
              {Math.min((filters.offset || 0) + entries.length, total)} of {total} entries
            </span>
            <div style={{ display: 'flex', gap: '8px' }}>
              <button
                onClick={handlePrevPage}
                disabled={(filters.offset || 0) === 0}
                style={{
                  padding: '8px 16px',
                  border: '1px solid #ddd',
                  borderRadius: '4px',
                  backgroundColor: 'white',
                  cursor: (filters.offset || 0) === 0 ? 'not-allowed' : 'pointer',
                  opacity: (filters.offset || 0) === 0 ? 0.5 : 1,
                }}
              >
                Previous
              </button>
              <span
                style={{
                  padding: '8px 12px',
                  color: '#666',
                }}
              >
                Page {currentPage} of {totalPages}
              </span>
              <button
                onClick={handleNextPage}
                disabled={!hasMore}
                style={{
                  padding: '8px 16px',
                  border: '1px solid #ddd',
                  borderRadius: '4px',
                  backgroundColor: 'white',
                  cursor: !hasMore ? 'not-allowed' : 'pointer',
                  opacity: !hasMore ? 0.5 : 1,
                }}
              >
                Next
              </button>
            </div>
          </div>
        </>
      )}

      {/* Empty state */}
      {!loading && entries.length === 0 && (
        <div
          style={{
            textAlign: 'center',
            padding: '60px 20px',
            color: '#666',
            backgroundColor: '#f5f5f5',
            borderRadius: '8px',
          }}
        >
          <div style={{ fontSize: '48px', marginBottom: '16px' }}>
            <span role="img" aria-label="no data">
              {'\ud83d\udcb3'}
            </span>
          </div>
          <h3 style={{ margin: '0 0 8px 0', fontWeight: 500 }}>No payments found</h3>
          <p style={{ margin: 0, fontSize: '14px' }}>
            {filters.search || filters.status !== 'all' || filters.transactionType !== 'all'
              ? 'Try adjusting your filters'
              : 'Payments will appear here once they are recorded'}
          </p>
        </div>
      )}
    </div>
  );
}

export default AllPaymentsTab;
