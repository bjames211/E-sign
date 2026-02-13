import React, { useState, useEffect } from 'react';
import { Timestamp } from 'firebase/firestore';
import { Order } from '../../types/order';
import {
  PaymentLedgerEntry,
  OrderLedgerSummary,
  formatCurrency,
  PAYMENT_METHOD_LABELS,
} from '../../types/payment';
import { getLedgerEntriesForOrder } from '../../services/paymentService';

interface TransactionsLedgerProps {
  order: Order;
  ledgerSummary: OrderLedgerSummary;
  compact?: boolean; // For use in list views
  effectiveDepositRequired?: number; // Override deposit when there's a live CO
}

function formatDate(timestamp: Timestamp | undefined): string {
  if (!timestamp) return '-';
  try {
    const date = timestamp.toDate ? timestamp.toDate() : new Date((timestamp as any).seconds * 1000);
    return date.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: '2-digit' });
  } catch {
    return '-';
  }
}

function getTransactionTypeLabel(entry: PaymentLedgerEntry): string {
  switch (entry.transactionType) {
    case 'payment':
      return 'Payment';
    case 'refund':
      return 'Refund';
    case 'deposit_increase':
      return 'Adjustment (+)';
    case 'deposit_decrease':
      return 'Adjustment (-)';
    default:
      return entry.transactionType;
  }
}

function getStatusBadge(status: string): { label: string; color: string; bg: string } {
  switch (status) {
    case 'verified':
      return { label: 'Cleared', color: '#2e7d32', bg: '#e8f5e9' };
    case 'approved':
      return { label: 'Cleared', color: '#2e7d32', bg: '#e8f5e9' };
    case 'pending':
      return { label: 'Pending', color: '#e65100', bg: '#fff3e0' };
    case 'voided':
      return { label: 'Voided', color: '#666', bg: '#f5f5f5' };
    default:
      return { label: status, color: '#666', bg: '#f5f5f5' };
  }
}

export function TransactionsLedger({ order, ledgerSummary, compact = false, effectiveDepositRequired }: TransactionsLedgerProps) {
  const [entries, setEntries] = useState<PaymentLedgerEntry[]>([]);
  const [loading, setLoading] = useState(true);
  const [expanded, setExpanded] = useState(!compact);

  // Use effective deposit if provided (for live COs), otherwise use ledger summary
  const depositRequired = effectiveDepositRequired ?? ledgerSummary.depositRequired;

  useEffect(() => {
    if (order.id) {
      loadEntries();
    }
  }, [order.id]);

  const loadEntries = async () => {
    if (!order.id) return;
    setLoading(true);
    try {
      const result = await getLedgerEntriesForOrder(order.id);
      // Sort newest first
      result.sort((a, b) => {
        const aTime = a.createdAt?.seconds || 0;
        const bTime = b.createdAt?.seconds || 0;
        return bTime - aTime;
      });
      setEntries(result);
    } catch (err) {
      console.error('Failed to load ledger entries:', err);
    } finally {
      setLoading(false);
    }
  };

  // Calculate totals from entries
  const payments = entries.filter(e => e.transactionType === 'payment' && e.status !== 'voided');
  const refunds = entries.filter(e => e.transactionType === 'refund' && e.status !== 'voided');
  const clearedPayments = payments.filter(e => e.status === 'verified' || e.status === 'approved');
  const clearedRefunds = refunds.filter(e => e.status === 'verified' || e.status === 'approved');
  const pendingPayments = payments.filter(e => e.status === 'pending');
  const pendingRefunds = refunds.filter(e => e.status === 'pending');

  const totalPaymentsCleared = clearedPayments.reduce((sum, e) => sum + e.amount, 0);
  const totalRefundsCleared = clearedRefunds.reduce((sum, e) => sum + e.amount, 0);
  const totalPending = pendingPayments.reduce((sum, e) => sum + e.amount, 0) +
                       pendingRefunds.reduce((sum, e) => sum + e.amount, 0);
  const netPaid = totalPaymentsCleared - totalRefundsCleared;
  // Calculate effective balance based on effective deposit (for live COs)
  const balance = effectiveDepositRequired !== undefined
    ? depositRequired - netPaid
    : ledgerSummary.balance;

  // For compact mode (list view), show minimal summary
  if (compact && !expanded) {
    return (
      <div style={styles.compactContainer}>
        <button
          onClick={() => setExpanded(true)}
          style={styles.expandButton}
        >
          {entries.length} transaction{entries.length !== 1 ? 's' : ''}
          {balance !== 0 && (
            <span style={{
              color: balance > 0 ? '#e65100' : '#1565c0',
              marginLeft: '8px'
            }}>
              ({balance > 0 ? `$${balance.toLocaleString()} owed` : `$${Math.abs(balance).toLocaleString()} refund due`})
            </span>
          )}
        </button>
      </div>
    );
  }

  return (
    <div style={styles.container}>
      {/* Summary Section */}
      <div style={styles.summarySection}>
        <div style={styles.summaryRow}>
          <span style={styles.summaryLabel}>Deposit Required (current):</span>
          <span style={styles.summaryValue}>
            {formatCurrency(depositRequired)}
            {effectiveDepositRequired !== undefined && effectiveDepositRequired !== ledgerSummary.depositRequired && (
              <span style={{ fontSize: '11px', color: '#1565c0', marginLeft: '6px' }}>
                (was {formatCurrency(ledgerSummary.depositRequired)})
              </span>
            )}
          </span>
        </div>
        <div style={styles.summaryRow}>
          <span style={styles.summaryLabel}>Net Paid (cleared):</span>
          <span style={{ ...styles.summaryValue, color: '#2e7d32' }}>{formatCurrency(netPaid)}</span>
        </div>
        <div style={{
          ...styles.summaryRow,
          ...styles.balanceRow,
          backgroundColor: balance === 0 ? '#e8f5e9' : balance > 0 ? '#fff3e0' : '#e3f2fd',
        }}>
          <span style={styles.balanceLabel}>
            {balance > 0 ? 'Balance Due:' : balance < 0 ? 'Refund Due:' : 'Balance:'}
          </span>
          <span style={{
            ...styles.balanceValue,
            color: balance === 0 ? '#2e7d32' : balance > 0 ? '#e65100' : '#1565c0',
          }}>
            {formatCurrency(Math.abs(balance))}
          </span>
        </div>
      </div>

      {/* Totals from Ledger */}
      <div style={styles.totalsSection}>
        <h4 style={styles.sectionTitle}>Totals (from ledger)</h4>
        <div style={styles.totalsGrid}>
          <div style={styles.totalItem}>
            <span style={styles.totalLabel}>Total Payments (cleared):</span>
            <span style={{ ...styles.totalValue, color: '#2e7d32' }}>{formatCurrency(totalPaymentsCleared)}</span>
          </div>
          <div style={styles.totalItem}>
            <span style={styles.totalLabel}>Total Refunds (cleared):</span>
            <span style={{ ...styles.totalValue, color: '#c62828' }}>{formatCurrency(totalRefundsCleared)}</span>
          </div>
          <div style={styles.totalItem}>
            <span style={styles.totalLabel}>Net Paid:</span>
            <span style={styles.totalValue}>
              {formatCurrency(totalPaymentsCleared)} - {formatCurrency(totalRefundsCleared)} = {formatCurrency(netPaid)}
            </span>
          </div>
          {totalPending > 0 && (
            <div style={styles.totalItem}>
              <span style={styles.totalLabel}>Pending (not counted):</span>
              <span style={{ ...styles.totalValue, color: '#e65100' }}>{formatCurrency(totalPending)}</span>
            </div>
          )}
        </div>
      </div>

      {/* Transactions Table */}
      <div style={styles.transactionsSection}>
        <div style={styles.transactionsHeader}>
          <h4 style={styles.sectionTitle}>All Transactions (ledger)</h4>
          {compact && (
            <button onClick={() => setExpanded(false)} style={styles.collapseButton}>
              Collapse
            </button>
          )}
        </div>

        {loading ? (
          <div style={styles.loading}>Loading transactions...</div>
        ) : entries.length === 0 ? (
          <div style={styles.empty}>No transactions recorded</div>
        ) : (
          <table style={styles.table}>
            <thead>
              <tr>
                <th style={styles.th}>Payment ID</th>
                <th style={styles.th}>Date</th>
                <th style={styles.th}>Type</th>
                <th style={styles.th}>Method</th>
                <th style={styles.thRight}>Amount</th>
                <th style={styles.th}>Status</th>
                <th style={styles.th}>Reference</th>
                <th style={styles.th}>Notes</th>
              </tr>
            </thead>
            <tbody>
              {entries.map((entry) => {
                const statusBadge = getStatusBadge(entry.status);
                const isVoided = entry.status === 'voided';

                return (
                  <tr key={entry.id} style={{ opacity: isVoided ? 0.5 : 1 }}>
                    <td style={{ ...styles.td, fontFamily: 'monospace', fontSize: '11px', color: '#1976d2' }}>
                      {entry.paymentNumber || entry.id?.substring(0, 8) || '-'}
                    </td>
                    <td style={styles.td}>{formatDate(entry.createdAt)}</td>
                    <td style={styles.td}>
                      <span style={{
                        ...styles.typeBadge,
                        backgroundColor: entry.transactionType === 'payment' ? '#e8f5e9' :
                                        entry.transactionType === 'refund' ? '#ffebee' : '#f5f5f5',
                        color: entry.transactionType === 'payment' ? '#2e7d32' :
                               entry.transactionType === 'refund' ? '#c62828' : '#666',
                      }}>
                        {getTransactionTypeLabel(entry)}
                      </span>
                    </td>
                    <td style={styles.td}>{PAYMENT_METHOD_LABELS[entry.method] || entry.method}</td>
                    <td style={{
                      ...styles.tdRight,
                      color: entry.transactionType === 'payment' ? '#2e7d32' :
                             entry.transactionType === 'refund' ? '#c62828' : '#333',
                      textDecoration: isVoided ? 'line-through' : 'none',
                    }}>
                      {formatCurrency(entry.amount)}
                    </td>
                    <td style={styles.td}>
                      <span style={{
                        ...styles.statusBadge,
                        backgroundColor: statusBadge.bg,
                        color: statusBadge.color,
                      }}>
                        {statusBadge.label}
                      </span>
                    </td>
                    <td style={styles.td}>
                      <span style={styles.reference}>
                        {entry.stripePaymentId || entry.changeOrderNumber || '-'}
                      </span>
                    </td>
                    <td style={styles.td}>
                      <span style={styles.notes}>
                        {entry.description || entry.notes || '-'}
                        {entry.proofFile && (
                          <a
                            href={entry.proofFile.downloadUrl}
                            target="_blank"
                            rel="noopener noreferrer"
                            style={styles.proofLink}
                          >
                            [proof]
                          </a>
                        )}
                      </span>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        )}
      </div>
    </div>
  );
}

const styles: Record<string, React.CSSProperties> = {
  container: {
    backgroundColor: '#fff',
    borderRadius: '8px',
    border: '1px solid #e0e0e0',
    overflow: 'hidden',
  },
  compactContainer: {
    marginTop: '8px',
  },
  expandButton: {
    background: 'none',
    border: '1px solid #e0e0e0',
    borderRadius: '4px',
    padding: '6px 12px',
    fontSize: '12px',
    color: '#666',
    cursor: 'pointer',
    width: '100%',
    textAlign: 'left',
  },
  collapseButton: {
    background: 'none',
    border: '1px solid #ccc',
    borderRadius: '4px',
    padding: '4px 8px',
    fontSize: '11px',
    color: '#666',
    cursor: 'pointer',
  },
  summarySection: {
    padding: '16px',
    borderBottom: '1px solid #e0e0e0',
    backgroundColor: '#fafafa',
  },
  summaryRow: {
    display: 'flex',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: '8px',
  },
  summaryLabel: {
    fontSize: '14px',
    color: '#666',
  },
  summaryValue: {
    fontSize: '14px',
    fontWeight: 600,
    color: '#333',
  },
  balanceRow: {
    marginTop: '12px',
    marginBottom: 0,
    padding: '12px',
    borderRadius: '6px',
  },
  balanceLabel: {
    fontSize: '15px',
    fontWeight: 600,
    color: '#333',
  },
  balanceValue: {
    fontSize: '18px',
    fontWeight: 700,
  },
  totalsSection: {
    padding: '16px',
    borderBottom: '1px solid #e0e0e0',
  },
  sectionTitle: {
    margin: '0 0 12px 0',
    fontSize: '12px',
    fontWeight: 600,
    color: '#666',
    textTransform: 'uppercase',
    letterSpacing: '0.5px',
  },
  totalsGrid: {
    display: 'flex',
    flexDirection: 'column',
    gap: '8px',
  },
  totalItem: {
    display: 'flex',
    justifyContent: 'space-between',
    fontSize: '13px',
  },
  totalLabel: {
    color: '#666',
  },
  totalValue: {
    fontWeight: 500,
    color: '#333',
  },
  transactionsSection: {
    padding: '16px',
  },
  transactionsHeader: {
    display: 'flex',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: '12px',
  },
  loading: {
    padding: '24px',
    textAlign: 'center',
    color: '#999',
    fontSize: '13px',
  },
  empty: {
    padding: '24px',
    textAlign: 'center',
    color: '#999',
    fontStyle: 'italic',
    fontSize: '13px',
  },
  table: {
    width: '100%',
    borderCollapse: 'collapse',
    fontSize: '13px',
  },
  th: {
    padding: '8px',
    textAlign: 'left',
    fontWeight: 600,
    color: '#666',
    borderBottom: '2px solid #e0e0e0',
    fontSize: '11px',
    textTransform: 'uppercase',
  },
  thRight: {
    padding: '8px',
    textAlign: 'right',
    fontWeight: 600,
    color: '#666',
    borderBottom: '2px solid #e0e0e0',
    fontSize: '11px',
    textTransform: 'uppercase',
  },
  td: {
    padding: '10px 8px',
    borderBottom: '1px solid #f0f0f0',
    color: '#333',
    verticalAlign: 'top',
  },
  tdRight: {
    padding: '10px 8px',
    borderBottom: '1px solid #f0f0f0',
    textAlign: 'right',
    fontWeight: 600,
    verticalAlign: 'top',
  },
  typeBadge: {
    display: 'inline-block',
    padding: '3px 8px',
    borderRadius: '4px',
    fontSize: '11px',
    fontWeight: 600,
  },
  statusBadge: {
    display: 'inline-block',
    padding: '3px 8px',
    borderRadius: '4px',
    fontSize: '11px',
    fontWeight: 500,
  },
  reference: {
    fontSize: '11px',
    color: '#666',
    fontFamily: 'monospace',
  },
  notes: {
    fontSize: '12px',
    color: '#666',
    maxWidth: '200px',
  },
  proofLink: {
    marginLeft: '6px',
    color: '#1565c0',
    textDecoration: 'none',
    fontSize: '11px',
  },
};

export default TransactionsLedger;
