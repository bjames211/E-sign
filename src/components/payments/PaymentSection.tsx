import React, { useState, useEffect } from 'react';
import { Order } from '../../types/order';
import {
  PaymentRecord,
  PaymentSummary,
  PaymentMethod,
  AddPaymentFormData,
  calculatePaymentSummary,
  PaymentLedgerEntry,
  OrderLedgerSummary,
} from '../../types/payment';
import {
  getPaymentsForOrder,
  getLedgerEntriesForOrder,
} from '../../services/paymentService';
import { PaymentSummaryCard } from './PaymentSummaryCard';
import { PaymentHistoryTable } from './PaymentHistoryTable';
import { AddPaymentModal } from './AddPaymentModal';
import { ApprovePaymentModal } from './ApprovePaymentModal';
import { PaymentReconciliation } from './PaymentReconciliation';

interface PaymentSectionProps {
  order: Order;
  onRefresh?: () => void;
}

export function PaymentSection({ order, onRefresh }: PaymentSectionProps) {
  const [payments, setPayments] = useState<PaymentRecord[]>([]);
  const [_ledgerEntries, setLedgerEntries] = useState<PaymentLedgerEntry[]>([]);
  const [summary, setSummary] = useState<PaymentSummary | null>(null);
  const [ledgerSummary, setLedgerSummary] = useState<OrderLedgerSummary | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [showAddModal, setShowAddModal] = useState(false);
  const [_approving, setApproving] = useState<string | null>(null);
  const [paymentToApprove, setPaymentToApprove] = useState<PaymentRecord | null>(null);

  // Check if order uses ledger system
  const useLedgerSystem = !!order.ledgerSummary;
  const depositRequired = useLedgerSystem
    ? (order.ledgerSummary?.depositRequired || 0)
    : (order.pricing?.deposit || 0);

  useEffect(() => {
    if (order.id) {
      loadPayments();
    }
  }, [order.id]);

  const loadPayments = async () => {
    if (!order.id) return;

    setLoading(true);
    setError(null);

    try {
      // If order has ledger summary, use ledger entries
      if (useLedgerSystem) {
        const entries = await getLedgerEntriesForOrder(order.id);
        setLedgerEntries(entries);
        setLedgerSummary(order.ledgerSummary || null);

        // Also convert to PaymentSummary format for compatibility
        setSummary({
          totalPaid: order.ledgerSummary?.netReceived || 0,
          totalPending: order.ledgerSummary?.pendingReceived || 0,
          balance: order.ledgerSummary?.balance || 0,
          paymentCount: order.ledgerSummary?.entryCount || 0,
        });

        // Load legacy payments for display purposes (for hybrid view)
        const paymentRecords = await getPaymentsForOrder(order.id);
        setPayments(paymentRecords);
      } else {
        // Legacy mode - use payments collection
        const paymentRecords = await getPaymentsForOrder(order.id);
        setPayments(paymentRecords);

        // Calculate summary from payment records
        let computedSummary = calculatePaymentSummary(paymentRecords, depositRequired);

        // Check if we need to include legacy payment from order.payment
        const hasConfirmedLegacyPayment = order.payment?.status === 'paid' || order.payment?.status === 'manually_approved';
        const hasPendingLegacyPayment = order.payment?.status === 'pending';
        // Use testPaymentAmount if in test mode, otherwise use deposit amount
        const legacyPaymentAmount = (order.isTestMode && order.testPaymentAmount !== undefined)
          ? order.testPaymentAmount
          : (order.pricing?.deposit || 0);

        // Check if the legacy payment is already in the payments collection
        const hasLegacyPaymentRecord = paymentRecords.some(p =>
          (p.stripePaymentId && p.stripePaymentId === order.payment?.stripePaymentId) ||
          (p.category === 'initial_deposit')
        );

        // If there's a confirmed legacy payment that's not in the payments collection, add it to totals
        if (hasConfirmedLegacyPayment && !hasLegacyPaymentRecord && legacyPaymentAmount > 0) {
          computedSummary = {
            ...computedSummary,
            totalPaid: computedSummary.totalPaid + legacyPaymentAmount,
            balance: depositRequired - (computedSummary.totalPaid + legacyPaymentAmount),
            paymentCount: computedSummary.paymentCount + 1,
          };
        }

        // If there's a pending legacy payment, add it to pending totals (not paid)
        if (hasPendingLegacyPayment && !hasLegacyPaymentRecord && legacyPaymentAmount > 0) {
          computedSummary = {
            ...computedSummary,
            totalPending: (computedSummary.totalPending || 0) + legacyPaymentAmount,
            paymentCount: computedSummary.paymentCount + 1,
          };
        }

        // If test mode with initial test payment, add it to the totals
        if (order.isTestMode && order.testPaymentAmount !== undefined && order.testPaymentAmount > 0 && !hasConfirmedLegacyPayment && !hasPendingLegacyPayment) {
          computedSummary = {
            ...computedSummary,
            totalPaid: computedSummary.totalPaid + order.testPaymentAmount,
            balance: depositRequired - (computedSummary.totalPaid + order.testPaymentAmount),
            paymentCount: computedSummary.paymentCount + 1,
          };
        }

        setSummary(computedSummary);
      }
    } catch (err: any) {
      console.error('Failed to load payments:', err);
      setError(err.message || 'Failed to load payments');

      // Fallback: use order data if available
      if (useLedgerSystem && order.ledgerSummary) {
        setLedgerSummary(order.ledgerSummary);
        setSummary({
          totalPaid: order.ledgerSummary.netReceived,
          totalPending: order.ledgerSummary.pendingReceived,
          balance: order.ledgerSummary.balance,
          paymentCount: order.ledgerSummary.entryCount,
        });
      } else {
        // Legacy fallback
        const hasLegacyPayment = order.payment?.status === 'paid' || order.payment?.status === 'manually_approved';
        // Use testPaymentAmount if in test mode, otherwise use deposit amount
        const legacyPaymentAmount = (order.isTestMode && order.testPaymentAmount !== undefined)
          ? order.testPaymentAmount
          : (order.pricing?.deposit || 0);

        if (hasLegacyPayment && legacyPaymentAmount > 0) {
          setSummary({
            totalPaid: legacyPaymentAmount,
            totalPending: 0,
            balance: depositRequired - legacyPaymentAmount,
            paymentCount: 1,
          });
        } else if (order.isTestMode && order.testPaymentAmount !== undefined) {
          setSummary({
            totalPaid: order.testPaymentAmount,
            totalPending: 0,
            balance: depositRequired - order.testPaymentAmount,
            paymentCount: 1,
          });
        }
      }
    } finally {
      setLoading(false);
    }
  };

  const handleAddPayment = async (
    formData: AddPaymentFormData,
    proofFile?: { name: string; storagePath: string; downloadUrl: string; size: number; type: string }
  ) => {
    if (!order.id) {
      throw new Error('Order ID is required');
    }

    const amount = parseFloat(formData.amount);

    // Use ledger endpoint for ledger-based orders, otherwise use legacy payment record
    const endpoint = useLedgerSystem ? 'addLedgerEntry' : 'addPaymentRecord';

    // Determine transaction type for ledger
    const transactionType = formData.category === 'refund' ? 'refund' : 'payment';

    // For ledger entries, manual payments without approval code should be 'pending'
    // The backend will handle this, but we don't pass a status to let it default to 'pending'

    const requestBody = useLedgerSystem
      ? {
          // Ledger entry format
          orderId: order.id,
          orderNumber: order.orderNumber,
          transactionType,
          amount,
          method: formData.method,
          category: formData.category,
          stripePaymentId: formData.stripePaymentId || undefined,
          description: formData.description || `${formData.method} payment`,
          notes: formData.notes || undefined,
          proofFile: proofFile || undefined,
          approvalCode: formData.approvalCode || undefined,
          createdBy: order.createdBy || 'unknown',
          // Don't pass status - let backend determine based on method and approval code
        }
      : {
          // Legacy payment record format
          orderId: order.id,
          orderNumber: order.orderNumber,
          amount,
          method: formData.method,
          category: formData.category,
          stripePaymentId: formData.stripePaymentId || undefined,
          description: formData.description || undefined,
          notes: formData.notes || undefined,
          proofFile: proofFile || undefined,
          approvalCode: formData.approvalCode || undefined,
          createdBy: order.createdBy || 'unknown',
        };

    const response = await fetch(
      `${import.meta.env.VITE_FUNCTIONS_URL || ''}/${endpoint}`,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(requestBody),
      }
    );

    const data = await response.json();

    if (!data.success) {
      throw new Error(data.error || 'Failed to add payment');
    }

    // Reload payments
    await loadPayments();

    if (onRefresh) {
      onRefresh();
    }
  };

  // Show approve modal for a payment
  const handleApprovePayment = (paymentId: string) => {
    // Check for legacy pending payment
    if (paymentId === 'legacy-initial-payment-pending') {
      // Use testPaymentAmount if in test mode, otherwise use deposit amount
      const legacyPaymentAmount = (order.isTestMode && order.testPaymentAmount !== undefined)
        ? order.testPaymentAmount
        : (order.pricing?.deposit || 0);
      const legacyPaymentRecord: PaymentRecord = {
        id: 'legacy-initial-payment-pending',
        orderId: order.id || '',
        orderNumber: order.orderNumber,
        amount: legacyPaymentAmount,
        method: order.payment?.type?.includes('stripe') ? 'stripe' : (order.payment?.type as any) || 'other',
        category: 'initial_deposit',
        status: 'pending',
        description: `Initial deposit (${order.payment?.type?.replace(/_/g, ' ') || 'pending'})`,
        createdAt: order.createdAt,
        updatedAt: order.createdAt,
        createdBy: order.createdBy || 'system',
      };
      setPaymentToApprove(legacyPaymentRecord);
      return;
    }

    const payment = payments.find(p => p.id === paymentId);
    if (payment) {
      setPaymentToApprove(payment);
    }
  };

  // Actually approve the payment with method and details
  const handleConfirmApprove = async (
    paymentId: string,
    method: PaymentMethod,
    approvalCode: string,
    stripePaymentId?: string,
    proofFile?: { name: string; storagePath: string; downloadUrl: string; size: number; type: string }
  ) => {
    setApproving(paymentId);
    setError(null);

    try {
      // Handle legacy pending payment approval
      if (paymentId === 'legacy-initial-payment-pending') {
        // Call endpoint to approve the order's legacy payment and create ledger entry
        const response = await fetch(
          `${import.meta.env.VITE_FUNCTIONS_URL || ''}/approveLegacyPayment`,
          {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              orderId: order.id,
              orderNumber: order.orderNumber,
              approvalCode,
              approvedBy: 'Manager',
              method: method || order.payment?.type,
              amount: order.pricing?.deposit || 0,
              proofFile,
            }),
          }
        );

        const data = await response.json();

        if (!data.success) {
          throw new Error(data.error || 'Failed to approve payment');
        }

        await loadPayments();

        if (onRefresh) {
          onRefresh();
        }
        return;
      }

      // Regular payment approval
      const response = await fetch(
        `${import.meta.env.VITE_FUNCTIONS_URL || ''}/approvePaymentRecord`,
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            paymentId,
            approvalCode,
            approvedBy: 'Manager',
            method,
            stripePaymentId,
            proofFile,
          }),
        }
      );

      const data = await response.json();

      if (!data.success) {
        throw new Error(data.error || 'Failed to approve payment');
      }

      await loadPayments();

      if (onRefresh) {
        onRefresh();
      }
    } catch (err: any) {
      setError(err.message || 'Failed to approve payment');
      throw err; // Re-throw so modal can show error
    } finally {
      setApproving(null);
    }
  };

  const handleRejectPayment = async (paymentId: string) => {
    const reason = prompt('Enter rejection reason:');
    if (!reason) return;

    setApproving(paymentId);
    setError(null);

    try {
      const response = await fetch(
        `${import.meta.env.VITE_FUNCTIONS_URL || ''}/rejectPaymentRecord`,
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            paymentId,
            rejectedBy: 'Manager',
            reason,
          }),
        }
      );

      const data = await response.json();

      if (!data.success) {
        throw new Error(data.error || 'Failed to reject payment');
      }

      await loadPayments();

      if (onRefresh) {
        onRefresh();
      }
    } catch (err: any) {
      setError(err.message || 'Failed to reject payment');
    } finally {
      setApproving(null);
    }
  };

  const handleViewProof = (payment: PaymentRecord) => {
    if (payment.proofFile?.downloadUrl) {
      window.open(payment.proofFile.downloadUrl, '_blank');
    }
  };

  const currentBalance = summary?.balance ?? depositRequired;

  // Use new PaymentReconciliation view for ledger-based orders
  if (useLedgerSystem && order.ledgerSummary) {
    return (
      <div style={styles.container}>
        {error && <div style={styles.error}>{error}</div>}

        <PaymentReconciliation
          order={order}
          ledgerSummary={order.ledgerSummary}
          onAddPayment={() => setShowAddModal(true)}
          onRefresh={onRefresh}
        />

        {/* Add Payment Modal */}
        {showAddModal && order.id && (
          <AddPaymentModal
            orderId={order.id}
            orderNumber={order.orderNumber}
            depositRequired={depositRequired}
            currentBalance={currentBalance}
            onSubmit={handleAddPayment}
            onClose={() => setShowAddModal(false)}
          />
        )}

        {/* Approve Payment Modal */}
        {paymentToApprove && (
          <ApprovePaymentModal
            payment={paymentToApprove}
            orderNumber={order.orderNumber}
            onApprove={handleConfirmApprove}
            onClose={() => setPaymentToApprove(null)}
          />
        )}
      </div>
    );
  }

  // Legacy view for non-ledger orders
  return (
    <div style={styles.container}>
      {error && <div style={styles.error}>{error}</div>}

      {/* Summary Card */}
      <PaymentSummaryCard
        depositRequired={depositRequired}
        summary={summary}
        ledgerSummary={useLedgerSystem ? ledgerSummary : undefined}
        loading={loading}
        additionalDepositDue={order.additionalDepositDue}
        refundDue={order.refundDue}
      />

      {/* Payment History Header */}
      <div style={styles.historyHeader}>
        <h4 style={styles.historyTitle}>PAYMENT HISTORY</h4>
        <button
          onClick={() => setShowAddModal(true)}
          style={styles.addButton}
        >
          + Add Payment
        </button>
      </div>

      {/* Payment History Table */}
      <PaymentHistoryTable
        payments={(() => {
          // Check for legacy payment that's not in payments collection
          const hasConfirmedLegacyPayment = order.payment?.status === 'paid' || order.payment?.status === 'manually_approved';
          const hasPendingLegacyPayment = order.payment?.status === 'pending';
          // Use testPaymentAmount if in test mode, otherwise use deposit amount
        const legacyPaymentAmount = (order.isTestMode && order.testPaymentAmount !== undefined)
          ? order.testPaymentAmount
          : (order.pricing?.deposit || 0);
          const hasLegacyPaymentRecord = payments.some(p =>
            (p.stripePaymentId && p.stripePaymentId === order.payment?.stripePaymentId) ||
            (p.category === 'initial_deposit')
          );

          let displayPayments = [...payments];

          // Add confirmed legacy payment as first row if it exists and isn't in the payments collection
          if (hasConfirmedLegacyPayment && !hasLegacyPaymentRecord && legacyPaymentAmount > 0) {
            const legacyPaymentRecord: PaymentRecord = {
              id: 'legacy-initial-payment',
              orderId: order.id || '',
              orderNumber: order.orderNumber,
              amount: legacyPaymentAmount,
              method: order.payment?.type?.includes('stripe') ? 'stripe' : (order.payment?.type as any) || 'other',
              category: 'initial_deposit',
              status: order.payment?.status === 'paid' ? 'verified' : 'approved',
              description: `Initial deposit (${order.payment?.type?.replace(/_/g, ' ') || 'legacy'})`,
              createdAt: order.paidAt || order.createdAt,
              updatedAt: order.paidAt || order.createdAt,
              createdBy: order.createdBy || 'system',
              stripePaymentId: order.payment?.stripePaymentId,
            };
            displayPayments = [legacyPaymentRecord, ...displayPayments];
          }
          // Add pending legacy payment (needs manager approval)
          else if (hasPendingLegacyPayment && !hasLegacyPaymentRecord && legacyPaymentAmount > 0) {
            const pendingPaymentRecord: PaymentRecord = {
              id: 'legacy-initial-payment-pending',
              orderId: order.id || '',
              orderNumber: order.orderNumber,
              amount: legacyPaymentAmount,
              method: order.payment?.type?.includes('stripe') ? 'stripe' : (order.payment?.type as any) || 'other',
              category: 'initial_deposit',
              status: 'pending',
              description: `Initial deposit (${order.payment?.type?.replace(/_/g, ' ') || 'pending'}) - Needs Approval`,
              createdAt: order.createdAt,
              updatedAt: order.createdAt,
              createdBy: order.createdBy || 'system',
            };
            displayPayments = [pendingPaymentRecord, ...displayPayments];
          }
          // Include test payment if exists and no legacy payment
          else if (order.isTestMode && order.testPaymentAmount && order.testPaymentAmount > 0 && !hasConfirmedLegacyPayment && !hasPendingLegacyPayment) {
            const testPaymentRecord: PaymentRecord = {
              id: 'initial-test-payment',
              orderId: order.id || '',
              orderNumber: order.orderNumber,
              amount: order.testPaymentAmount,
              method: 'stripe',
              category: 'initial_deposit',
              status: 'approved',
              description: 'Initial deposit (test mode)',
              createdAt: order.createdAt,
              updatedAt: order.createdAt,
              createdBy: order.createdBy || 'system',
              stripePaymentId: order.payment?.stripePaymentId || 'test_initial',
              isTestPayment: true,
            };
            displayPayments = [testPaymentRecord, ...displayPayments];
          }

          return displayPayments;
        })()}
        loading={loading}
        onApprove={handleApprovePayment}
        onReject={handleRejectPayment}
        onViewProof={handleViewProof}
      />

      {/* Legacy Payment Info - Show if no payment records exist */}
      {!loading && payments.length === 0 && order.payment && (
        <div style={styles.legacyInfo}>
          <div style={styles.legacyTitle}>Legacy Payment Info</div>
          <div style={styles.legacyGrid}>
            <div style={styles.legacyItem}>
              <span style={styles.legacyLabel}>Type:</span>
              <span style={styles.legacyValue}>{order.payment.type?.replace(/_/g, ' ') || '-'}</span>
            </div>
            <div style={styles.legacyItem}>
              <span style={styles.legacyLabel}>Status:</span>
              <span style={styles.legacyValue}>{order.payment.status || '-'}</span>
            </div>
            {order.payment.stripePaymentId && (
              <div style={styles.legacyItem}>
                <span style={styles.legacyLabel}>Stripe ID:</span>
                <span style={styles.legacyValue}>{order.payment.stripePaymentId}</span>
              </div>
            )}
          </div>
          {order.payment.status === 'paid' || order.payment.status === 'manually_approved' ? (
            <div style={styles.legacyNote}>
              This payment was recorded in the legacy system. Add a new payment record to migrate.
            </div>
          ) : null}
        </div>
      )}

      {/* Add Payment Modal */}
      {showAddModal && order.id && (
        <AddPaymentModal
          orderId={order.id}
          orderNumber={order.orderNumber}
          depositRequired={depositRequired}
          currentBalance={currentBalance}
          onSubmit={handleAddPayment}
          onClose={() => setShowAddModal(false)}
        />
      )}

      {/* Approve Payment Modal */}
      {paymentToApprove && (
        <ApprovePaymentModal
          payment={paymentToApprove}
          orderNumber={order.orderNumber}
          onApprove={handleConfirmApprove}
          onClose={() => setPaymentToApprove(null)}
        />
      )}
    </div>
  );
}

const styles: Record<string, React.CSSProperties> = {
  container: {
    marginBottom: '24px',
  },
  error: {
    padding: '12px',
    backgroundColor: '#ffebee',
    color: '#c62828',
    borderRadius: '4px',
    fontSize: '14px',
    marginBottom: '16px',
  },
  historyHeader: {
    display: 'flex',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: '12px',
  },
  historyTitle: {
    margin: 0,
    fontSize: '12px',
    fontWeight: 600,
    color: '#666',
    textTransform: 'uppercase',
    letterSpacing: '0.5px',
  },
  addButton: {
    padding: '8px 16px',
    backgroundColor: '#1565c0',
    color: 'white',
    border: 'none',
    borderRadius: '4px',
    fontSize: '13px',
    cursor: 'pointer',
    fontWeight: 500,
  },
  legacyInfo: {
    marginTop: '16px',
    padding: '16px',
    backgroundColor: '#f5f5f5',
    borderRadius: '8px',
    border: '1px dashed #ccc',
  },
  legacyTitle: {
    fontSize: '12px',
    fontWeight: 600,
    color: '#666',
    marginBottom: '12px',
    textTransform: 'uppercase',
  },
  legacyGrid: {
    display: 'grid',
    gridTemplateColumns: '1fr 1fr',
    gap: '8px',
  },
  legacyItem: {
    display: 'flex',
    justifyContent: 'space-between',
    fontSize: '13px',
  },
  legacyLabel: {
    color: '#666',
  },
  legacyValue: {
    color: '#333',
    fontWeight: 500,
  },
  legacyNote: {
    marginTop: '12px',
    padding: '8px 12px',
    backgroundColor: '#fff3e0',
    color: '#e65100',
    borderRadius: '4px',
    fontSize: '12px',
    fontStyle: 'italic',
  },
};

export default PaymentSection;
