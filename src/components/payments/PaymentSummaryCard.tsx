import React from 'react';
import { PaymentSummary, formatCurrency } from '../../types/payment';

interface PaymentSummaryCardProps {
  depositRequired: number;
  summary: PaymentSummary | null;
  loading?: boolean;
  additionalDepositDue?: number;  // From change orders
  refundDue?: number;             // From change orders
}

export function PaymentSummaryCard({
  depositRequired,
  summary,
  loading,
  additionalDepositDue,
  refundDue,
}: PaymentSummaryCardProps) {
  if (loading) {
    return (
      <div style={styles.card}>
        <h4 style={styles.title}>PAYMENT SUMMARY</h4>
        <div style={styles.loading}>Loading payment data...</div>
      </div>
    );
  }

  const totalPaid = summary?.totalPaid || 0;
  const totalPending = summary?.totalPending || 0;

  // Total deposit required includes any additional deposit from change orders
  const totalDepositRequired = depositRequired + (additionalDepositDue || 0) - (refundDue || 0);

  // Balance calculation uses total deposit required
  const balance = totalDepositRequired - totalPaid;
  const isOverpaid = balance < 0;

  return (
    <div style={styles.card}>
      <h4 style={styles.title}>PAYMENT SUMMARY</h4>
      <div style={styles.content}>
        <div style={styles.row}>
          <span style={styles.label}>Deposit Required:</span>
          <span style={styles.value}>{formatCurrency(totalDepositRequired)}</span>
        </div>
        {/* Show breakdown if there's additional deposit or refund adjustments */}
        {(additionalDepositDue && additionalDepositDue > 0) && (
          <div style={styles.subRow}>
            <span style={styles.subLabel}>(Original: {formatCurrency(depositRequired)} + CO: {formatCurrency(additionalDepositDue)})</span>
          </div>
        )}
        {(refundDue && refundDue > 0) && (
          <div style={styles.subRow}>
            <span style={styles.subLabel}>(Original: {formatCurrency(depositRequired)} - CO Refund: {formatCurrency(refundDue)})</span>
          </div>
        )}
        <div style={styles.row}>
          <span style={styles.label}>Total Paid:</span>
          <span style={{ ...styles.value, color: totalPaid > 0 ? '#2e7d32' : '#666' }}>
            {formatCurrency(totalPaid)}
          </span>
        </div>
        {totalPending > 0 && (
          <div style={styles.row}>
            <span style={styles.label}>Pending:</span>
            <span style={{ ...styles.value, color: '#e65100' }}>
              {formatCurrency(totalPending)}
            </span>
          </div>
        )}
        <div style={styles.divider} />
        <div style={styles.balanceRow}>
          <span style={styles.balanceLabel}>
            {isOverpaid ? 'Overpaid:' : 'Balance Due:'}
          </span>
          <span
            style={{
              ...styles.balanceValue,
              color: isOverpaid ? '#c62828' : balance === 0 ? '#2e7d32' : '#333',
            }}
          >
            {formatCurrency(Math.abs(balance))}
          </span>
        </div>
        {balance !== 0 && (
          <div style={styles.statusNote}>
            {isOverpaid
              ? '(We owe customer)'
              : balance === depositRequired
              ? '(No payments recorded)'
              : '(Customer owes)'}
          </div>
        )}
        {balance === 0 && totalPaid > 0 && (
          <div style={{ ...styles.statusNote, color: '#2e7d32' }}>
            Fully paid
          </div>
        )}
      </div>
    </div>
  );
}

const styles: Record<string, React.CSSProperties> = {
  card: {
    backgroundColor: '#f8f9fa',
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
    gap: '8px',
  },
  loading: {
    padding: '20px',
    textAlign: 'center',
    color: '#999',
    fontSize: '14px',
  },
  row: {
    display: 'flex',
    justifyContent: 'space-between',
    alignItems: 'center',
  },
  label: {
    fontSize: '14px',
    color: '#666',
  },
  value: {
    fontSize: '14px',
    fontWeight: 500,
    color: '#333',
  },
  divider: {
    height: '1px',
    backgroundColor: '#ddd',
    margin: '8px 0',
  },
  balanceRow: {
    display: 'flex',
    justifyContent: 'space-between',
    alignItems: 'center',
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
  statusNote: {
    fontSize: '12px',
    color: '#666',
    textAlign: 'right',
    fontStyle: 'italic',
  },
  subRow: {
    marginTop: '-4px',
    marginBottom: '4px',
  },
  subLabel: {
    fontSize: '11px',
    color: '#999',
    fontStyle: 'italic',
  },
};
