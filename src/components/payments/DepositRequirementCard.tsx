import React from 'react';
import {
  PaymentLedgerEntry,
  formatCurrency,
  TRANSACTION_TYPE_COLORS,
} from '../../types/payment';

interface DepositRequirementCardProps {
  originalDeposit: number;
  currentDeposit: number;
  depositAdjustments: PaymentLedgerEntry[];
}

export function DepositRequirementCard({
  originalDeposit,
  currentDeposit,
  depositAdjustments,
}: DepositRequirementCardProps) {
  const hasAdjustments = depositAdjustments.length > 0;

  return (
    <div style={styles.card}>
      <h4 style={styles.title}>DEPOSIT REQUIREMENT</h4>
      <div style={styles.content}>
        <div style={styles.row}>
          <span style={styles.label}>Original Deposit:</span>
          <span style={styles.value}>{formatCurrency(originalDeposit)}</span>
        </div>

        {hasAdjustments && (
          <div style={styles.adjustments}>
            {depositAdjustments.map((entry) => {
              const isIncrease = entry.transactionType === 'deposit_increase';
              const sign = isIncrease ? '+' : '-';
              const colors = TRANSACTION_TYPE_COLORS[entry.transactionType];

              return (
                <div key={entry.id} style={styles.adjustmentRow}>
                  <span style={styles.adjustmentLabel}>
                    {entry.changeOrderNumber ? `├─ ${entry.changeOrderNumber}: ` : '├─ '}
                  </span>
                  <span
                    style={{
                      ...styles.adjustmentAmount,
                      color: colors.color,
                    }}
                  >
                    {sign}{formatCurrency(entry.amount)}
                  </span>
                  <span style={styles.adjustmentType}>
                    ({isIncrease ? 'deposit increase' : 'deposit decrease'})
                  </span>
                </div>
              );
            })}
          </div>
        )}

        {hasAdjustments && (
          <>
            <div style={styles.divider} />
            <div style={styles.row}>
              <span style={styles.currentLabel}>Current Deposit:</span>
              <span style={styles.currentValue}>{formatCurrency(currentDeposit)}</span>
            </div>
          </>
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
    gap: '4px',
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
  adjustments: {
    marginLeft: '8px',
    marginTop: '4px',
    marginBottom: '4px',
  },
  adjustmentRow: {
    display: 'flex',
    alignItems: 'center',
    gap: '4px',
    fontSize: '13px',
    marginBottom: '2px',
  },
  adjustmentLabel: {
    color: '#999',
    fontFamily: 'monospace',
  },
  adjustmentAmount: {
    fontWeight: 500,
  },
  adjustmentType: {
    color: '#999',
    fontSize: '11px',
    fontStyle: 'italic',
  },
  divider: {
    height: '1px',
    backgroundColor: '#ddd',
    margin: '8px 0',
  },
  currentLabel: {
    fontSize: '14px',
    fontWeight: 600,
    color: '#333',
  },
  currentValue: {
    fontSize: '16px',
    fontWeight: 700,
    color: '#333',
  },
};

export default DepositRequirementCard;
