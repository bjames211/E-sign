import React from 'react';
import { Order, OrderStatus, MANUAL_PAYMENT_TYPES, checkDepositDiscrepancy } from '../../types/order';
import { Timestamp } from 'firebase/firestore';

interface OrderCardProps {
  order: Order;
  onClick: () => void;
  onApprovePayment?: (orderId: string) => void;
  // Effective values from live change order (pending_signature)
  effectiveCOValues?: {
    deposit: number;
    total: number;
    changeOrderNumber?: string;
  };
}

// Signature status styles
const SIGNATURE_STATUS_STYLES: Record<string, { bg: string; color: string; label: string }> = {
  draft: { bg: '#f5f5f5', color: '#666', label: 'Not Sent' },
  sent_for_signature: { bg: '#e3f2fd', color: '#1565c0', label: 'Awaiting Signature' },
  signed: { bg: '#e8f5e9', color: '#2e7d32', label: 'Signed' },
  ready_for_manufacturer: { bg: '#e8f5e9', color: '#2e7d32', label: 'Signed' },
};

// Payment status styles
const PAYMENT_STATUS_STYLES: Record<string, { bg: string; color: string; label: string }> = {
  pending: { bg: '#fff3e0', color: '#e65100', label: 'Pending' },
  paid: { bg: '#e8f5e9', color: '#2e7d32', label: 'Paid' },
  manually_approved: { bg: '#e8f5e9', color: '#2e7d32', label: 'Approved' },
  failed: { bg: '#ffebee', color: '#c62828', label: 'Failed' },
};

// Overall order status (for the main badge)
const STATUS_STYLES: Record<OrderStatus, { bg: string; color: string; label: string }> = {
  draft: { bg: '#f5f5f5', color: '#666', label: 'Draft' },
  pending_payment: { bg: '#fff3e0', color: '#e65100', label: 'Pending Payment' },
  sent_for_signature: { bg: '#e3f2fd', color: '#1565c0', label: 'In Progress' },
  signed: { bg: '#e8f5e9', color: '#2e7d32', label: 'Signed' },
  ready_for_manufacturer: { bg: '#4caf50', color: 'white', label: 'Ready' },
};

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
      year: 'numeric',
    });
  } catch {
    return '-';
  }
}

export function OrderCard({ order, onClick, onApprovePayment, effectiveCOValues }: OrderCardProps) {
  const statusStyle = STATUS_STYLES[order.status] || STATUS_STYLES.draft;
  const customerName = `${order.customer?.firstName || ''} ${order.customer?.lastName || ''}`.trim() || 'Unknown';

  // Get signature status
  const signatureStatus = SIGNATURE_STATUS_STYLES[order.status] || SIGNATURE_STATUS_STYLES.draft;

  // Get payment status
  const paymentStatus = order.payment?.status || 'pending';
  const paymentStyle = PAYMENT_STATUS_STYLES[paymentStatus] || PAYMENT_STATUS_STYLES.pending;

  // Check if manual payment type that needs approval
  const isManualPaymentType = MANUAL_PAYMENT_TYPES.includes(order.payment?.type as any);
  const needsPaymentApproval = isManualPaymentType &&
    paymentStatus !== 'paid' &&
    paymentStatus !== 'manually_approved';

  // Format payment type for display
  const paymentTypeLabel = order.payment?.type?.replace(/_/g, ' ') || 'Unknown';

  // Check if there's a live CO with effective values
  const hasLiveCO = !!effectiveCOValues;

  // Use ledger summary if available (new single source of truth)
  // Otherwise fall back to legacy calculation for backward compatibility
  const ledgerSummary = order.ledgerSummary;

  let depositRequired = 0;
  let totalPaid = 0;
  let balanceDue = 0;

  if (ledgerSummary) {
    // Use ledger summary as base, but override with CO values if present
    totalPaid = ledgerSummary.netReceived;

    if (hasLiveCO) {
      // Live CO overrides deposit required
      depositRequired = effectiveCOValues.deposit;
      balanceDue = depositRequired - totalPaid;
    } else {
      depositRequired = ledgerSummary.depositRequired;
      balanceDue = ledgerSummary.balance;
    }
  } else {
    // Legacy calculation (for orders not yet migrated to ledger)
    depositRequired = order.pricing?.deposit || 0;

    // Use paymentSummary.totalPaid directly — it already reflects all recorded payments
    totalPaid = order.paymentSummary?.totalPaid ?? 0;

    // Add test payment amount if in test mode
    if (order.isTestMode && order.testPaymentAmount !== undefined && order.testPaymentAmount > 0) {
      totalPaid += order.testPaymentAmount;
    }

    // Calculate balance: required minus paid
    balanceDue = depositRequired - totalPaid;
  }

  const hasBalance = balanceDue !== 0;

  // Check for deposit discrepancy (calculate live or use stored value)
  const depositCheck = order.depositDiscrepancy || checkDepositDiscrepancy(
    order.building.manufacturer,
    order.pricing.subtotalBeforeTax,
    order.pricing.deposit
  );
  const hasDepositDiscrepancy = depositCheck.hasDiscrepancy;

  const handleApprovePayment = (e: React.MouseEvent) => {
    e.stopPropagation(); // Don't trigger card click
    if (order.id && onApprovePayment) {
      onApprovePayment(order.id);
    }
  };

  return (
    <div style={{...styles.card, ...(hasDepositDiscrepancy ? styles.cardWithFlag : {})}}>
      {/* Audit Flag Banner */}
      {hasDepositDiscrepancy && (
        <div style={styles.auditFlag}>
          Deposit: {depositCheck.actualPercent.toFixed(1)}% (expected {depositCheck.expectedPercent}%)
        </div>
      )}
      <div style={styles.cardContent} onClick={onClick}>
        <div style={styles.header}>
          <span style={styles.orderNumber}>{order.orderNumber}</span>
          <div style={styles.badges}>
            {order.needsManagerApproval && (
              <span style={styles.approvalBadge}>Needs Approval</span>
            )}
            {hasDepositDiscrepancy && (
              <span style={styles.auditBadge}>Audit</span>
            )}
            <span
              style={{
                ...styles.status,
                backgroundColor: statusStyle.bg,
                color: statusStyle.color,
              }}
            >
              {statusStyle.label}
            </span>
          </div>
        </div>

        <div style={styles.customerName}>{customerName || 'No customer name'}</div>

      <div style={styles.details}>
        <div style={styles.detailRow}>
          <span style={styles.detailLabel}>Building:</span>
          <span style={styles.detailValue}>
            {order.building.manufacturer} - {order.building.buildingType}
          </span>
        </div>
        <div style={styles.detailRow}>
          <span style={styles.detailLabel}>Size:</span>
          <span style={styles.detailValue}>
            {order.building.overallWidth} x {order.building.buildingLength}
          </span>
        </div>
        <div style={styles.detailRow}>
          <span style={styles.detailLabel}>Location:</span>
          <span style={styles.detailValue}>
            {order.customer.state} {order.customer.zip}
          </span>
        </div>
      </div>

      {/* Signature & Payment Status Section */}
      <div style={styles.statusSection}>
        <div style={styles.statusRow}>
          <span style={styles.statusLabel}>Signature:</span>
          <span
            style={{
              ...styles.statusBadge,
              backgroundColor: signatureStatus.bg,
              color: signatureStatus.color,
            }}
          >
            {signatureStatus.label}
          </span>
        </div>
        <div style={styles.statusRow}>
          <span style={styles.statusLabel}>Payment:</span>
          <span
            style={{
              ...styles.statusBadge,
              backgroundColor: hasBalance && (paymentStatus === 'paid' || paymentStatus === 'manually_approved')
                ? '#fff3e0'
                : paymentStyle.bg,
              color: hasBalance && (paymentStatus === 'paid' || paymentStatus === 'manually_approved')
                ? '#e65100'
                : paymentStyle.color,
            }}
          >
            {hasBalance && (paymentStatus === 'paid' || paymentStatus === 'manually_approved')
              ? 'Partial'
              : paymentStyle.label}
          </span>
          {hasBalance ? (
            <span style={{
              ...styles.balanceText,
              color: balanceDue > 0 ? '#e65100' : '#2e7d32',
            }}>
              {balanceDue > 0
                ? `$${balanceDue.toLocaleString()} due`
                : `$${Math.abs(balanceDue).toLocaleString()} overpaid`}
            </span>
          ) : (
            <span style={styles.paymentType}>({paymentTypeLabel})</span>
          )}
        </div>
      </div>

      {/* Approve Payment Button for manual payment types */}
      {needsPaymentApproval && onApprovePayment && (
        <button
          style={styles.approvePaymentButton}
          onClick={handleApprovePayment}
        >
          Approve Payment
        </button>
      )}

      {/* Change Order Indicator - only show if there's something to display */}
      {(order.activeChangeOrderStatus || (order.changeOrderCount && order.changeOrderCount > 0)) && (
        <div style={styles.changeOrderIndicator}>
          {order.activeChangeOrderStatus === 'draft' && (
            <span style={styles.coDraftBadge}>CO Draft</span>
          )}
          {order.activeChangeOrderStatus === 'pending_signature' && (
            <span style={styles.coPendingBadge}>CO Awaiting Sig</span>
          )}
          {!order.activeChangeOrderStatus && order.changeOrderCount && order.changeOrderCount > 0 && (
            <span style={styles.coCountBadge}>
              {order.changeOrderCount} Change Order{order.changeOrderCount > 1 ? 's' : ''}
            </span>
          )}
        </div>
      )}

      {/* Balance Status Card - show when payment has been made */}
      {(paymentStatus === 'paid' || paymentStatus === 'manually_approved' || totalPaid > 0) && (
        <div style={{
          ...styles.balanceCard,
          backgroundColor: balanceDue === 0 ? '#e8f5e9' : balanceDue > 0 ? '#fff3e0' : '#e3f2fd',
          borderColor: balanceDue === 0 ? '#a5d6a7' : balanceDue > 0 ? '#ffcc80' : '#90caf9',
        }}>
          <div style={styles.balanceCardHeader}>
            <span style={{
              ...styles.balanceCardIcon,
              backgroundColor: balanceDue === 0 ? '#2e7d32' : balanceDue > 0 ? '#e65100' : '#1565c0',
            }}>
              {balanceDue === 0 ? '✓' : balanceDue > 0 ? '!' : '$'}
            </span>
            <span style={{
              ...styles.balanceCardLabel,
              color: balanceDue === 0 ? '#2e7d32' : balanceDue > 0 ? '#e65100' : '#1565c0',
            }}>
              {balanceDue === 0 ? 'Paid Correctly' : balanceDue > 0 ? 'Balance Due' : 'Refund Due'}
            </span>
          </div>
          <div style={styles.balanceCardDetails}>
            <div style={styles.balanceCardRow}>
              <span>Required:</span>
              <span>${depositRequired.toLocaleString()}</span>
            </div>
            <div style={styles.balanceCardRow}>
              <span>Paid:</span>
              <span>${totalPaid.toLocaleString()}</span>
            </div>
            {balanceDue !== 0 && (
              <div style={{
                ...styles.balanceCardRow,
                ...styles.balanceCardTotal,
                color: balanceDue > 0 ? '#e65100' : '#1565c0',
              }}>
                <span>{balanceDue > 0 ? 'Owed:' : 'Refund:'}</span>
                <span style={styles.balanceCardAmount}>${Math.abs(balanceDue).toLocaleString()}</span>
              </div>
            )}
          </div>
        </div>
      )}

      <div style={styles.footer}>
        <div style={styles.pricing}>
          <span style={styles.priceLabel}>Total:</span>
          <span style={styles.priceValue}>
            ${(hasLiveCO ? effectiveCOValues.total : (order.pricing.subtotalBeforeTax + order.pricing.extraMoneyFluff)).toLocaleString()}
          </span>
          {hasLiveCO && (
            <span style={styles.oldTotal}>
              (was ${(order.pricing.subtotalBeforeTax + order.pricing.extraMoneyFluff).toLocaleString()})
            </span>
          )}
        </div>
        <div style={styles.date}>
          Created: {formatDate(order.createdAt)}
        </div>
      </div>
      </div>
    </div>
  );
}

const styles: Record<string, React.CSSProperties> = {
  card: {
    backgroundColor: 'white',
    borderRadius: '8px',
    overflow: 'hidden',
    boxShadow: '0 2px 4px rgba(0,0,0,0.1)',
    cursor: 'pointer',
    transition: 'transform 0.2s, box-shadow 0.2s',
  },
  cardWithFlag: {
    border: '2px solid #dc3545',
  },
  cardContent: {
    padding: '20px',
  },
  auditFlag: {
    backgroundColor: '#dc3545',
    color: 'white',
    fontSize: '12px',
    fontWeight: 600,
    padding: '6px 12px',
    textAlign: 'center' as const,
  },
  auditBadge: {
    fontSize: '11px',
    fontWeight: 500,
    padding: '4px 8px',
    borderRadius: '12px',
    backgroundColor: '#ffebee',
    color: '#dc3545',
  },
  header: {
    display: 'flex',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: '12px',
  },
  orderNumber: {
    fontSize: '14px',
    fontWeight: 600,
    color: '#2196F3',
  },
  badges: {
    display: 'flex',
    gap: '6px',
    alignItems: 'center',
  },
  status: {
    fontSize: '12px',
    fontWeight: 500,
    padding: '4px 10px',
    borderRadius: '12px',
  },
  approvalBadge: {
    fontSize: '11px',
    fontWeight: 500,
    padding: '4px 8px',
    borderRadius: '12px',
    backgroundColor: '#fff3e0',
    color: '#e65100',
  },
  paymentBadge: {
    fontSize: '11px',
    fontWeight: 500,
    padding: '4px 8px',
    borderRadius: '12px',
    backgroundColor: '#e3f2fd',
    color: '#1565c0',
  },
  customerName: {
    fontSize: '18px',
    fontWeight: 600,
    color: '#333',
    marginBottom: '12px',
  },
  details: {
    display: 'flex',
    flexDirection: 'column',
    gap: '6px',
    marginBottom: '12px',
  },
  detailRow: {
    display: 'flex',
    fontSize: '14px',
  },
  detailLabel: {
    color: '#666',
    width: '70px',
    flexShrink: 0,
  },
  detailValue: {
    color: '#333',
  },
  footer: {
    display: 'flex',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingTop: '12px',
    borderTop: '1px solid #eee',
  },
  pricing: {
    display: 'flex',
    alignItems: 'center',
    gap: '8px',
  },
  priceLabel: {
    fontSize: '14px',
    color: '#666',
  },
  priceValue: {
    fontSize: '18px',
    fontWeight: 600,
    color: '#2e7d32',
  },
  oldTotal: {
    fontSize: '11px',
    color: '#999',
    marginLeft: '6px',
    textDecoration: 'line-through',
  },
  date: {
    fontSize: '12px',
    color: '#999',
  },
  statusSection: {
    backgroundColor: '#f9f9f9',
    borderRadius: '6px',
    padding: '10px 12px',
    marginBottom: '12px',
  },
  statusRow: {
    display: 'flex',
    alignItems: 'center',
    gap: '8px',
    marginBottom: '6px',
  },
  statusLabel: {
    fontSize: '12px',
    fontWeight: 500,
    color: '#666',
    width: '70px',
  },
  statusBadge: {
    fontSize: '11px',
    fontWeight: 500,
    padding: '3px 8px',
    borderRadius: '10px',
  },
  paymentType: {
    fontSize: '11px',
    color: '#999',
  },
  balanceText: {
    fontSize: '12px',
    fontWeight: 500,
  },
  approvePaymentButton: {
    width: '100%',
    padding: '10px',
    backgroundColor: '#1565c0',
    color: 'white',
    border: 'none',
    borderRadius: '6px',
    fontSize: '13px',
    fontWeight: 500,
    cursor: 'pointer',
    marginBottom: '12px',
  },
  changeOrderIndicator: {
    marginBottom: '12px',
    padding: '8px 12px',
    backgroundColor: '#f5f5f5',
    borderRadius: '6px',
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
  },
  coDraftBadge: {
    fontSize: '12px',
    fontWeight: 500,
    padding: '4px 10px',
    borderRadius: '12px',
    backgroundColor: '#fff3e0',
    color: '#e65100',
  },
  coPendingBadge: {
    fontSize: '12px',
    fontWeight: 500,
    padding: '4px 10px',
    borderRadius: '12px',
    backgroundColor: '#e3f2fd',
    color: '#1565c0',
  },
  coCountBadge: {
    fontSize: '12px',
    fontWeight: 500,
    padding: '4px 10px',
    borderRadius: '12px',
    backgroundColor: '#f5f5f5',
    color: '#666',
  },
  additionalDepositDue: {
    marginBottom: '12px',
    padding: '10px 12px',
    backgroundColor: '#fff3e0',
    borderRadius: '6px',
    border: '1px solid #ffcc80',
    fontSize: '13px',
    fontWeight: 500,
    color: '#e65100',
    textAlign: 'center',
  },
  refundDue: {
    marginBottom: '12px',
    padding: '10px 12px',
    backgroundColor: '#e8f5e9',
    borderRadius: '6px',
    border: '1px solid #a5d6a7',
    fontSize: '13px',
    fontWeight: 500,
    color: '#2e7d32',
    textAlign: 'center',
  },
  // Balance Card styles
  balanceCard: {
    marginBottom: '12px',
    padding: '12px',
    borderRadius: '8px',
    border: '1px solid',
  },
  balanceCardHeader: {
    display: 'flex',
    alignItems: 'center',
    gap: '8px',
    marginBottom: '10px',
  },
  balanceCardIcon: {
    width: '22px',
    height: '22px',
    borderRadius: '50%',
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    color: 'white',
    fontWeight: 700,
    fontSize: '12px',
  },
  balanceCardLabel: {
    fontSize: '14px',
    fontWeight: 600,
  },
  balanceCardDetails: {
    display: 'flex',
    flexDirection: 'column',
    gap: '4px',
  },
  balanceCardRow: {
    display: 'flex',
    justifyContent: 'space-between',
    fontSize: '12px',
    color: '#666',
  },
  balanceCardTotal: {
    marginTop: '6px',
    paddingTop: '6px',
    borderTop: '1px solid rgba(0,0,0,0.1)',
    fontWeight: 600,
  },
  balanceCardAmount: {
    fontSize: '14px',
    fontWeight: 700,
  },
};
