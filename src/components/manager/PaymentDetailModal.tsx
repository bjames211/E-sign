import React, { useState, useEffect } from 'react';
import {
  PaymentAuditEntry,
  TRANSACTION_TYPE_LABELS,
  TRANSACTION_TYPE_COLORS,
  PAYMENT_METHOD_LABELS,
  AUDIT_ACTION_LABELS,
  AUDIT_ACTION_COLORS,
  formatCurrency,
  LedgerEntryStatus,
  PaymentAuditAction,
} from '../../types/payment';
import { getPaymentAuditHistory, EnrichedLedgerEntry, voidLedgerEntry } from '../../services/paymentService';

interface PaymentDetailModalProps {
  payment: EnrichedLedgerEntry | null;
  onClose: () => void;
  onViewOrder: (orderNumber: string) => void;
  onVoided: () => void;
}

// Status badge component
const StatusBadge: React.FC<{ status: LedgerEntryStatus }> = ({ status }) => {
  const statusConfig: Record<LedgerEntryStatus, { bg: string; color: string; label: string }> = {
    pending: { bg: '#fff3e0', color: '#e65100', label: 'Pending' },
    verified: { bg: '#e8f5e9', color: '#2e7d32', label: 'Verified' },
    approved: { bg: '#e8f5e9', color: '#2e7d32', label: 'Approved' },
    voided: { bg: '#ffebee', color: '#c62828', label: 'Voided' },
  };

  const config = statusConfig[status] || statusConfig.pending;

  return (
    <span
      style={{
        padding: '4px 12px',
        borderRadius: '16px',
        fontSize: '13px',
        fontWeight: 500,
        backgroundColor: config.bg,
        color: config.color,
      }}
    >
      {status === 'verified' ? '\u2713 ' : status === 'voided' ? '\u2717 ' : ''}
      {config.label}
    </span>
  );
};

// Audit action badge
const ActionBadge: React.FC<{ action: PaymentAuditAction }> = ({ action }) => {
  const config = AUDIT_ACTION_COLORS[action] || { bg: '#f5f5f5', color: '#666' };
  const label = AUDIT_ACTION_LABELS[action] || action;

  return (
    <span
      style={{
        padding: '2px 8px',
        borderRadius: '12px',
        fontSize: '11px',
        fontWeight: 500,
        backgroundColor: config.bg,
        color: config.color,
      }}
    >
      {label}
    </span>
  );
};

export function PaymentDetailModal({
  payment,
  onClose,
  onViewOrder,
  onVoided,
}: PaymentDetailModalProps) {
  const [auditHistory, setAuditHistory] = useState<PaymentAuditEntry[]>([]);
  const [loadingAudit, setLoadingAudit] = useState(false);
  const [voidReason, setVoidReason] = useState('');
  const [showVoidForm, setShowVoidForm] = useState(false);
  const [voiding, setVoiding] = useState(false);

  // Load audit history when payment changes
  useEffect(() => {
    if (payment?.id) {
      loadAuditHistory();
    }
  }, [payment?.id]);

  const loadAuditHistory = async () => {
    if (!payment?.id) return;

    setLoadingAudit(true);
    try {
      const history = await getPaymentAuditHistory(payment.id);
      setAuditHistory(history);
    } catch (err) {
      console.error('Failed to load audit history:', err);
    } finally {
      setLoadingAudit(false);
    }
  };

  const handleVoid = async () => {
    if (!payment?.id || !voidReason.trim()) {
      alert('Please enter a reason for voiding');
      return;
    }

    setVoiding(true);
    try {
      await voidLedgerEntry(payment.id, 'manager', voidReason.trim());
      alert('Payment voided successfully');
      setShowVoidForm(false);
      setVoidReason('');
      onVoided();
      onClose();
    } catch (err: any) {
      alert(`Failed to void payment: ${err.message}`);
    } finally {
      setVoiding(false);
    }
  };

  // Format date for display
  const formatDate = (timestamp: any): string => {
    if (!timestamp) return '-';
    try {
      let date: Date;
      if (timestamp.toDate) {
        date = timestamp.toDate();
      } else if (timestamp.seconds) {
        date = new Date(timestamp.seconds * 1000);
      } else if (timestamp._seconds) {
        date = new Date(timestamp._seconds * 1000);
      } else {
        return '-';
      }

      return date.toLocaleDateString('en-US', {
        month: 'short',
        day: 'numeric',
        year: 'numeric',
        hour: '2-digit',
        minute: '2-digit',
      });
    } catch {
      return '-';
    }
  };

  if (!payment) return null;

  const typeConfig = TRANSACTION_TYPE_COLORS[payment.transactionType] || {
    bg: '#f5f5f5',
    color: '#666',
  };

  return (
    <div
      style={{
        position: 'fixed',
        top: 0,
        left: 0,
        right: 0,
        bottom: 0,
        backgroundColor: 'rgba(0, 0, 0, 0.5)',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        zIndex: 1000,
      }}
      onClick={onClose}
    >
      <div
        style={{
          backgroundColor: 'white',
          borderRadius: '8px',
          width: '90%',
          maxWidth: '600px',
          maxHeight: '90vh',
          overflow: 'hidden',
          display: 'flex',
          flexDirection: 'column',
        }}
        onClick={(e) => e.stopPropagation()}
      >
        {/* Header */}
        <div
          style={{
            padding: '20px',
            borderBottom: '1px solid #eee',
            display: 'flex',
            justifyContent: 'space-between',
            alignItems: 'center',
          }}
        >
          <h2 style={{ margin: 0, fontSize: '18px', fontWeight: 600 }}>Payment Details</h2>
          <button
            onClick={onClose}
            style={{
              background: 'none',
              border: 'none',
              fontSize: '24px',
              cursor: 'pointer',
              color: '#666',
              lineHeight: 1,
            }}
          >
            &times;
          </button>
        </div>

        {/* Content */}
        <div style={{ flex: 1, overflow: 'auto', padding: '20px' }}>
          {/* Payment Info */}
          <div
            style={{
              display: 'grid',
              gridTemplateColumns: '140px 1fr',
              gap: '12px 16px',
              marginBottom: '24px',
            }}
          >
            <div style={{ color: '#666', fontSize: '14px' }}>Payment ID:</div>
            <div style={{ fontFamily: 'monospace', fontSize: '14px', fontWeight: 500 }}>
              {payment.paymentNumber || payment.id}
            </div>

            <div style={{ color: '#666', fontSize: '14px' }}>Order:</div>
            <div>
              <button
                onClick={() => onViewOrder(payment.orderNumber)}
                style={{
                  background: 'none',
                  border: 'none',
                  color: '#1976d2',
                  cursor: 'pointer',
                  fontFamily: 'monospace',
                  fontSize: '14px',
                  padding: 0,
                  textDecoration: 'underline',
                }}
              >
                {payment.orderNumber}
              </button>
              {payment.customerName && (
                <span style={{ color: '#666', marginLeft: '8px' }}>({payment.customerName})</span>
              )}
            </div>

            <div style={{ color: '#666', fontSize: '14px' }}>Amount:</div>
            <div
              style={{
                fontSize: '18px',
                fontWeight: 600,
                color:
                  payment.transactionType === 'refund' ||
                  payment.transactionType === 'deposit_decrease'
                    ? '#c62828'
                    : '#2e7d32',
              }}
            >
              {payment.transactionType === 'refund' ||
              payment.transactionType === 'deposit_decrease'
                ? '-'
                : ''}
              {formatCurrency(payment.amount)}
            </div>

            <div style={{ color: '#666', fontSize: '14px' }}>Type:</div>
            <div>
              <span
                style={{
                  padding: '4px 12px',
                  borderRadius: '16px',
                  fontSize: '13px',
                  fontWeight: 500,
                  backgroundColor: typeConfig.bg,
                  color: typeConfig.color,
                }}
              >
                {TRANSACTION_TYPE_LABELS[payment.transactionType] || payment.transactionType}
              </span>
            </div>

            <div style={{ color: '#666', fontSize: '14px' }}>Method:</div>
            <div style={{ fontSize: '14px' }}>
              {PAYMENT_METHOD_LABELS[payment.method] || payment.method}
            </div>

            <div style={{ color: '#666', fontSize: '14px' }}>Status:</div>
            <div>
              <StatusBadge status={payment.status} />
            </div>

            {payment.stripePaymentId && (
              <>
                <div style={{ color: '#666', fontSize: '14px' }}>Stripe ID:</div>
                <div style={{ fontFamily: 'monospace', fontSize: '13px', color: '#666' }}>
                  {payment.stripePaymentId}
                </div>
              </>
            )}

            <div style={{ color: '#666', fontSize: '14px' }}>Created:</div>
            <div style={{ fontSize: '14px' }}>{formatDate(payment.createdAt)}</div>

            {payment.description && (
              <>
                <div style={{ color: '#666', fontSize: '14px' }}>Description:</div>
                <div style={{ fontSize: '14px' }}>{payment.description}</div>
              </>
            )}

            {payment.notes && (
              <>
                <div style={{ color: '#666', fontSize: '14px' }}>Notes:</div>
                <div style={{ fontSize: '14px' }}>{payment.notes}</div>
              </>
            )}

            {payment.status === 'voided' && payment.voidReason && (
              <>
                <div style={{ color: '#c62828', fontSize: '14px' }}>Void Reason:</div>
                <div style={{ fontSize: '14px', color: '#c62828' }}>{payment.voidReason}</div>
              </>
            )}
          </div>

          {/* Proof File */}
          {payment.proofFile && (
            <div style={{ marginBottom: '24px' }}>
              <h3 style={{ margin: '0 0 12px 0', fontSize: '14px', fontWeight: 600, color: '#666' }}>
                Proof File
              </h3>
              <a
                href={payment.proofFile.downloadUrl}
                target="_blank"
                rel="noopener noreferrer"
                style={{
                  display: 'inline-flex',
                  alignItems: 'center',
                  gap: '8px',
                  padding: '8px 16px',
                  backgroundColor: '#f5f5f5',
                  borderRadius: '4px',
                  color: '#1976d2',
                  textDecoration: 'none',
                  fontSize: '14px',
                }}
              >
                <span>{'\ud83d\udcce'}</span>
                {payment.proofFile.name}
              </a>
            </div>
          )}

          {/* Audit History */}
          <div>
            <h3 style={{ margin: '0 0 12px 0', fontSize: '14px', fontWeight: 600, color: '#666' }}>
              Audit History
            </h3>

            {loadingAudit ? (
              <div style={{ color: '#666', fontSize: '14px' }}>Loading audit history...</div>
            ) : auditHistory.length === 0 ? (
              <div style={{ color: '#999', fontSize: '14px', fontStyle: 'italic' }}>
                No audit history available
              </div>
            ) : (
              <div
                style={{
                  border: '1px solid #eee',
                  borderRadius: '4px',
                  overflow: 'hidden',
                }}
              >
                {auditHistory.map((entry, index) => (
                  <div
                    key={entry.id || index}
                    style={{
                      padding: '12px 16px',
                      borderBottom: index < auditHistory.length - 1 ? '1px solid #eee' : 'none',
                      display: 'flex',
                      alignItems: 'flex-start',
                      gap: '12px',
                    }}
                  >
                    <div
                      style={{
                        width: '8px',
                        height: '8px',
                        borderRadius: '50%',
                        backgroundColor:
                          AUDIT_ACTION_COLORS[entry.action]?.color || '#666',
                        marginTop: '6px',
                        flexShrink: 0,
                      }}
                    />
                    <div style={{ flex: 1 }}>
                      <div
                        style={{
                          display: 'flex',
                          alignItems: 'center',
                          gap: '8px',
                          marginBottom: '4px',
                        }}
                      >
                        <span style={{ fontSize: '13px', color: '#666' }}>
                          {formatDate(entry.timestamp)}
                        </span>
                        <ActionBadge action={entry.action} />
                      </div>
                      <div style={{ fontSize: '14px' }}>
                        {entry.details || `Status changed to ${entry.newStatus}`}
                      </div>
                      {entry.userEmail && (
                        <div style={{ fontSize: '12px', color: '#999', marginTop: '2px' }}>
                          by {entry.userEmail || entry.userId}
                        </div>
                      )}
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>

          {/* Void Form */}
          {showVoidForm && payment.status !== 'voided' && (
            <div
              style={{
                marginTop: '24px',
                padding: '16px',
                backgroundColor: '#ffebee',
                borderRadius: '4px',
              }}
            >
              <h4 style={{ margin: '0 0 12px 0', color: '#c62828', fontSize: '14px' }}>
                Void This Payment
              </h4>
              <textarea
                value={voidReason}
                onChange={(e) => setVoidReason(e.target.value)}
                placeholder="Enter reason for voiding this payment..."
                style={{
                  width: '100%',
                  padding: '8px 12px',
                  border: '1px solid #ddd',
                  borderRadius: '4px',
                  fontSize: '14px',
                  minHeight: '80px',
                  resize: 'vertical',
                  marginBottom: '12px',
                }}
              />
              <div style={{ display: 'flex', gap: '8px' }}>
                <button
                  onClick={handleVoid}
                  disabled={voiding || !voidReason.trim()}
                  style={{
                    padding: '8px 16px',
                    backgroundColor: '#c62828',
                    color: 'white',
                    border: 'none',
                    borderRadius: '4px',
                    cursor: voiding || !voidReason.trim() ? 'not-allowed' : 'pointer',
                    opacity: voiding || !voidReason.trim() ? 0.5 : 1,
                    fontSize: '14px',
                  }}
                >
                  {voiding ? 'Voiding...' : 'Confirm Void'}
                </button>
                <button
                  onClick={() => {
                    setShowVoidForm(false);
                    setVoidReason('');
                  }}
                  style={{
                    padding: '8px 16px',
                    backgroundColor: 'white',
                    border: '1px solid #ddd',
                    borderRadius: '4px',
                    cursor: 'pointer',
                    fontSize: '14px',
                  }}
                >
                  Cancel
                </button>
              </div>
            </div>
          )}
        </div>

        {/* Footer */}
        <div
          style={{
            padding: '16px 20px',
            borderTop: '1px solid #eee',
            display: 'flex',
            justifyContent: 'space-between',
            alignItems: 'center',
          }}
        >
          <div>
            {payment.status !== 'voided' && !showVoidForm && (
              <button
                onClick={() => setShowVoidForm(true)}
                style={{
                  padding: '8px 16px',
                  backgroundColor: '#ffebee',
                  color: '#c62828',
                  border: '1px solid #c62828',
                  borderRadius: '4px',
                  cursor: 'pointer',
                  fontSize: '14px',
                }}
              >
                Void Payment
              </button>
            )}
          </div>
          <div style={{ display: 'flex', gap: '8px' }}>
            <button
              onClick={() => onViewOrder(payment.orderNumber)}
              style={{
                padding: '8px 16px',
                backgroundColor: '#1976d2',
                color: 'white',
                border: 'none',
                borderRadius: '4px',
                cursor: 'pointer',
                fontSize: '14px',
              }}
            >
              View Order
            </button>
            <button
              onClick={onClose}
              style={{
                padding: '8px 16px',
                backgroundColor: '#f5f5f5',
                border: '1px solid #ddd',
                borderRadius: '4px',
                cursor: 'pointer',
                fontSize: '14px',
              }}
            >
              Close
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}

export default PaymentDetailModal;
