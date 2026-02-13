import React from 'react';
import {
  formatCurrency,
  BalanceStatus,
  BALANCE_STATUS_COLORS,
} from '../../types/payment';

interface BalanceCardProps {
  depositRequired: number;
  totalCharged: number;
  totalRefunded: number;
  balance: number;
  balanceStatus: BalanceStatus;
}

export function BalanceCard({
  depositRequired,
  totalCharged,
  totalRefunded,
  balance,
  balanceStatus,
}: BalanceCardProps) {
  const statusColors = BALANCE_STATUS_COLORS[balanceStatus];

  // Determine the status badge text
  let statusBadgeText = '';
  if (balanceStatus === 'paid') {
    statusBadgeText = '✓ PAID IN FULL';
  } else if (balanceStatus === 'underpaid') {
    statusBadgeText = 'BALANCE DUE';
  } else if (balanceStatus === 'overpaid') {
    statusBadgeText = 'REFUND DUE';
  } else if (balanceStatus === 'pending') {
    statusBadgeText = 'PENDING';
  }

  return (
    <div style={styles.card}>
      <h4 style={styles.title}>BALANCE</h4>
      <div style={styles.content}>
        <div style={styles.row}>
          <span style={styles.label}>Current Deposit Required:</span>
          <span style={styles.value}>{formatCurrency(depositRequired)}</span>
        </div>
        <div style={styles.row}>
          <span style={styles.label}>Total Charged:</span>
          <span style={{ ...styles.value, color: '#2e7d32' }}>
            -{formatCurrency(totalCharged)}
          </span>
        </div>
        <div style={styles.row}>
          <span style={styles.label}>Total Refunded:</span>
          <span style={{ ...styles.value, color: totalRefunded > 0 ? '#c62828' : '#666' }}>
            +{formatCurrency(totalRefunded)}
          </span>
        </div>

        <div style={styles.divider} />

        <div style={styles.balanceRow}>
          <span style={styles.balanceLabel}>BALANCE:</span>
          <div style={styles.balanceRight}>
            <span
              style={{
                ...styles.balanceValue,
                color: balance === 0 ? '#2e7d32' : balance > 0 ? '#e65100' : '#c62828',
              }}
            >
              {formatCurrency(Math.abs(balance))}
            </span>
            <span
              style={{
                ...styles.statusBadge,
                backgroundColor: statusColors.bg,
                color: statusColors.color,
              }}
            >
              {statusBadgeText}
            </span>
          </div>
        </div>
      </div>
    </div>
  );
}

const styles: Record<string, React.CSSProperties> = {
  card: {
    backgroundColor: '#f8f9fa',
    borderRadius: '8px',
    padding: '16px',
    border: '2px solid #e0e0e0',
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
    height: '2px',
    backgroundColor: '#ccc',
    margin: '8px 0',
  },
  balanceRow: {
    display: 'flex',
    justifyContent: 'space-between',
    alignItems: 'center',
  },
  balanceLabel: {
    fontSize: '15px',
    fontWeight: 700,
    color: '#333',
  },
  balanceRight: {
    display: 'flex',
    alignItems: 'center',
    gap: '12px',
  },
  balanceValue: {
    fontSize: '20px',
    fontWeight: 700,
  },
  statusBadge: {
    fontSize: '11px',
    fontWeight: 600,
    padding: '4px 8px',
    borderRadius: '4px',
    textTransform: 'uppercase',
    letterSpacing: '0.5px',
  },
};

export default BalanceCard;
