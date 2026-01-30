import { Timestamp } from 'firebase/firestore';

// Payment method types - includes both Stripe and manual methods
export type PaymentMethod = 'stripe' | 'check' | 'wire' | 'credit_on_file' | 'cash' | 'other';

// Categories for tracking payment purpose
export type PaymentCategory = 'initial_deposit' | 'additional_deposit' | 'balance_payment' | 'change_order_deposit' | 'refund' | 'adjustment';

// Status flow: pending -> verified/approved | failed | cancelled
export type PaymentRecordStatus = 'pending' | 'verified' | 'approved' | 'failed' | 'cancelled';

// Manual payment methods that require proof and manager approval
export const MANUAL_PAYMENT_METHODS: PaymentMethod[] = ['check', 'wire', 'credit_on_file', 'cash', 'other'];

// Helper to check if payment method requires manual approval
export const requiresManualApproval = (method: PaymentMethod): boolean =>
  MANUAL_PAYMENT_METHODS.includes(method);

// Proof file for manual payments (check photo, wire confirmation, etc.)
export interface PaymentProofFile {
  name: string;
  storagePath: string;
  downloadUrl: string;
  size: number;
  type: string;
  uploadedAt?: Timestamp;
}

// Individual payment record (stored in payments collection)
export interface PaymentRecord {
  id?: string;
  orderId: string;
  orderNumber: string;

  // Core payment details
  amount: number;                     // Dollars (positive = payment, negative = refund)
  method: PaymentMethod;
  category: PaymentCategory;
  status: PaymentRecordStatus;

  // Optional change order link
  changeOrderId?: string;
  changeOrderNumber?: string;           // For display (e.g., "CO-00017")

  // Stripe-specific fields
  stripePaymentId?: string;
  stripeVerified?: boolean;
  stripeAmount?: number;              // Amount verified from Stripe (in cents)
  stripeAmountDollars?: number;       // Amount converted to dollars
  stripeStatus?: string;              // Payment status from Stripe (succeeded, pending, etc.)

  // Manual payment fields
  proofFile?: PaymentProofFile;
  approvedBy?: string;
  approvedAt?: Timestamp;
  rejectedBy?: string;
  rejectedAt?: Timestamp;
  rejectionReason?: string;

  // Notes and description
  description?: string;               // Brief description of payment
  notes?: string;                     // Additional notes

  // Audit trail
  createdAt: Timestamp;
  updatedAt: Timestamp;
  createdBy: string;

  // Virtual payment flag (not stored in DB, used for display)
  isTestPayment?: boolean;
}

// Summary for quick access on Order (denormalized)
export interface PaymentSummary {
  totalPaid: number;                  // Sum of verified/approved payments
  totalPending: number;               // Sum of pending payments
  balance: number;                    // deposit - totalPaid (positive = owes us)
  paymentCount: number;               // Total number of payment records
  lastPaymentAt?: Timestamp;          // Most recent payment timestamp
}

// Form data for adding a payment
export interface AddPaymentFormData {
  method: PaymentMethod;
  category: PaymentCategory;
  amount: string;                     // String for form input
  stripePaymentId?: string;
  stripeTestMode?: boolean;           // Skip verification for testing
  description?: string;
  notes?: string;
  proofFile?: File;
  approvalCode?: string;
}

// Initial form data
export const initialAddPaymentFormData: AddPaymentFormData = {
  method: 'stripe',
  category: 'balance_payment',
  amount: '',
  stripePaymentId: '',
  description: '',
  notes: '',
};

// Human-readable labels for payment methods
export const PAYMENT_METHOD_LABELS: Record<PaymentMethod, string> = {
  stripe: 'Stripe',
  check: 'Check',
  wire: 'Wire Transfer',
  credit_on_file: 'Credit on File',
  cash: 'Cash',
  other: 'Other',
};

// Human-readable labels for payment categories
export const PAYMENT_CATEGORY_LABELS: Record<PaymentCategory, string> = {
  initial_deposit: 'Initial Deposit',
  additional_deposit: 'Additional Deposit',
  balance_payment: 'Balance Payment',
  change_order_deposit: 'Change Order Deposit',
  refund: 'Refund',
  adjustment: 'Adjustment',
};

// Human-readable labels for payment status
export const PAYMENT_STATUS_LABELS: Record<PaymentRecordStatus, string> = {
  pending: 'Pending',
  verified: 'Verified',
  approved: 'Approved',
  failed: 'Failed',
  cancelled: 'Cancelled',
};

// Status colors for UI display
export const PAYMENT_STATUS_COLORS: Record<PaymentRecordStatus, string> = {
  pending: 'bg-yellow-100 text-yellow-800',
  verified: 'bg-green-100 text-green-800',
  approved: 'bg-green-100 text-green-800',
  failed: 'bg-red-100 text-red-800',
  cancelled: 'bg-gray-100 text-gray-800',
};

// Helper to format currency
export const formatCurrency = (amount: number): string => {
  return new Intl.NumberFormat('en-US', {
    style: 'currency',
    currency: 'USD',
  }).format(amount);
};

// Helper to calculate payment summary from payment records
export const calculatePaymentSummary = (
  payments: PaymentRecord[],
  depositRequired: number
): PaymentSummary => {
  let totalPaid = 0;
  let totalPending = 0;
  let lastPaymentAt: Timestamp | undefined;

  for (const payment of payments) {
    if (payment.status === 'verified' || payment.status === 'approved') {
      totalPaid += payment.amount;
      if (!lastPaymentAt || (payment.createdAt && payment.createdAt.toMillis() > lastPaymentAt.toMillis())) {
        lastPaymentAt = payment.createdAt;
      }
    } else if (payment.status === 'pending') {
      totalPending += payment.amount;
    }
  }

  return {
    totalPaid,
    totalPending,
    balance: depositRequired - totalPaid,
    paymentCount: payments.length,
    lastPaymentAt,
  };
};

// Helper to check if payment is counted as "paid" (verified or approved)
export const isPaymentConfirmed = (status: PaymentRecordStatus): boolean =>
  status === 'verified' || status === 'approved';
