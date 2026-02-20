import React, { useState } from 'react';
import { FormDropdown } from './FormDropdown';
import { FormField } from './FormField';
import { StripeProvider } from '../stripe/StripeProvider';
import { PaymentForm } from '../stripe/PaymentForm';
import { PaymentType } from '../../types/order';

interface PaymentData {
  type: PaymentType;
  stripePaymentId: string;
  notes: string;
  stripeTestMode?: boolean;
  testAmount?: string;
}

interface PaymentSectionProps {
  payment: PaymentData;
  onChange: (field: keyof PaymentData, value: string | boolean) => void;
  depositAmount: number;
  customerEmail: string;
  customerName: string;
}

const PAYMENT_TYPE_OPTIONS = [
  { value: 'stripe_pay_now', label: 'Stripe - Pay Now' },
  { value: 'stripe_already_paid', label: 'Stripe - Already Paid' },
  { value: 'stripe_pay_later', label: 'Stripe - Pay Later (Generate Link)' },
  { value: 'check', label: 'Check' },
  { value: 'wire', label: 'Wire Transfer' },
  { value: 'credit_on_file', label: 'Credit on File' },
  { value: 'other', label: 'Other' },
];

export function PaymentSection({
  payment,
  onChange,
  depositAmount,
  customerEmail,
  customerName,
}: PaymentSectionProps) {
  const [clientSecret, setClientSecret] = useState<string | null>(null);
  const [paymentLinkUrl, setPaymentLinkUrl] = useState<string | null>(null);
  const [verifying, setVerifying] = useState(false);
  const [verifyResult, setVerifyResult] = useState<'success' | 'error' | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const handleTypeChange = (_name: string, value: string) => {
    onChange('type', value);
    // Reset states when changing payment type
    setClientSecret(null);
    setPaymentLinkUrl(null);
    setVerifyResult(null);
    setError(null);
    onChange('stripeTestMode', false);
    onChange('testAmount', '');
  };

  const handleCreatePaymentIntent = async () => {
    if (depositAmount <= 0) {
      setError('Please enter a valid deposit amount');
      return;
    }

    setLoading(true);
    setError(null);

    try {
      // Call Cloud Function to create payment intent
      const response = await fetch(
        `${import.meta.env.VITE_FUNCTIONS_URL || ''}/createPaymentIntent`,
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            amount: Math.round(depositAmount * 100), // Convert to cents
            customerEmail,
            customerName,
          }),
        }
      );
      if (!response.ok) throw new Error(`Server error: ${response.status} ${response.statusText}`);

      const data = await response.json();
      if (data.clientSecret) {
        setClientSecret(data.clientSecret);
      } else {
        setError(data.error || 'Failed to create payment');
      }
    } catch (err) {
      setError('Failed to connect to payment service');
      console.error(err);
    } finally {
      setLoading(false);
    }
  };

  const handleVerifyPayment = async () => {
    if (!payment.stripePaymentId.trim()) {
      setError('Please enter a payment ID');
      return;
    }

    setVerifying(true);
    setError(null);
    setVerifyResult(null);

    try {
      const response = await fetch(
        `${import.meta.env.VITE_FUNCTIONS_URL || ''}/verifyPayment`,
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            paymentId: payment.stripePaymentId,
          }),
        }
      );
      if (!response.ok) throw new Error(`Server error: ${response.status} ${response.statusText}`);

      const data = await response.json();
      if (data.verified) {
        setVerifyResult('success');
      } else {
        setVerifyResult('error');
        setError(data.error || 'Payment not found or not completed');
      }
    } catch (err) {
      setVerifyResult('error');
      setError('Failed to verify payment');
      console.error(err);
    } finally {
      setVerifying(false);
    }
  };

  const handleGeneratePaymentLink = async () => {
    if (depositAmount <= 0) {
      setError('Please enter a valid deposit amount');
      return;
    }

    setLoading(true);
    setError(null);

    try {
      const response = await fetch(
        `${import.meta.env.VITE_FUNCTIONS_URL || ''}/createPaymentLink`,
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            amount: Math.round(depositAmount * 100),
            customerEmail,
            customerName,
          }),
        }
      );
      if (!response.ok) throw new Error(`Server error: ${response.status} ${response.statusText}`);

      const data = await response.json();
      if (data.url) {
        setPaymentLinkUrl(data.url);
        onChange('stripePaymentId', data.paymentLinkId || '');
      } else {
        setError(data.error || 'Failed to create payment link');
      }
    } catch (err) {
      setError('Failed to create payment link');
      console.error(err);
    } finally {
      setLoading(false);
    }
  };

  const handlePaymentSuccess = (paymentId: string) => {
    onChange('stripePaymentId', paymentId);
    setClientSecret(null);
  };

  const handlePaymentError = (errorMsg: string) => {
    setError(errorMsg);
  };

  const renderPaymentUI = () => {
    switch (payment.type) {
      case 'stripe_pay_now':
        return (
          <div style={styles.paymentUI}>
            {!clientSecret ? (
              <div style={styles.payNowSetup}>
                <p style={styles.infoText}>
                  Click below to initialize the payment form for ${depositAmount.toFixed(2)}
                </p>
                <button
                  onClick={handleCreatePaymentIntent}
                  disabled={loading || depositAmount <= 0}
                  style={styles.actionButton}
                >
                  {loading ? 'Setting up...' : 'Start Payment'}
                </button>
              </div>
            ) : (
              <StripeProvider clientSecret={clientSecret}>
                <PaymentForm
                  amount={depositAmount}
                  onSuccess={handlePaymentSuccess}
                  onError={handlePaymentError}
                />
              </StripeProvider>
            )}
          </div>
        );

      case 'stripe_already_paid':
        return (
          <div style={styles.paymentUI}>
            {/* Test Mode Toggle */}
            <div style={styles.testModeWrapper}>
              <label style={styles.testModeLabel}>
                <input
                  type="checkbox"
                  checked={payment.stripeTestMode || false}
                  onChange={(e) => {
                    onChange('stripeTestMode', e.target.checked);
                    if (e.target.checked) {
                      setVerifyResult(null);
                      onChange('stripePaymentId', `test_${Date.now()}`);
                      onChange('testAmount', depositAmount.toString());
                    } else {
                      onChange('stripePaymentId', '');
                      onChange('testAmount', '');
                    }
                  }}
                  style={styles.checkbox}
                />
                <span style={styles.testModeText}>Test Mode</span>
                <span style={styles.testModeHint}>(Skip verification - for testing only)</span>
              </label>
            </div>

            {!payment.stripeTestMode ? (
              <>
                <p style={styles.infoText}>
                  Enter the Stripe payment ID to verify the payment
                </p>
                <div style={styles.verifyRow}>
                  <FormField
                    label="Stripe Payment ID"
                    name="stripePaymentId"
                    value={payment.stripePaymentId}
                    onChange={(_name, value) => onChange('stripePaymentId', value)}
                    placeholder="pi_xxxxx or ch_xxxxx"
                  />
                  <button
                    onClick={handleVerifyPayment}
                    disabled={verifying}
                    style={styles.verifyButton}
                  >
                    {verifying ? 'Verifying...' : 'Verify'}
                  </button>
                </div>
                {verifyResult === 'success' && (
                  <div style={styles.verifySuccess}>Payment verified successfully!</div>
                )}
                {verifyResult === 'error' && (
                  <div style={styles.verifyError}>Payment verification failed</div>
                )}
              </>
            ) : (
              <div style={styles.testModeNotice}>
                <strong>⚠️ Test Mode Enabled</strong>
                <p style={styles.testModeNoticeText}>
                  Enter the test payment amount. This will be recorded as a test payment without Stripe verification.
                </p>
                <div style={styles.testAmountField}>
                  <label style={styles.label}>Test Amount</label>
                  <div style={styles.amountInputWrapper}>
                    <span style={styles.dollarSign}>$</span>
                    <input
                      type="number"
                      step="0.01"
                      value={payment.testAmount || depositAmount.toString()}
                      onChange={(e) => onChange('testAmount', e.target.value)}
                      style={styles.amountInput}
                      placeholder={depositAmount.toString()}
                    />
                  </div>
                </div>
                <div style={styles.verifySuccess}>
                  ✓ Test payment will be auto-verified on submission
                </div>
              </div>
            )}
          </div>
        );

      case 'stripe_pay_later':
        return (
          <div style={styles.paymentUI}>
            <p style={styles.infoText}>
              Generate a payment link to send to the customer
            </p>
            {!paymentLinkUrl ? (
              <button
                onClick={handleGeneratePaymentLink}
                disabled={loading || depositAmount <= 0}
                style={styles.actionButton}
              >
                {loading ? 'Generating...' : `Generate Link for $${depositAmount.toFixed(2)}`}
              </button>
            ) : (
              <div style={styles.linkGenerated}>
                <p style={styles.linkLabel}>Payment link generated:</p>
                <div style={styles.linkRow}>
                  <input
                    type="text"
                    value={paymentLinkUrl}
                    readOnly
                    style={styles.linkInput}
                  />
                  <button
                    onClick={() => navigator.clipboard.writeText(paymentLinkUrl)}
                    style={styles.copyButton}
                  >
                    Copy
                  </button>
                </div>
              </div>
            )}
          </div>
        );

      case 'check':
      case 'wire':
      case 'credit_on_file':
      case 'other':
        return (
          <div style={styles.paymentUI}>
            <FormField
              label="Payment Notes"
              name="notes"
              value={payment.notes}
              onChange={(_name, value) => onChange('notes', value)}
              multiline
              rows={3}
              placeholder={`Enter details about the ${payment.type.replace('_', ' ')} payment...`}
            />
          </div>
        );

      default:
        return null;
    }
  };

  return (
    <div style={styles.section}>
      <h3 style={styles.sectionTitle}>Payment</h3>

      <div style={styles.typeSelector}>
        <FormDropdown
          label="Payment Type"
          name="type"
          value={payment.type}
          onChange={handleTypeChange}
          options={PAYMENT_TYPE_OPTIONS.map((opt) => opt.label)}
          required
        />
        {/* Convert display label back to value */}
        <select
          value={payment.type}
          onChange={(e) => handleTypeChange('type', e.target.value)}
          style={styles.hiddenSelect}
        >
          {PAYMENT_TYPE_OPTIONS.map((opt) => (
            <option key={opt.value} value={opt.value}>
              {opt.label}
            </option>
          ))}
        </select>
      </div>

      {/* Actually use the value-based dropdown */}
      <div style={styles.typeDropdown}>
        <label style={styles.label}>Payment Type<span style={styles.required}>*</span></label>
        <select
          value={payment.type}
          onChange={(e) => handleTypeChange('type', e.target.value)}
          style={styles.select}
        >
          {PAYMENT_TYPE_OPTIONS.map((opt) => (
            <option key={opt.value} value={opt.value}>
              {opt.label}
            </option>
          ))}
        </select>
      </div>

      {error && <div style={styles.error}>{error}</div>}

      {renderPaymentUI()}
    </div>
  );
}

const styles: Record<string, React.CSSProperties> = {
  section: {
    backgroundColor: 'white',
    borderRadius: '8px',
    padding: '24px',
    boxShadow: '0 2px 4px rgba(0,0,0,0.1)',
  },
  sectionTitle: {
    margin: '0 0 20px 0',
    fontSize: '18px',
    fontWeight: 600,
    color: '#333',
    paddingBottom: '12px',
    borderBottom: '2px solid #2196F3',
  },
  typeSelector: {
    display: 'none', // Hidden, using the custom one below
  },
  hiddenSelect: {
    display: 'none',
  },
  typeDropdown: {
    marginBottom: '16px',
  },
  label: {
    display: 'block',
    fontSize: '14px',
    fontWeight: 500,
    color: '#333',
    marginBottom: '4px',
  },
  required: {
    color: '#dc3545',
    marginLeft: '4px',
  },
  select: {
    width: '100%',
    padding: '10px 12px',
    border: '1px solid #ddd',
    borderRadius: '4px',
    fontSize: '14px',
    backgroundColor: 'white',
    cursor: 'pointer',
  },
  paymentUI: {
    marginTop: '16px',
    padding: '16px',
    backgroundColor: '#f9f9f9',
    borderRadius: '8px',
  },
  infoText: {
    margin: '0 0 16px 0',
    fontSize: '14px',
    color: '#666',
  },
  payNowSetup: {
    textAlign: 'center',
  },
  actionButton: {
    padding: '12px 24px',
    backgroundColor: '#2196F3',
    color: 'white',
    border: 'none',
    borderRadius: '4px',
    fontSize: '14px',
    cursor: 'pointer',
    fontWeight: 500,
  },
  verifyRow: {
    display: 'flex',
    gap: '12px',
    alignItems: 'flex-end',
  },
  verifyButton: {
    padding: '10px 20px',
    backgroundColor: '#4caf50',
    color: 'white',
    border: 'none',
    borderRadius: '4px',
    fontSize: '14px',
    cursor: 'pointer',
    whiteSpace: 'nowrap',
    height: '42px',
  },
  verifySuccess: {
    marginTop: '12px',
    padding: '12px',
    backgroundColor: '#e8f5e9',
    color: '#2e7d32',
    borderRadius: '4px',
    fontSize: '14px',
  },
  verifyError: {
    marginTop: '12px',
    padding: '12px',
    backgroundColor: '#ffebee',
    color: '#c62828',
    borderRadius: '4px',
    fontSize: '14px',
  },
  linkGenerated: {
    marginTop: '8px',
  },
  linkLabel: {
    margin: '0 0 8px 0',
    fontSize: '14px',
    color: '#2e7d32',
    fontWeight: 500,
  },
  linkRow: {
    display: 'flex',
    gap: '8px',
  },
  linkInput: {
    flex: 1,
    padding: '10px 12px',
    border: '1px solid #ddd',
    borderRadius: '4px',
    fontSize: '14px',
    backgroundColor: '#fff',
  },
  copyButton: {
    padding: '10px 16px',
    backgroundColor: '#6c757d',
    color: 'white',
    border: 'none',
    borderRadius: '4px',
    fontSize: '14px',
    cursor: 'pointer',
  },
  error: {
    padding: '12px',
    marginBottom: '16px',
    backgroundColor: '#ffebee',
    color: '#c62828',
    borderRadius: '4px',
    fontSize: '14px',
  },
  testModeWrapper: {
    marginBottom: '16px',
    paddingBottom: '12px',
    borderBottom: '1px solid #e0e0e0',
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
    padding: '16px',
    backgroundColor: '#fff3e0',
    borderRadius: '4px',
    border: '1px solid #ffcc80',
  },
  testModeNoticeText: {
    margin: '8px 0 16px 0',
    fontSize: '13px',
    color: '#666',
  },
  testAmountField: {
    marginBottom: '12px',
  },
  amountInputWrapper: {
    display: 'flex',
    alignItems: 'center',
    border: '1px solid #ddd',
    borderRadius: '4px',
    overflow: 'hidden',
    backgroundColor: 'white',
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
};
