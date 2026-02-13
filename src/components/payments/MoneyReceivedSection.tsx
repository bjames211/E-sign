import React from 'react';
import { Timestamp } from 'firebase/firestore';
import {
  PaymentLedgerEntry,
  formatCurrency,
  PAYMENT_METHOD_LABELS,
  LedgerEntryStatus,
} from '../../types/payment';

interface MoneyReceivedSectionProps {
  payments: PaymentLedgerEntry[];
  totalCharged: number;
  pendingAmount: number;
  onViewProof?: (entry: PaymentLedgerEntry) => void;
  onApprove?: (entry: PaymentLedgerEntry) => void;
  approvingId?: string | null;
}

function formatDate(timestamp: Timestamp | undefined): string {
  if (!timestamp) return '-';
  const date = timestamp.toDate();
  return date.toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
}

function getStatusBadge(status: LedgerEntryStatus): { label: string; style: React.CSSProperties } {
  switch (status) {
    case 'verified':
      return {
        label: '✓',
        style: { color: '#2e7d32', fontWeight: 700 },
      };
    case 'approved':
      return {
        label: '✓',
        style: { color: '#2e7d32', fontWeight: 700 },
      };
    case 'pending':
      return {
        label: 'Pending',
        style: {
          color: '#e65100',
          fontSize: '11px',
          backgroundColor: '#fff3e0',
          padding: '2px 6px',
          borderRadius: '4px',
        },
      };
    case 'voided':
      return {
        label: 'Voided',
        style: {
          color: '#666',
          fontSize: '11px',
          backgroundColor: '#f5f5f5',
          padding: '2px 6px',
          borderRadius: '4px',
          textDecoration: 'line-through',
        },
      };
    default:
      return { label: '', style: {} };
  }
}

export function MoneyReceivedSection({
  payments,
  totalCharged,
  pendingAmount,
  onViewProof,
  onApprove,
  approvingId,
}: MoneyReceivedSectionProps) {
  const hasPayments = payments.length > 0;

  return (
    <div style={styles.section}>
      <h4 style={styles.title}>MONEY RECEIVED</h4>
      <div style={styles.content}>
        {hasPayments ? (
          <table style={styles.table}>
            <tbody>
              {payments.map((entry) => {
                const statusBadge = getStatusBadge(entry.status);
                const isPending = entry.status === 'pending';

                return (
                  <tr
                    key={entry.id}
                    style={{
                      ...styles.row,
                      opacity: isPending ? 0.7 : 1,
                    }}
                  >
                    <td style={styles.dateCell}>{formatDate(entry.createdAt)}</td>
                    <td style={styles.amountCell}>
                      <span style={isPending ? styles.pendingAmount : styles.amount}>
                        {formatCurrency(entry.amount)}
                      </span>
                    </td>
                    <td style={styles.methodCell}>
                      {PAYMENT_METHOD_LABELS[entry.method] || entry.method}
                    </td>
                    <td style={styles.descriptionCell}>
                      {entry.description || entry.category.replace(/_/g, ' ')}
                      {entry.proofFile && onViewProof && (
                        <button
                          onClick={() => onViewProof(entry)}
                          style={styles.proofLink}
                        >
                          📎
                        </button>
                      )}
                    </td>
                    <td style={styles.statusCell}>
                      {isPending && onApprove ? (
                        <button
                          onClick={() => onApprove(entry)}
                          disabled={approvingId === entry.id}
                          style={styles.approveButton}
                        >
                          {approvingId === entry.id ? '...' : 'Approve'}
                        </button>
                      ) : (
                        <span style={statusBadge.style}>{statusBadge.label}</span>
                      )}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        ) : (
          <div style={styles.empty}>(none)</div>
        )}

        <div style={styles.totalRow}>
          <span style={styles.totalLabel}>Total Charged:</span>
          <span style={styles.totalValue}>{formatCurrency(totalCharged)}</span>
        </div>
        {pendingAmount > 0 && (
          <div style={styles.pendingRow}>
            <span style={styles.pendingLabel}>Pending:</span>
            <span style={styles.pendingValue}>{formatCurrency(pendingAmount)}</span>
          </div>
        )}
      </div>
    </div>
  );
}

const styles: Record<string, React.CSSProperties> = {
  section: {
    backgroundColor: '#fff',
    borderRadius: '8px',
    padding: '16px',
    border: '1px solid #e0e0e0',
    marginBottom: '16px',
  },
  title: {
    margin: '0 0 12px 0',
    fontSize: '12px',
    fontWeight: 600,
    color: '#666',
    textTransform: 'uppercase',
    letterSpacing: '0.5px',
  },
  content: {
    display: 'flex',
    flexDirection: 'column',
  },
  table: {
    width: '100%',
    borderCollapse: 'collapse',
    marginBottom: '12px',
  },
  row: {
    borderBottom: '1px solid #f0f0f0',
  },
  dateCell: {
    padding: '8px 8px 8px 0',
    fontSize: '13px',
    color: '#666',
    width: '70px',
  },
  amountCell: {
    padding: '8px',
    fontSize: '13px',
    fontWeight: 500,
    width: '100px',
    textAlign: 'right',
  },
  amount: {
    color: '#2e7d32',
  },
  pendingAmount: {
    color: '#e65100',
  },
  methodCell: {
    padding: '8px',
    fontSize: '13px',
    color: '#666',
    width: '80px',
  },
  descriptionCell: {
    padding: '8px',
    fontSize: '13px',
    color: '#333',
  },
  statusCell: {
    padding: '8px 0 8px 8px',
    fontSize: '13px',
    width: '60px',
    textAlign: 'right',
  },
  proofLink: {
    marginLeft: '6px',
    background: 'none',
    border: 'none',
    cursor: 'pointer',
    fontSize: '12px',
    padding: 0,
  },
  empty: {
    padding: '12px 0',
    color: '#999',
    fontStyle: 'italic',
    fontSize: '13px',
  },
  totalRow: {
    display: 'flex',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingTop: '8px',
    borderTop: '1px solid #e0e0e0',
  },
  totalLabel: {
    fontSize: '13px',
    fontWeight: 600,
    color: '#333',
  },
  totalValue: {
    fontSize: '14px',
    fontWeight: 700,
    color: '#2e7d32',
  },
  pendingRow: {
    display: 'flex',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingTop: '4px',
  },
  pendingLabel: {
    fontSize: '12px',
    color: '#666',
  },
  pendingValue: {
    fontSize: '13px',
    fontWeight: 500,
    color: '#e65100',
  },
  approveButton: {
    padding: '4px 10px',
    backgroundColor: '#4caf50',
    color: 'white',
    border: 'none',
    borderRadius: '4px',
    fontSize: '12px',
    cursor: 'pointer',
    fontWeight: 500,
  },
};

export default MoneyReceivedSection;
