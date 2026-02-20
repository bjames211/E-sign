import React, { useState, useRef } from 'react';
import { ref, uploadBytes, getDownloadURL } from 'firebase/storage';
import { storage } from '../../config/firebase';
import {
  PaymentRecord,
  PaymentMethod,
  PAYMENT_METHOD_LABELS,
  formatCurrency,
  requiresManualApproval,
} from '../../types/payment';
import { useAuth } from '../../contexts/AuthContext';

interface ApprovePaymentModalProps {
  payment: PaymentRecord;
  orderNumber: string;
  onApprove: (
    paymentId: string,
    method: PaymentMethod,
    approvalCode: string,
    stripePaymentId?: string,
    proofFile?: { name: string; storagePath: string; downloadUrl: string; size: number; type: string }
  ) => Promise<void>;
  onClose: () => void;
}

export function ApprovePaymentModal({
  payment,
  orderNumber,
  onApprove,
  onClose,
}: ApprovePaymentModalProps) {
  const { user, isManager } = useAuth();
  const [method, setMethod] = useState<PaymentMethod>(payment.method || 'check');
  const [approvalCode, setApprovalCode] = useState('');
  const [stripePaymentId, setStripePaymentId] = useState('');
  const [stripeVerified, setStripeVerified] = useState(false);
  const [stripeAmount, setStripeAmount] = useState<number | null>(null);
  const [verifying, setVerifying] = useState(false);
  const [proofFile, setProofFile] = useState<File | null>(null);
  const [proofPreview, setProofPreview] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const isManualPayment = requiresManualApproval(method);

  const handleMethodChange = (newMethod: PaymentMethod) => {
    setMethod(newMethod);
    setStripeVerified(false);
    setStripeAmount(null);
    setStripePaymentId('');
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
    if (!stripePaymentId) {
      setError('Please enter a Stripe Payment ID');
      return;
    }

    setVerifying(true);
    setError(null);
    setStripeVerified(false);

    try {
      const response = await fetch(
        `${import.meta.env.VITE_FUNCTIONS_URL || ''}/verifyPayment`,
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ paymentId: stripePaymentId }),
        }
      );
      if (!response.ok) throw new Error(`Server error: ${response.status} ${response.statusText}`);

      const data = await response.json();

      if (data.verified) {
        setStripeVerified(true);
        setStripeAmount(data.amount);
      } else {
        setError(data.error || 'Payment verification failed');
      }
    } catch (err: any) {
      setError(err.message || 'Failed to verify payment');
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
    if (!isManager && !approvalCode.trim()) {
      setError('Please enter a manager approval code');
      return;
    }

    if (method === 'stripe' && !stripeVerified) {
      setError('Please verify the Stripe payment first');
      return;
    }

    setSubmitting(true);

    try {
      const uploadedProof = await uploadProofFile();
      await onApprove(
        payment.id!,
        method,
        approvalCode,
        method === 'stripe' ? stripePaymentId : undefined,
        uploadedProof
      );
      onClose();
    } catch (err: any) {
      setError(err.message || 'Failed to approve payment');
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div style={styles.overlay}>
      <div style={styles.modal}>
        <div style={styles.header}>
          <h3 style={styles.title}>Approve Payment</h3>
          <button onClick={onClose} style={styles.closeButton}>
            ×
          </button>
        </div>

        {/* Payment Info */}
        <div style={styles.paymentInfo}>
          <div style={styles.paymentInfoRow}>
            <span style={styles.paymentInfoLabel}>Amount:</span>
            <span style={styles.paymentInfoValue}>{formatCurrency(payment.amount)}</span>
          </div>
          <div style={styles.paymentInfoRow}>
            <span style={styles.paymentInfoLabel}>Category:</span>
            <span style={styles.paymentInfoValue}>
              {payment.changeOrderNumber ? `${payment.changeOrderNumber} Deposit` : payment.category}
            </span>
          </div>
        </div>

        {error && <div style={styles.error}>{error}</div>}

        <form onSubmit={handleSubmit} style={styles.form}>
          {/* Payment Method */}
          <div style={styles.field}>
            <label style={styles.label}>Payment Method *</label>
            <select
              value={method}
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

          {/* Stripe Section */}
          {method === 'stripe' && (
            <div style={styles.stripeSection}>
              <div style={styles.field}>
                <label style={styles.label}>Stripe Payment ID *</label>
                <div style={styles.stripeInputWrapper}>
                  <input
                    type="text"
                    value={stripePaymentId}
                    onChange={(e) => {
                      setStripePaymentId(e.target.value);
                      setStripeVerified(false);
                      setStripeAmount(null);
                    }}
                    style={styles.input}
                    placeholder="pi_xxxx or ch_xxxx"
                  />
                  <button
                    type="button"
                    onClick={handleVerifyStripe}
                    disabled={verifying || !stripePaymentId}
                    style={styles.verifyButton}
                  >
                    {verifying ? 'Verifying...' : 'Verify'}
                  </button>
                </div>
                {stripeVerified && (
                  <div style={styles.verifiedSuccess}>
                    Verified: {formatCurrency(stripeAmount || 0)}
                  </div>
                )}
              </div>
            </div>
          )}

          {/* Manual Payment Proof */}
          {isManualPayment && (
            <div style={styles.manualSection}>
              <div style={styles.field}>
                <label style={styles.label}>
                  Proof of Payment
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
            </div>
          )}

          {/* Manager Approval */}
          {isManager ? (
            <div style={styles.field}>
              <span style={{ fontSize: '13px', color: '#2e7d32' }}>
                Approving as {user?.email}
              </span>
            </div>
          ) : (
            <div style={styles.field}>
              <label style={styles.label}>Manager Approval Code *</label>
              <input
                type="password"
                value={approvalCode}
                onChange={(e) => setApprovalCode(e.target.value)}
                style={styles.input}
                placeholder="Enter approval code"
              />
            </div>
          )}

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
              {submitting ? 'Approving...' : 'Approve Payment'}
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
    maxWidth: '450px',
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
  paymentInfo: {
    padding: '16px 20px',
    backgroundColor: '#f8f9fa',
    borderBottom: '1px solid #eee',
  },
  paymentInfoRow: {
    display: 'flex',
    justifyContent: 'space-between',
    marginBottom: '8px',
  },
  paymentInfoLabel: {
    fontSize: '14px',
    color: '#666',
  },
  paymentInfoValue: {
    fontSize: '14px',
    fontWeight: 600,
    color: '#333',
  },
  error: {
    margin: '0 20px',
    marginTop: '16px',
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
  manualSection: {
    padding: '16px',
    backgroundColor: '#fff3e0',
    borderRadius: '8px',
    marginBottom: '16px',
    border: '1px solid #ffe0b2',
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
    backgroundColor: '#2e7d32',
    color: 'white',
    border: 'none',
    borderRadius: '4px',
    fontSize: '14px',
    cursor: 'pointer',
    fontWeight: 500,
  },
};
