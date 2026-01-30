import React from 'react';
import { Timestamp } from 'firebase/firestore';
import {
  PaymentRecord,
  formatCurrency,
  PAYMENT_METHOD_LABELS,
  PAYMENT_CATEGORY_LABELS,
  PAYMENT_STATUS_LABELS,
  PAYMENT_STATUS_COLORS,
} from '../../types/payment';

interface PaymentHistoryTableProps {
  payments: PaymentRecord[];
  loading?: boolean;
  onApprove?: (paymentId: string) => void;
  onReject?: (paymentId: string) => void;
  onViewProof?: (payment: PaymentRecord) => void;
}

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
    });
  } catch (err) {
    return '-';
  }
}

export function PaymentHistoryTable({
  payments,
  loading,
  onApprove,
  onReject,
  onViewProof,
}: PaymentHistoryTableProps) {
  if (loading) {
    return (
      <div style={styles.container}>
        <div style={styles.loading}>Loading payment history...</div>
      </div>
    );
  }

  if (payments.length === 0) {
    return (
      <div style={styles.container}>
        <div style={styles.empty}>No payments recorded yet</div>
      </div>
    );
  }

  return (
    <div style={styles.container}>
      <table style={styles.table}>
        <thead>
          <tr>
            <th style={styles.th}>Date</th>
            <th style={styles.th}>Amount</th>
            <th style={styles.th}>Method</th>
            <th style={styles.th}>Category</th>
            <th style={styles.th}>Status</th>
            <th style={styles.th}>Actions</th>
          </tr>
        </thead>
        <tbody>
          {payments.map((payment) => (
            <PaymentRow
              key={payment.id}
              payment={payment}
              onApprove={onApprove}
              onReject={onReject}
              onViewProof={onViewProof}
            />
          ))}
        </tbody>
      </table>
    </div>
  );
}

interface PaymentRowProps {
  payment: PaymentRecord;
  onApprove?: (paymentId: string) => void;
  onReject?: (paymentId: string) => void;
  onViewProof?: (payment: PaymentRecord) => void;
}

function PaymentRow({ payment, onApprove, onReject, onViewProof }: PaymentRowProps) {
  const statusColors = PAYMENT_STATUS_COLORS[payment.status] || PAYMENT_STATUS_COLORS.pending;
  const isRefund = payment.amount < 0;
  const isPending = payment.status === 'pending';

  return (
    <tr style={styles.tr}>
      <td style={styles.td}>{formatDate(payment.createdAt)}</td>
      <td style={{ ...styles.td, ...styles.amount, color: isRefund ? '#c62828' : '#2e7d32' }}>
        {isRefund ? '-' : ''}{formatCurrency(Math.abs(payment.amount))}
      </td>
      <td style={styles.td}>
        <span style={styles.methodBadge}>
          {PAYMENT_METHOD_LABELS[payment.method] || payment.method}
        </span>
        {payment.stripePaymentId && (
          <span style={styles.stripeId} title={payment.stripePaymentId}>
            {payment.stripePaymentId.substring(0, 10)}...
          </span>
        )}
      </td>
      <td style={styles.td}>
        <span style={styles.categoryText}>
          {payment.changeOrderNumber
            ? `${payment.changeOrderNumber} Dep`
            : PAYMENT_CATEGORY_LABELS[payment.category] || payment.category}
        </span>
        {payment.changeOrderNumber && (
          <span style={styles.changeOrderBadge}>Change Order</span>
        )}
      </td>
      <td style={styles.td}>
        <span
          style={{
            ...styles.statusBadge,
            backgroundColor: statusColors.split(' ')[0].replace('bg-', ''),
          }}
          className={statusColors}
        >
          {PAYMENT_STATUS_LABELS[payment.status] || payment.status}
        </span>
      </td>
      <td style={styles.td}>
        <div style={styles.actions}>
          {payment.proofFile && onViewProof && (
            <button
              onClick={() => onViewProof(payment)}
              style={styles.viewProofButton}
              title="View proof"
            >
              Proof
            </button>
          )}
          {isPending && onApprove && payment.id && (
            <button
              onClick={() => onApprove(payment.id!)}
              style={styles.approveButton}
              title="Approve payment"
            >
              Approve
            </button>
          )}
          {isPending && onReject && payment.id && (
            <button
              onClick={() => onReject(payment.id!)}
              style={styles.rejectButton}
              title="Reject payment"
            >
              Reject
            </button>
          )}
          {!isPending && payment.approvedBy && (
            <span style={styles.approvedText}>
              by {payment.approvedBy}
            </span>
          )}
        </div>
      </td>
    </tr>
  );
}

const styles: Record<string, React.CSSProperties> = {
  container: {
    overflowX: 'auto',
  },
  loading: {
    padding: '24px',
    textAlign: 'center',
    color: '#999',
    fontSize: '14px',
  },
  empty: {
    padding: '24px',
    textAlign: 'center',
    color: '#999',
    fontSize: '14px',
    fontStyle: 'italic',
  },
  table: {
    width: '100%',
    borderCollapse: 'collapse',
    fontSize: '14px',
  },
  th: {
    textAlign: 'left',
    padding: '10px 12px',
    backgroundColor: '#f5f5f5',
    borderBottom: '1px solid #e0e0e0',
    fontSize: '12px',
    fontWeight: 600,
    color: '#666',
    textTransform: 'uppercase',
  },
  tr: {
    borderBottom: '1px solid #eee',
  },
  td: {
    padding: '12px',
    verticalAlign: 'middle',
  },
  amount: {
    fontWeight: 600,
    fontFamily: 'monospace',
    fontSize: '14px',
  },
  methodBadge: {
    display: 'inline-block',
    padding: '2px 8px',
    backgroundColor: '#e3f2fd',
    color: '#1565c0',
    borderRadius: '4px',
    fontSize: '12px',
    fontWeight: 500,
  },
  stripeId: {
    display: 'block',
    fontSize: '11px',
    color: '#999',
    marginTop: '2px',
    fontFamily: 'monospace',
  },
  categoryText: {
    fontSize: '13px',
    color: '#666',
  },
  changeOrderBadge: {
    display: 'block',
    fontSize: '10px',
    color: '#ff9800',
    marginTop: '2px',
    fontWeight: 500,
  },
  statusBadge: {
    display: 'inline-block',
    padding: '4px 10px',
    borderRadius: '12px',
    fontSize: '11px',
    fontWeight: 500,
  },
  actions: {
    display: 'flex',
    gap: '6px',
    alignItems: 'center',
    flexWrap: 'wrap',
  },
  viewProofButton: {
    padding: '4px 8px',
    backgroundColor: '#f5f5f5',
    color: '#1565c0',
    border: '1px solid #ddd',
    borderRadius: '4px',
    fontSize: '11px',
    cursor: 'pointer',
  },
  approveButton: {
    padding: '4px 10px',
    backgroundColor: '#e8f5e9',
    color: '#2e7d32',
    border: '1px solid #a5d6a7',
    borderRadius: '4px',
    fontSize: '11px',
    cursor: 'pointer',
    fontWeight: 500,
  },
  rejectButton: {
    padding: '4px 10px',
    backgroundColor: '#ffebee',
    color: '#c62828',
    border: '1px solid #ef9a9a',
    borderRadius: '4px',
    fontSize: '11px',
    cursor: 'pointer',
    fontWeight: 500,
  },
  approvedText: {
    fontSize: '11px',
    color: '#999',
    fontStyle: 'italic',
  },
};
