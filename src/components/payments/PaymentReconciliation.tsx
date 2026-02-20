import React, { useState } from 'react';
import { Order } from '../../types/order';
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
  order: Order;
  ledgerSummary: OrderLedgerSummary;
  ledgerEntries: PaymentLedgerEntry[];
  loading: boolean;
  onAddPayment: () => void;
  onRefresh?: () => void;
}

export function PaymentReconciliation({
  order: _order,
  ledgerSummary,
  ledgerEntries,
  loading,
  onAddPayment: _onAddPayment,
  onRefresh: _onRefresh,
}: PaymentReconciliationProps) {
  void _order; // kept in interface for future use
  void _onAddPayment;
  void _onRefresh;
  const [error] = useState<string | null>(null);

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

      {error && <div style={styles.error}>{error}</div>}

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
  error: {
    padding: '12px',
    backgroundColor: '#ffebee',
    color: '#c62828',
    borderRadius: '4px',
    fontSize: '14px',
    marginBottom: '16px',
  },
  actionRow: {
    display: 'flex',
    justifyContent: 'flex-end',
    marginTop: '8px',
  },
  addButton: {
    padding: '10px 20px',
    backgroundColor: '#1565c0',
    color: 'white',
    border: 'none',
    borderRadius: '4px',
    fontSize: '14px',
    cursor: 'pointer',
    fontWeight: 500,
  },
  modalOverlay: {
    position: 'fixed',
    top: 0,
    left: 0,
    right: 0,
    bottom: 0,
    backgroundColor: 'rgba(0, 0, 0, 0.5)',
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    zIndex: 1100,
  },
  modal: {
    backgroundColor: 'white',
    borderRadius: '12px',
    width: '90%',
    maxWidth: '400px',
    padding: '24px',
  },
  modalTitle: {
    margin: '0 0 16px 0',
    fontSize: '18px',
    fontWeight: 600,
    color: '#333',
  },
  modalContent: {
    marginBottom: '20px',
  },
  modalText: {
    margin: '0 0 12px 0',
    fontSize: '14px',
    color: '#333',
  },
  modalField: {
    marginTop: '16px',
  },
  modalLabel: {
    display: 'block',
    fontSize: '14px',
    fontWeight: 500,
    color: '#333',
    marginBottom: '6px',
  },
  modalInput: {
    width: '100%',
    padding: '10px 12px',
    border: '1px solid #ddd',
    borderRadius: '4px',
    fontSize: '14px',
    boxSizing: 'border-box' as const,
  },
  viewProofButton: {
    padding: '6px 12px',
    backgroundColor: '#e3f2fd',
    color: '#1565c0',
    border: 'none',
    borderRadius: '4px',
    fontSize: '13px',
    cursor: 'pointer',
  },
  modalActions: {
    display: 'flex',
    justifyContent: 'flex-end',
    gap: '12px',
  },
  cancelButton: {
    padding: '10px 20px',
    backgroundColor: 'white',
    color: '#666',
    border: '1px solid #ddd',
    borderRadius: '4px',
    fontSize: '14px',
    cursor: 'pointer',
  },
  confirmButton: {
    padding: '10px 20px',
    backgroundColor: '#4caf50',
    color: 'white',
    border: 'none',
    borderRadius: '4px',
    fontSize: '14px',
    cursor: 'pointer',
    fontWeight: 500,
  },
};

export default PaymentReconciliation;
