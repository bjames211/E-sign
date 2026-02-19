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

// ============================================================
// PAYMENT LEDGER SYSTEM - Single Source of Truth
// ============================================================

// Transaction types for the payment ledger
export type LedgerTransactionType = 'payment' | 'refund' | 'deposit_increase' | 'deposit_decrease';

// Ledger entry status
export type LedgerEntryStatus = 'pending' | 'verified' | 'approved' | 'voided';

// Ledger category for tracking payment purpose
export type LedgerCategory = 'initial_deposit' | 'additional_deposit' | 'refund' | 'change_order_adjustment';

// Balance status derived from ledger summary
export type BalanceStatus = 'paid' | 'underpaid' | 'overpaid' | 'pending';

/**
 * PaymentLedgerEntry - Individual transaction record in the payment ledger
 * Every payment, refund, and deposit change is recorded here.
 * Amount is ALWAYS positive - the transactionType determines direction.
 */
export interface PaymentLedgerEntry {
  id?: string;
  orderId: string;
  orderNumber: string;
  changeOrderId?: string;
  changeOrderNumber?: string;

  // Human-readable payment number (PAY-00001 format)
  paymentNumber?: string;

  // Transaction type (explicit, not inferred from amount sign)
  transactionType: LedgerTransactionType;

  // Amount (ALWAYS positive - type determines direction)
  amount: number;

  // Method & category
  method: PaymentMethod;
  category: LedgerCategory;

  // Status
  status: LedgerEntryStatus;

  // Stripe verification
  stripePaymentId?: string;
  stripeVerified?: boolean;
  stripeAmount?: number;          // Amount from Stripe in cents
  stripeAmountDollars?: number;   // Amount converted to dollars

  // Proof for manual payments
  proofFile?: PaymentProofFile;

  // Approval details
  approvedBy?: string;
  approvedAt?: Timestamp;

  // Audit trail
  description: string;
  notes?: string;
  createdAt: Timestamp;
  createdBy: string;

  // Voiding (instead of deleting)
  voidedAt?: Timestamp;
  voidedBy?: string;
  voidReason?: string;
}

/**
 * OrderLedgerSummary - Pre-calculated summary stored on Order document
 * Calculated server-side to ensure consistency across all UI components.
 */
export interface OrderLedgerSummary {
  // What's required
  depositRequired: number;        // Current deposit after all adjustments
  originalDeposit: number;        // Starting deposit from original order
  depositAdjustments: number;     // Sum of increase/decrease entries

  // What's been received
  totalReceived: number;          // Sum of payments (verified/approved)
  totalRefunded: number;          // Sum of refunds (verified/approved)
  netReceived: number;            // totalReceived - totalRefunded

  // Balance
  balance: number;                // depositRequired - netReceived (positive = owes us)
  balanceStatus: BalanceStatus;   // Derived status for display

  // Pending amounts (not yet verified/approved)
  pendingReceived: number;        // Pending payments
  pendingRefunds: number;         // Pending refunds

  // Metadata
  entryCount: number;             // Total ledger entries (non-voided)
  lastEntryAt?: Timestamp;        // Most recent entry timestamp
  calculatedAt: Timestamp;        // When this summary was calculated
}

// Human-readable labels for transaction types
export const TRANSACTION_TYPE_LABELS: Record<LedgerTransactionType, string> = {
  payment: 'Payment',
  refund: 'Refund',
  deposit_increase: 'Deposit Increase',
  deposit_decrease: 'Deposit Decrease',
};

// Colors for transaction types in UI
export const TRANSACTION_TYPE_COLORS: Record<LedgerTransactionType, { bg: string; color: string }> = {
  payment: { bg: '#e8f5e9', color: '#2e7d32' },
  refund: { bg: '#ffebee', color: '#c62828' },
  deposit_increase: { bg: '#fff3e0', color: '#e65100' },
  deposit_decrease: { bg: '#e3f2fd', color: '#1565c0' },
};

// Human-readable labels for balance status
export const BALANCE_STATUS_LABELS: Record<BalanceStatus, string> = {
  paid: 'Fully Paid',
  underpaid: 'Balance Due',
  overpaid: 'Overpaid',
  pending: 'Pending',
};

// Colors for balance status
export const BALANCE_STATUS_COLORS: Record<BalanceStatus, { bg: string; color: string }> = {
  paid: { bg: '#e8f5e9', color: '#2e7d32' },
  underpaid: { bg: '#fff3e0', color: '#e65100' },
  overpaid: { bg: '#e3f2fd', color: '#1565c0' },
  pending: { bg: '#f5f5f5', color: '#666' },
};

/**
 * Helper to determine balance status from ledger summary
 */
export const getBalanceStatus = (summary: OrderLedgerSummary): BalanceStatus => {
  if (summary.pendingReceived > 0 || summary.pendingRefunds > 0) {
    return 'pending';
  }
  if (summary.balance === 0) {
    return 'paid';
  }
  if (summary.balance > 0) {
    return 'underpaid';
  }
  return 'overpaid';
};

// ============================================================
// PAYMENT AUDIT LOG SYSTEM
// ============================================================

// Audit action types
export type PaymentAuditAction = 'created' | 'approved' | 'verified' | 'voided' | 'status_changed';

// Human-readable labels for audit actions
export const AUDIT_ACTION_LABELS: Record<PaymentAuditAction, string> = {
  created: 'Created',
  approved: 'Approved',
  verified: 'Verified',
  voided: 'Voided',
  status_changed: 'Status Changed',
};

// Colors for audit actions in UI
export const AUDIT_ACTION_COLORS: Record<PaymentAuditAction, { bg: string; color: string }> = {
  created: { bg: '#e3f2fd', color: '#1565c0' },
  approved: { bg: '#e8f5e9', color: '#2e7d32' },
  verified: { bg: '#e8f5e9', color: '#2e7d32' },
  voided: { bg: '#ffebee', color: '#c62828' },
  status_changed: { bg: '#fff3e0', color: '#e65100' },
};

/**
 * PaymentAuditEntry - Records every action performed on a payment
 * Provides complete audit trail for compliance and debugging
 */
export interface PaymentAuditEntry {
  id?: string;
  ledgerEntryId: string;           // Reference to payment_ledger entry
  paymentNumber?: string;          // Human-readable payment number (PAY-00001)
  orderId: string;                 // For quick filtering
  orderNumber: string;             // For display

  action: PaymentAuditAction;

  previousStatus?: string;         // Status before the change
  newStatus: string;               // Status after the change

  userId: string;                  // Who performed the action
  userEmail?: string;              // User email for display

  details?: string;                // Additional context (void reason, etc.)
  stripeEventId?: string;          // If triggered by Stripe webhook

  timestamp: Timestamp;
}

/**
 * Filters for querying all payments
 */
export interface AllPaymentsFilters {
  status?: LedgerEntryStatus | 'all';
  transactionType?: LedgerTransactionType | 'all';
  startDate?: Date;
  endDate?: Date;
  search?: string;                 // Order number, Stripe ID, customer name
  limit?: number;
  offset?: number;
}

/**
 * Response from getAllLedgerEntries API
 */
export interface AllPaymentsResponse {
  entries: PaymentLedgerEntry[];
  total: number;
  hasMore: boolean;
}
