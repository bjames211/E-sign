import React, { useState, useEffect } from 'react';
import { Order } from '../../types/order';
import {
  ChangeOrder,
  ChangeOrderFormData,
  ChangeOrderPendingFiles,
  calculateTotal,
  calculateDifferences,
  PricingSnapshot,
  initialChangeOrderPendingFiles,
} from '../../types/changeOrder';
import { ChangeOrderFileUpload } from './ChangeOrderFileUpload';

interface ChangeOrderFormProps {
  order: Order;
  existingChangeOrder?: ChangeOrder | null;
  onSave: (formData: ChangeOrderFormData) => Promise<void>;
  onSendForSignature: () => Promise<void>;
  onCancel: () => void;
  onDelete?: () => Promise<void>;
}

// Dynamic style functions
const getDiffBadgeStyle = (value: number): React.CSSProperties => ({
  fontSize: '12px',
  fontWeight: 500,
  padding: '2px 8px',
  borderRadius: '4px',
  alignSelf: 'flex-start',
  backgroundColor: value === 0 ? '#f5f5f5' : value > 0 ? '#e8f5e9' : '#ffebee',
  color: value === 0 ? '#666' : value > 0 ? '#2e7d32' : '#c62828',
});

const getSummaryValueStyle = (value: number): React.CSSProperties => ({
  fontWeight: 600,
  color: value === 0 ? '#666' : value > 0 ? '#2e7d32' : '#c62828',
});

export function ChangeOrderForm({
  order,
  existingChangeOrder,
  onSave,
  onSendForSignature,
  onCancel,
  onDelete,
}: ChangeOrderFormProps) {
  const [formData, setFormData] = useState<ChangeOrderFormData>({
    reason: '',
    newValues: {
      subtotalBeforeTax: order.pricing.subtotalBeforeTax.toString(),
      extraMoneyFluff: order.pricing.extraMoneyFluff.toString(),
      deposit: order.pricing.deposit.toString(),
    },
    editCustomer: false,
    editBuilding: false,
    customer: undefined,
    building: undefined,
    customerChanges: [],
    buildingChanges: [],
    pendingFiles: initialChangeOrderPendingFiles,
  });
  const [saving, setSaving] = useState(false);
  const [sending, setSending] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Load existing change order data if editing
  useEffect(() => {
    if (existingChangeOrder) {
      setFormData({
        reason: existingChangeOrder.reason,
        newValues: {
          subtotalBeforeTax: existingChangeOrder.newValues.subtotalBeforeTax.toString(),
          extraMoneyFluff: existingChangeOrder.newValues.extraMoneyFluff.toString(),
          deposit: existingChangeOrder.newValues.deposit.toString(),
        },
        editCustomer: !!existingChangeOrder.newCustomer,
        editBuilding: !!existingChangeOrder.newBuilding,
        customer: existingChangeOrder.newCustomer,
        building: existingChangeOrder.newBuilding,
        customerChanges: existingChangeOrder.customerChanges || [],
        buildingChanges: existingChangeOrder.buildingChanges || [],
        // Note: existing uploaded files are shown separately, pendingFiles are for new uploads
        pendingFiles: initialChangeOrderPendingFiles,
      });
    }
  }, [existingChangeOrder]);

  // Calculate differences for preview
  const calculatePreviewDifferences = () => {
    const currentSnapshot: PricingSnapshot = {
      subtotalBeforeTax: order.pricing.subtotalBeforeTax,
      extraMoneyFluff: order.pricing.extraMoneyFluff,
      deposit: order.pricing.deposit,
      total: calculateTotal(order.pricing.subtotalBeforeTax, order.pricing.extraMoneyFluff),
    };

    const newSnapshot: PricingSnapshot = {
      subtotalBeforeTax: parseFloat(formData.newValues.subtotalBeforeTax) || 0,
      extraMoneyFluff: parseFloat(formData.newValues.extraMoneyFluff) || 0,
      deposit: parseFloat(formData.newValues.deposit) || 0,
      total: 0,
    };
    newSnapshot.total = calculateTotal(newSnapshot.subtotalBeforeTax, newSnapshot.extraMoneyFluff);

    return calculateDifferences(currentSnapshot, newSnapshot);
  };

  // Calculate cumulative from original
  const calculateCumulativePreview = () => {
    const originalPricing = order.originalPricing || order.pricing;
    const originalSnapshot: PricingSnapshot = {
      subtotalBeforeTax: originalPricing.subtotalBeforeTax,
      extraMoneyFluff: originalPricing.extraMoneyFluff,
      deposit: originalPricing.deposit,
      total: calculateTotal(originalPricing.subtotalBeforeTax, originalPricing.extraMoneyFluff),
    };

    const newSnapshot: PricingSnapshot = {
      subtotalBeforeTax: parseFloat(formData.newValues.subtotalBeforeTax) || 0,
      extraMoneyFluff: parseFloat(formData.newValues.extraMoneyFluff) || 0,
      deposit: parseFloat(formData.newValues.deposit) || 0,
      total: 0,
    };
    newSnapshot.total = calculateTotal(newSnapshot.subtotalBeforeTax, newSnapshot.extraMoneyFluff);

    return calculateDifferences(originalSnapshot, newSnapshot);
  };

  const differences = calculatePreviewDifferences();
  const cumulativeDiff = calculateCumulativePreview();

  const handleSave = async () => {
    if (!formData.reason.trim()) {
      setError('Please enter a reason for the change');
      return;
    }

    setSaving(true);
    setError(null);
    try {
      await onSave(formData);
    } catch (err: any) {
      setError(err.message || 'Failed to save change order');
    } finally {
      setSaving(false);
    }
  };

  const handleSendForSignature = async () => {
    if (!formData.reason.trim()) {
      setError('Please enter a reason for the change');
      return;
    }

    setSending(true);
    setError(null);
    try {
      await onSave(formData);
      await onSendForSignature();
    } catch (err: any) {
      setError(err.message || 'Failed to send for signature');
    } finally {
      setSending(false);
    }
  };

  const handleDelete = async () => {
    if (!onDelete) return;
    if (!window.confirm('Are you sure you want to delete this change order?')) return;

    setDeleting(true);
    setError(null);
    try {
      await onDelete();
    } catch (err: any) {
      setError(err.message || 'Failed to delete change order');
    } finally {
      setDeleting(false);
    }
  };

  const formatDiff = (value: number) => {
    if (value === 0) return '$0';
    const sign = value > 0 ? '+' : '';
    return `${sign}$${value.toLocaleString()}`;
  };

  return (
    <div style={styles.container}>
      <h4 style={styles.title}>
        {existingChangeOrder ? `Edit ${existingChangeOrder.changeOrderNumber}` : 'New Change Order'}
      </h4>

      {error && <div style={styles.error}>{error}</div>}

      {/* Reason Field */}
      <div style={styles.field}>
        <label style={styles.label}>Reason for Change *</label>
        <textarea
          value={formData.reason}
          onChange={(e) => setFormData({ ...formData, reason: e.target.value })}
          placeholder="Describe what is changing and why..."
          style={styles.textarea}
          rows={3}
        />
      </div>

      {/* Pricing Fields */}
      <div style={styles.pricingSection}>
        <h5 style={styles.sectionTitle}>New Pricing</h5>
        <div style={styles.pricingGrid}>
          <div style={styles.priceField}>
            <label style={styles.priceLabel}>Subtotal Before Tax</label>
            <div style={styles.inputWrapper}>
              <span style={styles.dollarSign}>$</span>
              <input
                type="number"
                value={formData.newValues.subtotalBeforeTax}
                onChange={(e) =>
                  setFormData({
                    ...formData,
                    newValues: { ...formData.newValues, subtotalBeforeTax: e.target.value },
                  })
                }
                style={styles.priceInput}
              />
            </div>
            <span style={getDiffBadgeStyle(differences.subtotalDiff)}>
              {formatDiff(differences.subtotalDiff)}
            </span>
          </div>

          <div style={styles.priceField}>
            <label style={styles.priceLabel}>Extra Money/Fluff</label>
            <div style={styles.inputWrapper}>
              <span style={styles.dollarSign}>$</span>
              <input
                type="number"
                value={formData.newValues.extraMoneyFluff}
                onChange={(e) =>
                  setFormData({
                    ...formData,
                    newValues: { ...formData.newValues, extraMoneyFluff: e.target.value },
                  })
                }
                style={styles.priceInput}
              />
            </div>
            <span style={getDiffBadgeStyle(differences.extraMoneyFluffDiff)}>
              {formatDiff(differences.extraMoneyFluffDiff)}
            </span>
          </div>

          <div style={styles.priceField}>
            <label style={styles.priceLabel}>Deposit</label>
            <div style={styles.inputWrapper}>
              <span style={styles.dollarSign}>$</span>
              <input
                type="number"
                value={formData.newValues.deposit}
                onChange={(e) =>
                  setFormData({
                    ...formData,
                    newValues: { ...formData.newValues, deposit: e.target.value },
                  })
                }
                style={styles.priceInput}
              />
            </div>
            <span style={getDiffBadgeStyle(differences.depositDiff)}>
              {formatDiff(differences.depositDiff)}
            </span>
          </div>
        </div>
      </div>

      {/* Summary Preview */}
      <div style={styles.summarySection}>
        <h5 style={styles.sectionTitle}>Change Summary</h5>
        <div style={styles.summaryGrid}>
          <div style={styles.summaryRow}>
            <span style={styles.summaryLabel}>Total Change (from current):</span>
            <span style={getSummaryValueStyle(differences.totalDiff)}>
              {formatDiff(differences.totalDiff)}
            </span>
          </div>
          <div style={styles.summaryRow}>
            <span style={styles.summaryLabel}>Deposit Change (from current):</span>
            <span style={getSummaryValueStyle(differences.depositDiff)}>
              {formatDiff(differences.depositDiff)}
            </span>
          </div>
          {order.originalPricing && (
            <>
              <div style={styles.divider} />
              <div style={styles.summaryRow}>
                <span style={styles.summaryLabel}>Total Change (from original):</span>
                <span style={getSummaryValueStyle(cumulativeDiff.totalDiff)}>
                  {formatDiff(cumulativeDiff.totalDiff)}
                </span>
              </div>
              <div style={styles.summaryRow}>
                <span style={styles.summaryLabel}>Deposit Change (from original):</span>
                <span style={getSummaryValueStyle(cumulativeDiff.depositDiff)}>
                  {formatDiff(cumulativeDiff.depositDiff)}
                </span>
              </div>
            </>
          )}
        </div>
      </div>

      {/* File Uploads */}
      <ChangeOrderFileUpload
        files={formData.pendingFiles}
        onChange={(pendingFiles: ChangeOrderPendingFiles) =>
          setFormData({ ...formData, pendingFiles })
        }
      />

      {/* Actions */}
      <div style={styles.actions}>
        <div style={styles.leftActions}>
          <button onClick={onCancel} style={styles.cancelButton} disabled={saving || sending}>
            Cancel
          </button>
          {existingChangeOrder && onDelete && (
            <button
              onClick={handleDelete}
              style={styles.deleteButton}
              disabled={saving || sending || deleting}
            >
              {deleting ? 'Deleting...' : 'Delete'}
            </button>
          )}
        </div>
        <div style={styles.rightActions}>
          <button onClick={handleSave} style={styles.saveButton} disabled={saving || sending}>
            {saving ? 'Saving...' : 'Save Draft'}
          </button>
          <button
            onClick={handleSendForSignature}
            style={styles.sendButton}
            disabled={saving || sending}
          >
            {sending ? 'Sending...' : 'Save & Send for Signature'}
          </button>
        </div>
      </div>
    </div>
  );
}

const styles: Record<string, React.CSSProperties> = {
  container: {
    backgroundColor: '#f8f9fa',
    borderRadius: '8px',
    padding: '20px',
    marginBottom: '20px',
  },
  title: {
    margin: '0 0 16px 0',
    fontSize: '16px',
    fontWeight: 600,
    color: '#333',
  },
  error: {
    padding: '12px',
    marginBottom: '16px',
    backgroundColor: '#ffebee',
    color: '#c62828',
    borderRadius: '6px',
    fontSize: '14px',
  },
  field: {
    marginBottom: '16px',
  },
  label: {
    display: 'block',
    fontSize: '13px',
    fontWeight: 500,
    color: '#666',
    marginBottom: '6px',
  },
  textarea: {
    width: '100%',
    padding: '10px 12px',
    border: '1px solid #ddd',
    borderRadius: '6px',
    fontSize: '14px',
    resize: 'vertical',
    fontFamily: 'inherit',
    boxSizing: 'border-box',
  },
  pricingSection: {
    marginBottom: '20px',
  },
  sectionTitle: {
    margin: '0 0 12px 0',
    fontSize: '14px',
    fontWeight: 600,
    color: '#333',
  },
  pricingGrid: {
    display: 'grid',
    gridTemplateColumns: 'repeat(3, 1fr)',
    gap: '16px',
  },
  priceField: {
    display: 'flex',
    flexDirection: 'column',
    gap: '6px',
  },
  priceLabel: {
    fontSize: '12px',
    color: '#666',
  },
  inputWrapper: {
    display: 'flex',
    alignItems: 'center',
    backgroundColor: 'white',
    border: '1px solid #ddd',
    borderRadius: '6px',
    overflow: 'hidden',
  },
  dollarSign: {
    padding: '0 8px',
    color: '#666',
    backgroundColor: '#f5f5f5',
    borderRight: '1px solid #ddd',
    height: '38px',
    display: 'flex',
    alignItems: 'center',
  },
  priceInput: {
    flex: 1,
    padding: '10px 12px',
    border: 'none',
    fontSize: '14px',
    outline: 'none',
  },
  summarySection: {
    backgroundColor: 'white',
    borderRadius: '6px',
    padding: '16px',
    marginBottom: '20px',
    border: '1px solid #eee',
  },
  summaryGrid: {
    display: 'flex',
    flexDirection: 'column',
    gap: '8px',
  },
  summaryRow: {
    display: 'flex',
    justifyContent: 'space-between',
    alignItems: 'center',
    fontSize: '14px',
  },
  summaryLabel: {
    color: '#666',
  },
  divider: {
    height: '1px',
    backgroundColor: '#eee',
    margin: '8px 0',
  },
  actions: {
    display: 'flex',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingTop: '16px',
    borderTop: '1px solid #eee',
  },
  leftActions: {
    display: 'flex',
    gap: '8px',
  },
  rightActions: {
    display: 'flex',
    gap: '8px',
  },
  cancelButton: {
    padding: '10px 16px',
    backgroundColor: 'white',
    color: '#666',
    border: '1px solid #ddd',
    borderRadius: '6px',
    fontSize: '14px',
    cursor: 'pointer',
  },
  deleteButton: {
    padding: '10px 16px',
    backgroundColor: '#ffebee',
    color: '#c62828',
    border: 'none',
    borderRadius: '6px',
    fontSize: '14px',
    cursor: 'pointer',
  },
  saveButton: {
    padding: '10px 16px',
    backgroundColor: 'white',
    color: '#1565c0',
    border: '1px solid #1565c0',
    borderRadius: '6px',
    fontSize: '14px',
    cursor: 'pointer',
  },
  sendButton: {
    padding: '10px 16px',
    backgroundColor: '#1565c0',
    color: 'white',
    border: 'none',
    borderRadius: '6px',
    fontSize: '14px',
    cursor: 'pointer',
  },
};
