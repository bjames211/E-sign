import React from 'react';
import {
  PaymentLedgerEntry,
  OrderLedgerSummary,
  getBalanceStatus,
} from '../../types/payment';
import {
  groupLedgerEntriesByType,
  calculateGroupedTotals,
} from '../../services/paymentService';
import { DepositRequirementCard } from './DepositRequirementCard';
import { MoneyReceivedSection } from './MoneyReceivedSection';
import { RefundsSection } from './RefundsSection';
import { BalanceCard } from './BalanceCard';

interface PaymentReconciliationProps {
  ledgerSummary: OrderLedgerSummary;
  ledgerEntries: PaymentLedgerEntry[];
  loading: boolean;
}

export function PaymentReconciliation({
  ledgerSummary,
  ledgerEntries,
  loading,
}: PaymentReconciliationProps) {
  const handleViewProof = (entry: PaymentLedgerEntry) => {
    if (entry.proofFile?.downloadUrl) {
      window.open(entry.proofFile.downloadUrl, '_blank');
    }
  };

  // Group entries by type
  const grouped = groupLedgerEntriesByType(ledgerEntries);
  const totals = calculateGroupedTotals(grouped);

  // Get values from ledger summary (single source of truth)
  const originalDeposit = ledgerSummary.originalDeposit;
  const currentDeposit = ledgerSummary.depositRequired;
  const balance = ledgerSummary.balance;
  const balanceStatus = getBalanceStatus(ledgerSummary);

  if (loading) {
    return (
      <div style={styles.container}>
        <div style={styles.header}>
          <h3 style={styles.title}>PAYMENT RECONCILIATION</h3>
        </div>
        <div style={styles.loading}>Loading payment data...</div>
      </div>
    );
  }

  return (
    <div style={styles.container}>
      <div style={styles.header}>
        <h3 style={styles.title}>PAYMENT RECONCILIATION</h3>
      </div>

      {/* Deposit Requirement - only show when there are adjustments */}
      {grouped.depositAdjustments.length > 0 && (
        <DepositRequirementCard
          originalDeposit={originalDeposit}
          currentDeposit={currentDeposit}
          depositAdjustments={grouped.depositAdjustments}
        />
      )}

      {/* Money Received */}
      <MoneyReceivedSection
        payments={grouped.payments}
        totalCharged={totals.totalCharged}
        pendingAmount={totals.pendingPayments}
        onViewProof={handleViewProof}
      />

      {/* Refunds Issued - only show when there are refunds */}
      {grouped.refunds.length > 0 && (
        <RefundsSection
          refunds={grouped.refunds}
          totalRefunded={totals.totalRefunded}
          pendingAmount={totals.pendingRefunds}
          onViewProof={handleViewProof}
        />
      )}

      {/* Balance Reconciliation */}
      <BalanceCard
        depositRequired={currentDeposit}
        totalCharged={totals.totalCharged}
        totalRefunded={totals.totalRefunded}
        balance={balance}
        balanceStatus={balanceStatus}
      />
    </div>
  );
}

const styles: Record<string, React.CSSProperties> = {
  container: {
    marginBottom: '24px',
  },
  header: {
    marginBottom: '16px',
  },
  title: {
    margin: 0,
    fontSize: '14px',
    fontWeight: 600,
    color: '#333',
    textTransform: 'uppercase',
    letterSpacing: '0.5px',
  },
  loading: {
    padding: '40px',
    textAlign: 'center',
    color: '#999',
    fontSize: '14px',
    backgroundColor: '#f8f9fa',
    borderRadius: '8px',
    border: '1px solid #e0e0e0',
  },
};

export default PaymentReconciliation;
