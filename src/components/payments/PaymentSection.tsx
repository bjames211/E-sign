import React, { useState, useEffect } from 'react';
import { Order } from '../../types/order';
import {
  PaymentRecord,
  PaymentSummary,
  PaymentLedgerEntry,
  OrderLedgerSummary,
} from '../../types/payment';
import {
  getLedgerEntriesForOrder,
} from '../../services/paymentService';
import { PaymentSummaryCard } from './PaymentSummaryCard';
import { PaymentHistoryTable } from './PaymentHistoryTable';
import { PaymentReconciliation } from './PaymentReconciliation';

interface PaymentSectionProps {
  order: Order;
  onRefresh?: () => void;
  readOnly?: boolean;
}

export function PaymentSection({ order, onRefresh: _onRefresh, readOnly: _readOnly = false }: PaymentSectionProps) {
  void _onRefresh;
  void _readOnly;
  const [payments, setPayments] = useState<PaymentRecord[]>([]);
  const [ledgerEntries, setLedgerEntries] = useState<PaymentLedgerEntry[]>([]);
  const [summary, setSummary] = useState<PaymentSummary | null>(null);
  const [ledgerSummary, setLedgerSummary] = useState<OrderLedgerSummary | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  // Always use ledger system now
  const depositRequired = order.ledgerSummary?.depositRequired || order.pricing?.deposit || 0;

  // If we have a cached ledgerSummary, show it immediately and load entries in background
  useEffect(() => {
    if (order.id) {
      if (order.ledgerSummary) {
        // Set summary immediately from cache — no loading spinner for summary
        setLedgerSummary(order.ledgerSummary);
        setSummary({
          totalPaid: order.ledgerSummary.netReceived || 0,
          totalPending: order.ledgerSummary.pendingReceived || 0,
          balance: order.ledgerSummary.balance || 0,
          paymentCount: order.ledgerSummary.entryCount || 0,
        });
        setLoading(false);
      }
      loadPayments();
    }
  }, [order.id]);

  const loadPayments = async () => {
    if (!order.id) return;

    setLoading(true);
    setError(null);

    try {
      // Load ledger entries (single source of truth)
      const entries = await getLedgerEntriesForOrder(order.id);
      setLedgerEntries(entries);
      setLedgerSummary(order.ledgerSummary || null);

      // Convert ledger entries to PaymentRecord format for compatibility with existing UI components
      const asPaymentRecords = entries.map(e => ({
        ...e,
        category: e.category as any,
        status: e.status as any,
      })) as unknown as PaymentRecord[];
      setPayments(asPaymentRecords);

      // Build summary from ledger
      if (order.ledgerSummary) {
        setSummary({
          totalPaid: order.ledgerSummary.netReceived || 0,
          totalPending: order.ledgerSummary.pendingReceived || 0,
          balance: order.ledgerSummary.balance || 0,
          paymentCount: order.ledgerSummary.entryCount || 0,
        });
      } else {
        // Calculate from entries if no cached summary
        let totalPaid = 0;
        let totalPending = 0;
        let totalRefunded = 0;
        for (const e of entries) {
          if (e.status === 'voided') continue;
          // Determine effective transaction type: use transactionType if present,
          // otherwise infer from category (legacy entries may lack transactionType)
          const effectiveType = e.transactionType || (e.category === 'refund' ? 'refund' : 'payment');
          if (effectiveType === 'refund') {
            if (e.status === 'verified' || e.status === 'approved') totalRefunded += e.amount;
          } else if (effectiveType === 'payment') {
            if (e.status === 'verified' || e.status === 'approved') totalPaid += e.amount;
            else if (e.status === 'pending') totalPending += e.amount;
          }
        }
        const net = totalPaid - totalRefunded;
        setSummary({
          totalPaid: net,
          totalPending,
          balance: depositRequired - net,
          paymentCount: entries.filter(e => e.status !== 'voided').length,
        });
      }
    } catch (err: any) {
      console.error('Failed to load payments:', err);
      setError(err.message || 'Failed to load payments');

      // Fallback: use cached ledger summary from order
      if (order.ledgerSummary) {
        setLedgerSummary(order.ledgerSummary);
        setSummary({
          totalPaid: order.ledgerSummary.netReceived,
          totalPending: order.ledgerSummary.pendingReceived,
          balance: order.ledgerSummary.balance,
          paymentCount: order.ledgerSummary.entryCount,
        });
      }
    } finally {
      setLoading(false);
    }
  };

  const handleViewProof = (payment: PaymentRecord) => {
    if (payment.proofFile?.downloadUrl) {
      window.open(payment.proofFile.downloadUrl, '_blank');
    }
  };

  // Use PaymentReconciliation view for ledger-based orders
  if (order.ledgerSummary) {
    return (
      <div style={styles.container}>
        {error && <div style={styles.error}>{error}</div>}

        <PaymentReconciliation
          ledgerSummary={order.ledgerSummary}
          ledgerEntries={ledgerEntries}
          loading={loading}
        />
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
        ledgerSummary={ledgerSummary || undefined}
        loading={loading}
        additionalDepositDue={order.additionalDepositDue}
        refundDue={order.refundDue}
      />

      {/* Payment History Header */}
      <div style={styles.historyHeader}>
        <h4 style={styles.historyTitle}>PAYMENT HISTORY</h4>
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
