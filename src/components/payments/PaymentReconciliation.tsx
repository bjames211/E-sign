import React, { useState } from 'react';
import { Order } from '../../types/order';
import {
  PaymentLedgerEntry,
  OrderLedgerSummary,
  getBalanceStatus,
  PAYMENT_METHOD_LABELS,
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
  onAddPayment,
  onRefresh,
}: PaymentReconciliationProps) {
  void _order; // kept in interface for future use
  const [error, setError] = useState<string | null>(null);
  const [approvingId, setApprovingId] = useState<string | null>(null);
  const [approvalCode, setApprovalCode] = useState<string>('');
  const [showApprovalModal, setShowApprovalModal] = useState<PaymentLedgerEntry | null>(null);

  const handleViewProof = (entry: PaymentLedgerEntry) => {
    if (entry.proofFile?.downloadUrl) {
      window.open(entry.proofFile.downloadUrl, '_blank');
    }
  };

  const handleApproveClick = (entry: PaymentLedgerEntry) => {
    setShowApprovalModal(entry);
    setApprovalCode('');
  };

  const handleApproveConfirm = async () => {
    if (!showApprovalModal || !approvalCode || !showApprovalModal.id) return;

    setApprovingId(showApprovalModal.id);
    setError(null);

    try {
      const response = await fetch(
        `${import.meta.env.VITE_FUNCTIONS_URL || ''}/approveLedgerEntry`,
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            entryId: showApprovalModal.id,
            approvalCode,
            approvedBy: 'Manager',
          }),
        }
      );

      const data = await response.json();

      if (!data.success) {
        throw new Error(data.error || 'Failed to approve payment');
      }

      setShowApprovalModal(null);

      // Trigger parent to reload data (entries + order)
      if (onRefresh) {
        onRefresh();
      }
    } catch (err: any) {
      setError(err.message || 'Failed to approve payment');
    } finally {
      setApprovingId(null);
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

      {/* Deposit Requirement */}
      <DepositRequirementCard
        originalDeposit={originalDeposit}
        currentDeposit={currentDeposit}
        depositAdjustments={grouped.depositAdjustments}
      />

      {/* Money Received */}
      <MoneyReceivedSection
        payments={grouped.payments}
        totalCharged={totals.totalCharged}
        pendingAmount={totals.pendingPayments}
        onViewProof={handleViewProof}
        onApprove={handleApproveClick}
        approvingId={approvingId}
      />

      {/* Refunds Issued */}
      <RefundsSection
        refunds={grouped.refunds}
        totalRefunded={totals.totalRefunded}
        pendingAmount={totals.pendingRefunds}
        onViewProof={handleViewProof}
        onApprove={handleApproveClick}
        approvingId={approvingId}
      />

      {/* Balance Reconciliation */}
      <BalanceCard
        depositRequired={currentDeposit}
        totalCharged={totals.totalCharged}
        totalRefunded={totals.totalRefunded}
        balance={balance}
        balanceStatus={balanceStatus}
      />

      {/* Add Payment Button */}
      <div style={styles.actionRow}>
        <button onClick={onAddPayment} style={styles.addButton}>
          + Add Payment
        </button>
      </div>

      {/* Approval Modal */}
      {showApprovalModal && (
        <div style={styles.modalOverlay}>
          <div style={styles.modal}>
            <h4 style={styles.modalTitle}>Approve Payment</h4>
            <div style={styles.modalContent}>
              <p style={styles.modalText}>
                Approve <strong>{PAYMENT_METHOD_LABELS[showApprovalModal.method] || showApprovalModal.method}</strong> payment of{' '}
                <strong>${showApprovalModal.amount.toFixed(2)}</strong>?
              </p>
              {showApprovalModal.proofFile && (
                <button
                  onClick={() => handleViewProof(showApprovalModal)}
                  style={styles.viewProofButton}
                >
                  View Proof
                </button>
              )}
              <div style={styles.modalField}>
                <label style={styles.modalLabel}>Manager Approval Code</label>
                <input
                  type="password"
                  value={approvalCode}
                  onChange={(e) => setApprovalCode(e.target.value)}
                  style={styles.modalInput}
                  placeholder="Enter approval code"
                  autoFocus
                />
              </div>
            </div>
            <div style={styles.modalActions}>
              <button
                onClick={() => setShowApprovalModal(null)}
                style={styles.cancelButton}
              >
                Cancel
              </button>
              <button
                onClick={handleApproveConfirm}
                disabled={!approvalCode || approvingId === showApprovalModal.id}
                style={styles.confirmButton}
              >
                {approvingId === showApprovalModal.id ? 'Approving...' : 'Approve'}
              </button>
            </div>
          </div>
        </div>
      )}
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
