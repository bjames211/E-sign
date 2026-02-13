import React, { useState } from 'react';
import {
  PaymentElement,
  useStripe,
  useElements,
} from '@stripe/react-stripe-js';

// Check if we're in test mode
const isTestMode = import.meta.env.VITE_STRIPE_MODE !== 'live';

interface PaymentFormProps {
  onSuccess: (paymentId: string) => void;
  onError: (error: string) => void;
  amount: number;
}

export function PaymentForm({ onSuccess, onError, amount }: PaymentFormProps) {
  const stripe = useStripe();
  const elements = useElements();
  const [processing, setProcessing] = useState(false);
  const [message, setMessage] = useState<string | null>(null);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();

    if (!stripe || !elements) {
      return;
    }

    setProcessing(true);
    setMessage(null);

    try {
      const { error, paymentIntent } = await stripe.confirmPayment({
        elements,
        confirmParams: {
          return_url: window.location.href,
        },
        redirect: 'if_required',
      });

      if (error) {
        setMessage(error.message || 'An error occurred');
        onError(error.message || 'Payment failed');
      } else if (paymentIntent && paymentIntent.status === 'succeeded') {
        setMessage('Payment successful!');
        onSuccess(paymentIntent.id);
      }
    } catch (err) {
      const errorMessage = err instanceof Error ? err.message : 'Payment failed';
      setMessage(errorMessage);
      onError(errorMessage);
    } finally {
      setProcessing(false);
    }
  };

  return (
    <form onSubmit={handleSubmit} style={styles.form}>
      {/* Mode indicator banner */}
      {isTestMode && (
        <div style={styles.testModeBanner}>
          TEST MODE - No real charges will be made
        </div>
      )}

      <div style={styles.amountDisplay}>
        <span>Amount to pay:</span>
        <span style={styles.amount}>${amount.toFixed(2)}</span>
      </div>

      <div style={styles.elementWrapper}>
        <PaymentElement />
      </div>

      {message && (
        <div style={message.includes('successful') ? styles.success : styles.error}>
          {message}
        </div>
      )}

      <button
        type="submit"
        disabled={!stripe || processing}
        style={{
          ...styles.button,
          ...(processing ? styles.buttonDisabled : {}),
        }}
      >
        {processing ? 'Processing...' : `Pay $${amount.toFixed(2)}`}
      </button>

      {/* Test card instructions - only show in test mode */}
      {isTestMode && (
        <p style={styles.testNote}>
          Test card: 4242 4242 4242 4242, any future date, any CVC
        </p>
      )}
    </form>
  );
}

const styles: Record<string, React.CSSProperties> = {
  form: {
    display: 'flex',
    flexDirection: 'column',
    gap: '16px',
  },
  testModeBanner: {
    backgroundColor: '#fff3cd',
    color: '#856404',
    padding: '10px 16px',
    borderRadius: '4px',
    fontSize: '13px',
    fontWeight: 500,
    textAlign: 'center',
    border: '1px solid #ffeeba',
  },
  amountDisplay: {
    display: 'flex',
    justifyContent: 'space-between',
    alignItems: 'center',
    padding: '12px 16px',
    backgroundColor: '#f5f5f5',
    borderRadius: '4px',
    fontSize: '14px',
  },
  amount: {
    fontWeight: 600,
    fontSize: '18px',
    color: '#2196F3',
  },
  elementWrapper: {
    padding: '12px',
    border: '1px solid #ddd',
    borderRadius: '4px',
    backgroundColor: 'white',
  },
  button: {
    padding: '14px 24px',
    backgroundColor: '#2196F3',
    color: 'white',
    border: 'none',
    borderRadius: '4px',
    fontSize: '16px',
    fontWeight: 500,
    cursor: 'pointer',
    marginTop: '8px',
  },
  buttonDisabled: {
    backgroundColor: '#ccc',
    cursor: 'not-allowed',
  },
  success: {
    padding: '12px',
    backgroundColor: '#e8f5e9',
    color: '#2e7d32',
    borderRadius: '4px',
    fontSize: '14px',
  },
  error: {
    padding: '12px',
    backgroundColor: '#ffebee',
    color: '#c62828',
    borderRadius: '4px',
    fontSize: '14px',
  },
  testNote: {
    margin: '8px 0 0 0',
    fontSize: '12px',
    color: '#666',
    textAlign: 'center',
    fontStyle: 'italic',
  },
};
