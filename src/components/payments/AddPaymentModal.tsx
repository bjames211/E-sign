import React, { useState, useRef } from 'react';
import { ref, uploadBytes, getDownloadURL } from 'firebase/storage';
import { storage } from '../../config/firebase';
import {
  PaymentMethod,
  PaymentCategory,
  AddPaymentFormData,
  initialAddPaymentFormData,
  PAYMENT_METHOD_LABELS,
  PAYMENT_CATEGORY_LABELS,
  requiresManualApproval,
  formatCurrency,
} from '../../types/payment';

interface AddPaymentModalProps {
  orderId: string;
  orderNumber: string;
  depositRequired: number;
  currentBalance: number;
  onSubmit: (data: AddPaymentFormData, proofFile?: { name: string; storagePath: string; downloadUrl: string; size: number; type: string }) => Promise<void>;
  onClose: () => void;
}

export function AddPaymentModal({
  orderNumber,
  depositRequired,
  currentBalance,
  onSubmit,
  onClose,
}: AddPaymentModalProps) {
  // depositRequired is used for display in the hint
  const [formData, setFormData] = useState<AddPaymentFormData>({
    ...initialAddPaymentFormData,
    amount: currentBalance > 0 ? currentBalance.toString() : '',
  });
  const [proofFile, setProofFile] = useState<File | null>(null);
  const [proofPreview, setProofPreview] = useState<string | null>(null);
  const [stripeVerified, setStripeVerified] = useState<boolean | null>(null);
  const [stripeAmount, setStripeAmount] = useState<number | null>(null);
  const [verifying, setVerifying] = useState(false);
  const [stripeTestMode, setStripeTestMode] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const isManualPayment = requiresManualApproval(formData.method);

  const handleMethodChange = (method: PaymentMethod) => {
    setFormData({ ...formData, method });
    setStripeVerified(null);
    setStripeAmount(null);
  };

  const handleCategoryChange = (category: PaymentCategory) => {
    setFormData({ ...formData, category });
  };

  const handleProofFileSelect = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (file) {
      setProofFile(file);
      if (file.type.startsWith('image/')) {
        const reader = new FileReader();
        reader.onloadend = () => {
          setProofPreview(reader.result as string);
        };
        reader.readAsDataURL(file);
      } else {
        setProofPreview(null);
      }
    }
  };

  const handleVerifyStripe = async () => {
    if (!formData.stripePaymentId) {
      setError('Please enter a Stripe Payment ID');
      return;
    }

    setVerifying(true);
    setError(null);
    setStripeVerified(null);

    try {
      const response = await fetch(
        `${import.meta.env.VITE_FUNCTIONS_URL || ''}/verifyPayment`,
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ paymentId: formData.stripePaymentId }),
        }
      );

      const data = await response.json();

      if (data.verified) {
        setStripeVerified(true);
        setStripeAmount(data.amount);
        // Auto-fill the amount
        setFormData({ ...formData, amount: data.amount.toString() });
      } else {
        setStripeVerified(false);
        setError(data.error || 'Payment verification failed');
      }
    } catch (err: any) {
      setError(err.message || 'Failed to verify payment');
      setStripeVerified(false);
    } finally {
      setVerifying(false);
    }
  };

  const uploadProofFile = async (): Promise<{ name: string; storagePath: string; downloadUrl: string; size: number; type: string } | undefined> => {
    if (!proofFile) return undefined;

    const timestamp = Date.now();
    const sanitizedName = proofFile.name.replace(/[^a-zA-Z0-9.-]/g, '_');
    const storagePath = `orders/${orderNumber}/payment-proofs/${timestamp}_${sanitizedName}`;
    const storageRef = ref(storage, storagePath);

    await uploadBytes(storageRef, proofFile);
    const downloadUrl = await getDownloadURL(storageRef);

    return {
      name: proofFile.name,
      storagePath,
      downloadUrl,
      size: proofFile.size,
      type: proofFile.type,
    };
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);

    // Validation
    const amount = parseFloat(formData.amount);
    if (isNaN(amount) || amount === 0) {
      setError('Please enter a valid amount');
      return;
    }

    if (formData.method === 'stripe' && !stripeTestMode) {
      if (!formData.stripePaymentId) {
        setError('Please enter a Stripe Payment ID');
        return;
      }
      if (stripeVerified === false) {
        setError('Please verify the Stripe payment first');
        return;
      }
    }

    if (isManualPayment && !proofFile && !formData.approvalCode) {
      setError('Please upload proof of payment or enter a manager approval code');
      return;
    }

    setSubmitting(true);

    try {
      const uploadedProof = await uploadProofFile();
      const submitData = stripeTestMode
        ? { ...formData, stripeTestMode: true, stripePaymentId: `test_${Date.now()}` }
        : formData;
      await onSubmit(submitData, uploadedProof);
      onClose();
    } catch (err: any) {
      setError(err.message || 'Failed to add payment');
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div style={styles.overlay}>
      <div style={styles.modal}>
        <div style={styles.header}>
          <h3 style={styles.title}>Add Payment</h3>
          <button onClick={onClose} style={styles.closeButton}>
            ×
          </button>
        </div>

        {error && <div style={styles.error}>{error}</div>}

        <form onSubmit={handleSubmit} style={styles.form}>
          {/* Payment Method */}
          <div style={styles.field}>
            <label style={styles.label}>Payment Method *</label>
            <select
              value={formData.method}
              onChange={(e) => handleMethodChange(e.target.value as PaymentMethod)}
              style={styles.select}
            >
              {Object.entries(PAYMENT_METHOD_LABELS).map(([value, label]) => (
                <option key={value} value={value}>
                  {label}
                </option>
              ))}
            </select>
          </div>

          {/* Category */}
          <div style={styles.field}>
            <label style={styles.label}>Category *</label>
            <select
              value={formData.category}
              onChange={(e) => handleCategoryChange(e.target.value as PaymentCategory)}
              style={styles.select}
            >
              {Object.entries(PAYMENT_CATEGORY_LABELS).map(([value, label]) => (
                <option key={value} value={value}>
                  {label}
                </option>
              ))}
            </select>
          </div>

          {/* Amount */}
          <div style={styles.field}>
            <label style={styles.label}>Amount *</label>
            <div style={styles.amountInputWrapper}>
              <span style={styles.dollarSign}>$</span>
              <input
                type="number"
                step="0.01"
                value={formData.amount}
                onChange={(e) => setFormData({ ...formData, amount: e.target.value })}
                style={styles.amountInput}
                placeholder="0.00"
              />
            </div>
            <span style={styles.hint}>
              Balance due: {formatCurrency(currentBalance)} (Deposit: {formatCurrency(depositRequired)})
            </span>
          </div>

          {/* Stripe Payment ID - Only for Stripe payments */}
          {formData.method === 'stripe' && (
            <div style={styles.stripeSection}>
              {/* Test Mode Toggle */}
              <div style={styles.testModeWrapper}>
                <label style={styles.testModeLabel}>
                  <input
                    type="checkbox"
                    checked={stripeTestMode}
                    onChange={(e) => {
                      setStripeTestMode(e.target.checked);
                      if (e.target.checked) {
                        setStripeVerified(null);
                        setStripeAmount(null);
                      }
                    }}
                    style={styles.checkbox}
                  />
                  <span style={styles.testModeText}>Test Mode</span>
                  <span style={styles.testModeHint}>(Skip verification - for testing only)</span>
                </label>
              </div>

              {!stripeTestMode && (
                <div style={styles.field}>
                  <label style={styles.label}>Stripe Payment ID</label>
                  <div style={styles.stripeInputWrapper}>
                    <input
                      type="text"
                      value={formData.stripePaymentId || ''}
                      onChange={(e) => {
                        setFormData({ ...formData, stripePaymentId: e.target.value });
                        setStripeVerified(null);
                        setStripeAmount(null);
                      }}
                      style={styles.input}
                      placeholder="pi_xxxx or ch_xxxx"
                    />
                    <button
                      type="button"
                      onClick={handleVerifyStripe}
                      disabled={verifying || !formData.stripePaymentId}
                      style={styles.verifyButton}
                    >
                      {verifying ? 'Verifying...' : 'Verify'}
                    </button>
                  </div>
                  {stripeVerified === true && (
                    <div style={styles.verifiedSuccess}>
                      Verified: {formatCurrency(stripeAmount || 0)}
                    </div>
                  )}
                  {stripeVerified === false && (
                    <div style={styles.verifiedFailed}>
                      Verification failed
                    </div>
                  )}
                </div>
              )}

              {stripeTestMode && (
                <div style={styles.testModeNotice}>
                  <strong>⚠️ Test Mode Enabled</strong>
                  <p style={styles.testModeNoticeText}>
                    Enter the payment amount manually. This payment will be recorded as a test
                    Stripe payment without verification.
                  </p>
                </div>
              )}
            </div>
          )}

          {/* Manual Payment Section */}
          {isManualPayment && (
            <div style={styles.manualSection}>
              <div style={styles.sectionTitle}>Manual Payment Details</div>

              {/* Proof Upload */}
              <div style={styles.field}>
                <label style={styles.label}>
                  Proof of Payment *
                  <span style={styles.hint}> (Check photo, wire confirmation, etc.)</span>
                </label>
                <input
                  ref={fileInputRef}
                  type="file"
                  accept="image/*,.pdf"
                  onChange={handleProofFileSelect}
                  style={styles.fileInput}
                />
                <button
                  type="button"
                  onClick={() => fileInputRef.current?.click()}
                  style={styles.uploadButton}
                >
                  {proofFile ? 'Change File' : 'Select File'}
                </button>
                {proofFile && (
                  <div style={styles.selectedFile}>
                    <span style={styles.fileName}>{proofFile.name}</span>
                    <span style={styles.fileSize}>
                      ({(proofFile.size / 1024).toFixed(1)} KB)
                    </span>
                  </div>
                )}
                {proofPreview && (
                  <div style={styles.proofPreview}>
                    <img
                      src={proofPreview}
                      alt="Proof preview"
                      style={styles.previewImage}
                    />
                  </div>
                )}
              </div>

              {/* Manager Approval Code (optional) */}
              <div style={styles.field}>
                <label style={styles.label}>
                  Manager Approval Code
                  <span style={styles.hint}> (Optional - for instant approval)</span>
                </label>
                <input
                  type="password"
                  value={formData.approvalCode || ''}
                  onChange={(e) => setFormData({ ...formData, approvalCode: e.target.value })}
                  style={styles.input}
                  placeholder="Enter approval code"
                />
              </div>
            </div>
          )}

          {/* Description */}
          <div style={styles.field}>
            <label style={styles.label}>Description</label>
            <input
              type="text"
              value={formData.description || ''}
              onChange={(e) => setFormData({ ...formData, description: e.target.value })}
              style={styles.input}
              placeholder="Brief description (optional)"
            />
          </div>

          {/* Notes */}
          <div style={styles.field}>
            <label style={styles.label}>Notes</label>
            <textarea
              value={formData.notes || ''}
              onChange={(e) => setFormData({ ...formData, notes: e.target.value })}
              style={styles.textarea}
              placeholder="Additional notes (optional)"
              rows={2}
            />
          </div>

          {/* Actions */}
          <div style={styles.actions}>
            <button type="button" onClick={onClose} style={styles.cancelButton}>
              Cancel
            </button>
            <button
              type="submit"
              disabled={submitting}
              style={styles.submitButton}
            >
              {submitting ? 'Adding...' : 'Add Payment'}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}

const styles: Record<string, React.CSSProperties> = {
  overlay: {
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
    maxWidth: '500px',
    maxHeight: '90vh',
    overflow: 'hidden',
    display: 'flex',
    flexDirection: 'column',
  },
  header: {
    display: 'flex',
    justifyContent: 'space-between',
    alignItems: 'center',
    padding: '16px 20px',
    borderBottom: '1px solid #eee',
  },
  title: {
    margin: 0,
    fontSize: '18px',
    fontWeight: 600,
    color: '#333',
  },
  closeButton: {
    backgroundColor: 'transparent',
    border: 'none',
    fontSize: '24px',
    color: '#666',
    cursor: 'pointer',
    padding: '0',
    lineHeight: 1,
  },
  error: {
    margin: '0 20px',
    padding: '12px',
    backgroundColor: '#ffebee',
    color: '#c62828',
    borderRadius: '4px',
    fontSize: '14px',
  },
  form: {
    flex: 1,
    overflowY: 'auto',
    padding: '20px',
  },
  field: {
    marginBottom: '16px',
  },
  label: {
    display: 'block',
    fontSize: '14px',
    fontWeight: 500,
    color: '#333',
    marginBottom: '6px',
  },
  hint: {
    fontSize: '12px',
    color: '#666',
    fontWeight: 400,
  },
  input: {
    width: '100%',
    padding: '10px 12px',
    border: '1px solid #ddd',
    borderRadius: '4px',
    fontSize: '14px',
    boxSizing: 'border-box',
  },
  select: {
    width: '100%',
    padding: '10px 12px',
    border: '1px solid #ddd',
    borderRadius: '4px',
    fontSize: '14px',
    boxSizing: 'border-box',
    backgroundColor: 'white',
  },
  textarea: {
    width: '100%',
    padding: '10px 12px',
    border: '1px solid #ddd',
    borderRadius: '4px',
    fontSize: '14px',
    boxSizing: 'border-box',
    resize: 'vertical',
    fontFamily: 'inherit',
  },
  amountInputWrapper: {
    display: 'flex',
    alignItems: 'center',
    border: '1px solid #ddd',
    borderRadius: '4px',
    overflow: 'hidden',
  },
  dollarSign: {
    padding: '10px 12px',
    backgroundColor: '#f5f5f5',
    color: '#666',
    borderRight: '1px solid #ddd',
  },
  amountInput: {
    flex: 1,
    padding: '10px 12px',
    border: 'none',
    fontSize: '16px',
    fontFamily: 'monospace',
    outline: 'none',
  },
  stripeSection: {
    padding: '16px',
    backgroundColor: '#f8f9fa',
    borderRadius: '8px',
    marginBottom: '16px',
    border: '1px solid #e3f2fd',
  },
  stripeInputWrapper: {
    display: 'flex',
    gap: '8px',
  },
  verifyButton: {
    padding: '10px 16px',
    backgroundColor: '#1565c0',
    color: 'white',
    border: 'none',
    borderRadius: '4px',
    fontSize: '14px',
    cursor: 'pointer',
    whiteSpace: 'nowrap',
  },
  verifiedSuccess: {
    marginTop: '8px',
    padding: '8px 12px',
    backgroundColor: '#e8f5e9',
    color: '#2e7d32',
    borderRadius: '4px',
    fontSize: '14px',
    fontWeight: 500,
  },
  verifiedFailed: {
    marginTop: '8px',
    padding: '8px 12px',
    backgroundColor: '#ffebee',
    color: '#c62828',
    borderRadius: '4px',
    fontSize: '14px',
  },
  manualSection: {
    padding: '16px',
    backgroundColor: '#fff3e0',
    borderRadius: '8px',
    marginBottom: '16px',
    border: '1px solid #ffe0b2',
  },
  sectionTitle: {
    fontSize: '13px',
    fontWeight: 600,
    color: '#e65100',
    marginBottom: '12px',
    textTransform: 'uppercase',
    letterSpacing: '0.5px',
  },
  fileInput: {
    display: 'none',
  },
  uploadButton: {
    padding: '10px 20px',
    backgroundColor: '#1565c0',
    color: 'white',
    border: 'none',
    borderRadius: '4px',
    fontSize: '14px',
    cursor: 'pointer',
  },
  selectedFile: {
    marginTop: '10px',
    display: 'flex',
    alignItems: 'center',
    gap: '8px',
  },
  fileName: {
    fontSize: '14px',
    color: '#333',
  },
  fileSize: {
    fontSize: '12px',
    color: '#666',
  },
  proofPreview: {
    marginTop: '12px',
    maxWidth: '150px',
  },
  previewImage: {
    width: '100%',
    borderRadius: '4px',
    border: '1px solid #ddd',
  },
  actions: {
    display: 'flex',
    justifyContent: 'flex-end',
    gap: '12px',
    marginTop: '20px',
    paddingTop: '16px',
    borderTop: '1px solid #eee',
  },
  cancelButton: {
    padding: '12px 24px',
    backgroundColor: 'white',
    color: '#666',
    border: '1px solid #ddd',
    borderRadius: '4px',
    fontSize: '14px',
    cursor: 'pointer',
  },
  submitButton: {
    padding: '12px 24px',
    backgroundColor: '#2196F3',
    color: 'white',
    border: 'none',
    borderRadius: '4px',
    fontSize: '14px',
    cursor: 'pointer',
    fontWeight: 500,
  },
  testModeWrapper: {
    marginBottom: '12px',
    paddingBottom: '12px',
    borderBottom: '1px solid #e3f2fd',
  },
  testModeLabel: {
    display: 'flex',
    alignItems: 'center',
    gap: '8px',
    cursor: 'pointer',
  },
  checkbox: {
    width: '16px',
    height: '16px',
    cursor: 'pointer',
  },
  testModeText: {
    fontSize: '14px',
    fontWeight: 600,
    color: '#e65100',
  },
  testModeHint: {
    fontSize: '12px',
    color: '#666',
  },
  testModeNotice: {
    padding: '12px',
    backgroundColor: '#fff3e0',
    borderRadius: '4px',
    border: '1px solid #ffcc80',
  },
  testModeNoticeText: {
    margin: '8px 0 0 0',
    fontSize: '13px',
    color: '#666',
  },
};
