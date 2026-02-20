import {
  collection,
  addDoc,
  updateDoc,
  doc,
  getDoc,
  getDocs,
  query,
  orderBy,
  where,
  serverTimestamp,
  Timestamp,
} from 'firebase/firestore';
import { ref, uploadBytes, getDownloadURL } from 'firebase/storage';
import { db, storage } from '../config/firebase';
import {
  PaymentRecord,
  PaymentRecordStatus,
  PaymentMethod,
  PaymentCategory,
  PaymentProofFile,
  PaymentSummary,
  calculatePaymentSummary,
  isPaymentConfirmed,
  PaymentLedgerEntry,
  OrderLedgerSummary,
  PaymentAuditEntry,
  AllPaymentsFilters,
  AllPaymentsResponse,
} from '../types/payment';
import { Order } from '../types/order';

// Helper to recursively remove undefined values from objects (Firestore doesn't accept undefined)
function removeUndefinedValues<T>(obj: T): T {
  if (obj === null || obj === undefined) {
    return null as T;
  }
  if (Array.isArray(obj)) {
    return obj.map(item => removeUndefinedValues(item)) as T;
  }
  if (typeof obj === 'object' && !(obj instanceof Timestamp)) {
    const cleaned: Record<string, unknown> = {};
    for (const [key, value] of Object.entries(obj as Record<string, unknown>)) {
      if (value !== undefined) {
        cleaned[key] = removeUndefinedValues(value);
      }
    }
    return cleaned as T;
  }
  return obj;
}

const PAYMENTS_COLLECTION = 'payment_ledger'; // Migrated: all payment data now in payment_ledger
const ORDERS_COLLECTION = 'orders';
const LEDGER_COLLECTION = 'payment_ledger';

// Upload proof file to Firebase Storage
async function uploadProofFile(
  file: File,
  orderNumber: string
): Promise<PaymentProofFile> {
  const timestamp = Date.now();
  const sanitizedName = file.name.replace(/[^a-zA-Z0-9.-]/g, '_');
  const storagePath = `orders/${orderNumber}/payment-proofs/${timestamp}_${sanitizedName}`;
  const storageRef = ref(storage, storagePath);

  await uploadBytes(storageRef, file);
  const downloadUrl = await getDownloadURL(storageRef);

  return {
    name: file.name,
    storagePath,
    downloadUrl,
    size: file.size,
    type: file.type,
    uploadedAt: Timestamp.now(),
  };
}

/**
 * @deprecated Use addLedgerEntry() instead, which goes through Cloud Functions
 * for proper payment number generation and audit trail.
 * This function writes directly to Firestore, bypassing server-side validation.
 */
export async function createPaymentRecord(
  orderId: string,
  orderNumber: string,
  data: {
    amount: number;
    method: PaymentMethod;
    category: PaymentCategory;
    status?: PaymentRecordStatus;
    stripePaymentId?: string;
    stripeVerified?: boolean;
    stripeAmount?: number;
    stripeAmountDollars?: number;
    stripeStatus?: string;
    changeOrderId?: string;
    description?: string;
    notes?: string;
    proofFile?: File;
    approvedBy?: string;
  },
  userId: string
): Promise<PaymentRecord> {
  const now = serverTimestamp();

  // Upload proof file if provided
  let uploadedProofFile: PaymentProofFile | undefined;
  if (data.proofFile) {
    uploadedProofFile = await uploadProofFile(data.proofFile, orderNumber);
  }

  // Determine initial status based on method
  let initialStatus: PaymentRecordStatus = data.status || 'pending';
  if (data.method === 'stripe' && data.stripeVerified) {
    initialStatus = 'verified';
  }

  // Build payment record
  const paymentRecord: Record<string, unknown> = {
    orderId,
    orderNumber,
    transactionType: data.amount < 0 || data.category === 'refund' ? 'refund' : 'payment',
    amount: data.amount,
    method: data.method,
    category: data.category,
    status: initialStatus,
    createdBy: userId,
    createdAt: now,
    updatedAt: now,
  };

  // Add optional fields if provided
  if (data.stripePaymentId) {
    paymentRecord.stripePaymentId = data.stripePaymentId;
  }
  if (data.stripeVerified !== undefined) {
    paymentRecord.stripeVerified = data.stripeVerified;
  }
  if (data.stripeAmount !== undefined) {
    paymentRecord.stripeAmount = data.stripeAmount;
  }
  if (data.stripeAmountDollars !== undefined) {
    paymentRecord.stripeAmountDollars = data.stripeAmountDollars;
  }
  if (data.stripeStatus) {
    paymentRecord.stripeStatus = data.stripeStatus;
  }
  if (data.changeOrderId) {
    paymentRecord.changeOrderId = data.changeOrderId;
  }
  if (data.description) {
    paymentRecord.description = data.description;
  }
  if (data.notes) {
    paymentRecord.notes = data.notes;
  }
  if (uploadedProofFile) {
    paymentRecord.proofFile = uploadedProofFile;
  }
  if (data.approvedBy) {
    paymentRecord.approvedBy = data.approvedBy;
    paymentRecord.approvedAt = now;
  }

  // Remove undefined values and save
  const cleanedPaymentRecord = removeUndefinedValues(paymentRecord);
  const docRef = await addDoc(collection(db, PAYMENTS_COLLECTION), cleanedPaymentRecord);

  // Update order's payment summary
  await updateOrderPaymentSummary(orderId);

  // Also update ledgerSummary so both cache fields stay in sync
  try {
    await recalculateLedgerSummary(orderId);
  } catch (err) {
    console.warn('Failed to recalculate ledger summary (server may be unavailable):', err);
  }

  return {
    id: docRef.id,
    orderId,
    orderNumber,
    amount: data.amount,
    method: data.method,
    category: data.category,
    status: initialStatus,
    stripePaymentId: data.stripePaymentId,
    stripeVerified: data.stripeVerified,
    stripeAmount: data.stripeAmount,
    stripeAmountDollars: data.stripeAmountDollars,
    stripeStatus: data.stripeStatus,
    changeOrderId: data.changeOrderId,
    description: data.description,
    notes: data.notes,
    proofFile: uploadedProofFile,
    approvedBy: data.approvedBy,
    createdBy: userId,
    createdAt: Timestamp.now(),
    updatedAt: Timestamp.now(),
  } as PaymentRecord;
}

// Get a single payment record
export async function getPaymentRecord(paymentId: string): Promise<PaymentRecord | null> {
  const docRef = doc(db, PAYMENTS_COLLECTION, paymentId);
  const docSnap = await getDoc(docRef);

  if (!docSnap.exists()) {
    return null;
  }

  return {
    id: docSnap.id,
    ...docSnap.data(),
  } as PaymentRecord;
}

// Get all payment records for an order
export async function getPaymentsForOrder(orderId: string): Promise<PaymentRecord[]> {
  const q = query(
    collection(db, PAYMENTS_COLLECTION),
    where('orderId', '==', orderId),
    orderBy('createdAt', 'desc')
  );
  const querySnapshot = await getDocs(q);

  return querySnapshot.docs.map((doc) => ({
    id: doc.id,
    ...doc.data(),
  })) as PaymentRecord[];
}

// Update payment record status
export async function updatePaymentStatus(
  paymentId: string,
  status: PaymentRecordStatus,
  additionalData?: Record<string, unknown>
): Promise<void> {
  const paymentRef = doc(db, PAYMENTS_COLLECTION, paymentId);
  const paymentSnap = await getDoc(paymentRef);

  if (!paymentSnap.exists()) {
    throw new Error('Payment record not found');
  }

  await updateDoc(paymentRef, {
    status,
    updatedAt: serverTimestamp(),
    ...additionalData,
  });

  // Update order's payment summary
  const payment = paymentSnap.data() as PaymentRecord;
  await updateOrderPaymentSummary(payment.orderId);

  // Also update ledgerSummary so both cache fields stay in sync
  try {
    await recalculateLedgerSummary(payment.orderId);
  } catch (err) {
    console.warn('Failed to recalculate ledger summary (server may be unavailable):', err);
  }
}

/**
 * @deprecated Use approveLedgerEntry Cloud Function endpoint instead.
 * This function writes directly to Firestore without updating ledgerSummary.
 */
export async function approvePayment(
  paymentId: string,
  approvedBy: string,
  notes?: string
): Promise<void> {
  const paymentRef = doc(db, PAYMENTS_COLLECTION, paymentId);
  const paymentSnap = await getDoc(paymentRef);

  if (!paymentSnap.exists()) {
    throw new Error('Payment record not found');
  }

  const payment = paymentSnap.data() as PaymentRecord;

  if (payment.status !== 'pending') {
    throw new Error('Can only approve pending payments');
  }

  const updateData: Record<string, unknown> = {
    status: 'approved',
    approvedBy,
    approvedAt: serverTimestamp(),
    updatedAt: serverTimestamp(),
  };

  if (notes) {
    updateData.notes = notes;
  }

  await updateDoc(paymentRef, updateData);

  // Update order's payment summary
  await updateOrderPaymentSummary(payment.orderId);

  // Also update ledgerSummary so both cache fields stay in sync
  try {
    await recalculateLedgerSummary(payment.orderId);
  } catch (err) {
    console.warn('Failed to recalculate ledger summary (server may be unavailable):', err);
  }
}

// Reject a payment
export async function rejectPayment(
  paymentId: string,
  rejectedBy: string,
  reason: string
): Promise<void> {
  const paymentRef = doc(db, PAYMENTS_COLLECTION, paymentId);
  const paymentSnap = await getDoc(paymentRef);

  if (!paymentSnap.exists()) {
    throw new Error('Payment record not found');
  }

  const payment = paymentSnap.data() as PaymentRecord;

  if (payment.status !== 'pending') {
    throw new Error('Can only reject pending payments');
  }

  await updateDoc(paymentRef, {
    status: 'failed',
    rejectedBy,
    rejectedAt: serverTimestamp(),
    rejectionReason: reason,
    updatedAt: serverTimestamp(),
  });

  // Update order's payment summary
  await updateOrderPaymentSummary(payment.orderId);

  // Also update ledgerSummary so both cache fields stay in sync
  try {
    await recalculateLedgerSummary(payment.orderId);
  } catch (err) {
    console.warn('Failed to recalculate ledger summary (server may be unavailable):', err);
  }
}

// Cancel a payment
export async function cancelPayment(
  paymentId: string,
  reason: string
): Promise<void> {
  const paymentRef = doc(db, PAYMENTS_COLLECTION, paymentId);
  const paymentSnap = await getDoc(paymentRef);

  if (!paymentSnap.exists()) {
    throw new Error('Payment record not found');
  }

  const payment = paymentSnap.data() as PaymentRecord;

  // Only allow cancelling pending payments
  if (payment.status !== 'pending') {
    throw new Error('Can only cancel pending payments');
  }

  await updateDoc(paymentRef, {
    status: 'cancelled',
    notes: reason,
    updatedAt: serverTimestamp(),
  });

  // Update order's payment summary
  await updateOrderPaymentSummary(payment.orderId);

  // Also update ledgerSummary so both cache fields stay in sync
  try {
    await recalculateLedgerSummary(payment.orderId);
  } catch (err) {
    console.warn('Failed to recalculate ledger summary (server may be unavailable):', err);
  }
}

/**
 * @deprecated Use recalculateLedgerSummary() instead, which goes through Cloud Functions
 * and updates ledgerSummary (not paymentSummary). This function writes to a different
 * field than the server-side functions, causing data inconsistency.
 */
export async function updateOrderPaymentSummary(orderId: string): Promise<PaymentSummary> {
  const payments = await getPaymentsForOrder(orderId);

  // Get order to know deposit required
  const orderRef = doc(db, ORDERS_COLLECTION, orderId);
  const orderSnap = await getDoc(orderRef);

  if (!orderSnap.exists()) {
    throw new Error('Order not found');
  }

  const order = orderSnap.data() as Order;
  const depositRequired = order.pricing?.deposit || 0;

  // Calculate summary
  const summary = calculatePaymentSummary(payments, depositRequired);

  // Update order with summary
  await updateDoc(orderRef, {
    paymentSummary: summary,
    updatedAt: serverTimestamp(),
  });

  return summary;
}

// Get computed payment summary for an order (without updating)
export async function getPaymentSummaryForOrder(orderId: string): Promise<PaymentSummary> {
  const payments = await getPaymentsForOrder(orderId);

  const orderRef = doc(db, ORDERS_COLLECTION, orderId);
  const orderSnap = await getDoc(orderRef);

  if (!orderSnap.exists()) {
    throw new Error('Order not found');
  }

  const order = orderSnap.data() as Order;
  const depositRequired = order.pricing?.deposit || 0;

  return calculatePaymentSummary(payments, depositRequired);
}

// Check if an order has any confirmed payments
export async function hasConfirmedPayments(orderId: string): Promise<boolean> {
  const payments = await getPaymentsForOrder(orderId);
  return payments.some((p) => isPaymentConfirmed(p.status));
}

// Get total confirmed amount for an order
export async function getTotalConfirmedAmount(orderId: string): Promise<number> {
  const payments = await getPaymentsForOrder(orderId);
  return payments
    .filter((p) => isPaymentConfirmed(p.status))
    .reduce((sum, p) => sum + p.amount, 0);
}

// Upload proof file for an existing payment
export async function uploadPaymentProof(
  paymentId: string,
  file: File,
  orderNumber: string
): Promise<PaymentProofFile> {
  const paymentRef = doc(db, PAYMENTS_COLLECTION, paymentId);
  const paymentSnap = await getDoc(paymentRef);

  if (!paymentSnap.exists()) {
    throw new Error('Payment record not found');
  }

  const proofFile = await uploadProofFile(file, orderNumber);

  await updateDoc(paymentRef, {
    proofFile,
    updatedAt: serverTimestamp(),
  });

  return proofFile;
}

// Verify Stripe payment details on a payment record
export async function updateStripeVerification(
  paymentId: string,
  verification: {
    verified: boolean;
    amount: number;
    amountDollars: number;
    status: string;
  }
): Promise<void> {
  const paymentRef = doc(db, PAYMENTS_COLLECTION, paymentId);
  const paymentSnap = await getDoc(paymentRef);

  if (!paymentSnap.exists()) {
    throw new Error('Payment record not found');
  }

  const newStatus: PaymentRecordStatus = verification.verified ? 'verified' : 'failed';

  await updateDoc(paymentRef, {
    status: newStatus,
    stripeVerified: verification.verified,
    stripeAmount: verification.amount,
    stripeAmountDollars: verification.amountDollars,
    stripeStatus: verification.status,
    updatedAt: serverTimestamp(),
  });

  // Update order's payment summary
  const payment = paymentSnap.data() as PaymentRecord;
  await updateOrderPaymentSummary(payment.orderId);

  // Also update ledgerSummary so both cache fields stay in sync
  try {
    await recalculateLedgerSummary(payment.orderId);
  } catch (err) {
    console.warn('Failed to recalculate ledger summary (server may be unavailable):', err);
  }
}

// Migrate existing order payment to payment record (for backward compatibility)
export async function migrateOrderPaymentToRecord(
  order: Order,
  userId: string
): Promise<PaymentRecord | null> {
  if (!order.id) {
    throw new Error('Order must have an ID');
  }

  // Check if payments already exist for this order
  const existingPayments = await getPaymentsForOrder(order.id);
  if (existingPayments.length > 0) {
    // Already has payment records, no migration needed
    return null;
  }

  // Only migrate if payment is confirmed (paid or manually approved)
  if (order.payment.status !== 'paid' && order.payment.status !== 'manually_approved') {
    return null;
  }

  // Determine method from payment type
  let method: PaymentMethod = 'other';
  if (order.payment.type.startsWith('stripe')) {
    method = 'stripe';
  } else if (order.payment.type === 'check') {
    method = 'check';
  } else if (order.payment.type === 'wire') {
    method = 'wire';
  } else if (order.payment.type === 'credit_on_file') {
    method = 'credit_on_file';
  }

  // Create payment record from order payment data
  const paymentData: Parameters<typeof createPaymentRecord>[2] = {
    amount: order.pricing.deposit,
    method,
    category: 'initial_deposit',
    status: method === 'stripe' ? 'verified' : 'approved',
    description: 'Migrated from legacy order payment',
  };

  // Add Stripe-specific fields
  if (method === 'stripe' && order.payment.stripePaymentId) {
    paymentData.stripePaymentId = order.payment.stripePaymentId;
    paymentData.stripeVerified = order.payment.stripeVerification?.verified;
    paymentData.stripeAmount = order.payment.stripeVerification?.paymentAmount;
    paymentData.stripeAmountDollars = order.payment.stripeVerification?.paymentAmountDollars;
    paymentData.stripeStatus = order.payment.stripeVerification?.stripeStatus;
  }

  // Add manual approval fields
  if (order.payment.manualApproval?.approved) {
    paymentData.approvedBy = order.payment.manualApproval.approvedBy;
  }

  return createPaymentRecord(order.id, order.orderNumber, paymentData, userId);
}

// ============================================================
// PAYMENT LEDGER FUNCTIONS
// ============================================================

// Get all ledger entries for an order
export async function getLedgerEntriesForOrder(
  orderId: string,
  includeVoided: boolean = false
): Promise<PaymentLedgerEntry[]> {
  const q = query(
    collection(db, LEDGER_COLLECTION),
    where('orderId', '==', orderId),
    orderBy('createdAt', 'desc')
  );
  const querySnapshot = await getDocs(q);

  return querySnapshot.docs
    .filter((doc) => includeVoided || doc.data().status !== 'voided')
    .map((doc) => ({
      id: doc.id,
      ...doc.data(),
    })) as PaymentLedgerEntry[];
}

// Trigger ledger summary recalculation via cloud function
export async function recalculateLedgerSummary(orderId: string): Promise<OrderLedgerSummary> {
  const response = await fetch(
    `${import.meta.env.VITE_FUNCTIONS_URL || ''}/recalculateLedgerSummary`,
    {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ orderId }),
    }
  );
  if (!response.ok) throw new Error(`Server error: ${response.status} ${response.statusText}`);

  const data = await response.json();

  if (!data.success) {
    throw new Error(data.error || 'Failed to recalculate ledger summary');
  }

  return data.summary;
}

// Add a ledger entry via cloud function
export async function addLedgerEntry(
  data: Omit<PaymentLedgerEntry, 'id' | 'createdAt' | 'status'> & {
    approvalCode?: string;
    createdBy: string;
  }
): Promise<{ entryId: string; summary: OrderLedgerSummary }> {
  const response = await fetch(
    `${import.meta.env.VITE_FUNCTIONS_URL || ''}/addLedgerEntry`,
    {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(data),
    }
  );
  if (!response.ok) throw new Error(`Server error: ${response.status} ${response.statusText}`);

  const result = await response.json();

  if (!result.success) {
    throw new Error(result.error || 'Failed to add ledger entry');
  }

  return {
    entryId: result.entryId,
    summary: result.summary,
  };
}

// Void a ledger entry via cloud function
export async function voidLedgerEntry(
  entryId: string,
  voidedBy: string,
  voidReason: string
): Promise<OrderLedgerSummary> {
  const response = await fetch(
    `${import.meta.env.VITE_FUNCTIONS_URL || ''}/voidLedgerEntry`,
    {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ entryId, voidedBy, voidReason }),
    }
  );
  if (!response.ok) throw new Error(`Server error: ${response.status} ${response.statusText}`);

  const data = await response.json();

  if (!data.success) {
    throw new Error(data.error || 'Failed to void ledger entry');
  }

  return data.summary;
}

// Convert legacy PaymentRecord to a display-compatible ledger entry
export function paymentRecordToLedgerEntry(payment: PaymentRecord): PaymentLedgerEntry {
  return {
    id: payment.id,
    orderId: payment.orderId,
    orderNumber: payment.orderNumber,
    changeOrderId: payment.changeOrderId,
    transactionType: payment.amount < 0 ? 'refund' : 'payment',
    amount: Math.abs(payment.amount),
    method: payment.method,
    category: payment.category as any,
    status: payment.status as any,
    stripePaymentId: payment.stripePaymentId,
    stripeVerified: payment.stripeVerified,
    stripeAmount: payment.stripeAmount,
    stripeAmountDollars: payment.stripeAmountDollars,
    description: payment.description || '',
    notes: payment.notes,
    proofFile: payment.proofFile,
    createdAt: payment.createdAt,
    createdBy: payment.createdBy,
    approvedBy: payment.approvedBy,
    approvedAt: payment.approvedAt,
  };
}

// ============================================================
// LEDGER ENTRY GROUPING HELPERS
// ============================================================

export interface GroupedLedgerEntries {
  payments: PaymentLedgerEntry[];         // type === 'payment'
  refunds: PaymentLedgerEntry[];          // type === 'refund'
  depositAdjustments: PaymentLedgerEntry[]; // type === 'deposit_increase' | 'deposit_decrease'
}

/**
 * Groups ledger entries by their transaction type for display purposes.
 * Separates actual money movement (payments/refunds) from accounting adjustments.
 */
export function groupLedgerEntriesByType(entries: PaymentLedgerEntry[]): GroupedLedgerEntries {
  const payments: PaymentLedgerEntry[] = [];
  const refunds: PaymentLedgerEntry[] = [];
  const depositAdjustments: PaymentLedgerEntry[] = [];

  for (const entry of entries) {
    switch (entry.transactionType) {
      case 'payment':
        payments.push(entry);
        break;
      case 'refund':
        refunds.push(entry);
        break;
      case 'deposit_increase':
      case 'deposit_decrease':
        depositAdjustments.push(entry);
        break;
    }
  }

  return { payments, refunds, depositAdjustments };
}

/**
 * Calculate totals from grouped ledger entries.
 * Only includes verified/approved entries in totals.
 */
export function calculateGroupedTotals(grouped: GroupedLedgerEntries): {
  totalCharged: number;
  totalRefunded: number;
  pendingPayments: number;
  pendingRefunds: number;
} {
  const confirmedStatuses = ['verified', 'approved'];

  const totalCharged = grouped.payments
    .filter(e => confirmedStatuses.includes(e.status))
    .reduce((sum, e) => sum + e.amount, 0);

  const totalRefunded = grouped.refunds
    .filter(e => confirmedStatuses.includes(e.status))
    .reduce((sum, e) => sum + e.amount, 0);

  const pendingPayments = grouped.payments
    .filter(e => e.status === 'pending')
    .reduce((sum, e) => sum + e.amount, 0);

  const pendingRefunds = grouped.refunds
    .filter(e => e.status === 'pending')
    .reduce((sum, e) => sum + e.amount, 0);

  return { totalCharged, totalRefunded, pendingPayments, pendingRefunds };
}

// ============================================================
// ALL PAYMENTS & AUDIT FUNCTIONS
// ============================================================

// Extended ledger entry with customer name and order financial info
export interface EnrichedLedgerEntry extends PaymentLedgerEntry {
  customerName?: string;
  orderDeposit?: number;
  orderBalance?: number;
  orderBalanceStatus?: string;
  // Running balance fields (balance after this specific transaction)
  balanceAfter?: number;
  depositAtTime?: number;
}

/**
 * Get all ledger entries across all orders with filtering and pagination
 * Powers the "All Payments" tab in the Manager dashboard
 */
export async function getAllPayments(
  filters: AllPaymentsFilters = {}
): Promise<AllPaymentsResponse & { entries: EnrichedLedgerEntry[] }> {
  const params = new URLSearchParams();

  if (filters.status && filters.status !== 'all') {
    params.append('status', filters.status);
  }
  if (filters.transactionType && filters.transactionType !== 'all') {
    params.append('transactionType', filters.transactionType);
  }
  if (filters.startDate) {
    params.append('startDate', filters.startDate.toISOString());
  }
  if (filters.endDate) {
    params.append('endDate', filters.endDate.toISOString());
  }
  if (filters.search) {
    params.append('search', filters.search);
  }
  if (filters.limit) {
    params.append('limit', filters.limit.toString());
  }
  if (filters.offset) {
    params.append('offset', filters.offset.toString());
  }

  const response = await fetch(
    `${import.meta.env.VITE_FUNCTIONS_URL || ''}/getAllLedgerEntries?${params.toString()}`,
    {
      method: 'GET',
      headers: { 'Content-Type': 'application/json' },
    }
  );
  if (!response.ok) throw new Error(`Server error: ${response.status} ${response.statusText}`);

  const data = await response.json();

  if (data.error) {
    throw new Error(data.error);
  }

  return {
    entries: data.entries as EnrichedLedgerEntry[],
    total: data.total,
    hasMore: data.hasMore,
  };
}

/**
 * Get audit history for a specific payment
 */
export async function getPaymentAuditHistory(
  ledgerEntryId: string
): Promise<PaymentAuditEntry[]> {
  const response = await fetch(
    `${import.meta.env.VITE_FUNCTIONS_URL || ''}/getAuditHistoryForPayment?ledgerEntryId=${encodeURIComponent(ledgerEntryId)}`,
    {
      method: 'GET',
      headers: { 'Content-Type': 'application/json' },
    }
  );
  if (!response.ok) throw new Error(`Server error: ${response.status} ${response.statusText}`);

  const data = await response.json();

  if (data.error) {
    throw new Error(data.error);
  }

  return data.entries as PaymentAuditEntry[];
}

/**
 * Get audit history for all payments in an order
 */
export async function getOrderAuditHistory(
  orderId: string
): Promise<PaymentAuditEntry[]> {
  const response = await fetch(
    `${import.meta.env.VITE_FUNCTIONS_URL || ''}/getAuditHistoryForOrder?orderId=${encodeURIComponent(orderId)}`,
    {
      method: 'GET',
      headers: { 'Content-Type': 'application/json' },
    }
  );
  if (!response.ok) throw new Error(`Server error: ${response.status} ${response.statusText}`);

  const data = await response.json();

  if (data.error) {
    throw new Error(data.error);
  }

  return data.entries as PaymentAuditEntry[];
}

/**
 * Export payments to CSV format
 */
export function exportPaymentsToCSV(entries: EnrichedLedgerEntry[]): string {
  const headers = [
    'Payment Number',
    'Date',
    'Order Number',
    'Customer',
    'Type',
    'Amount',
    'Deposit Required',
    'Balance',
    'Balance Status',
    'Method',
    'Status',
    'Stripe ID',
    'Description',
  ];

  const rows = entries.map(entry => {
    const date = entry.createdAt
      ? new Date((entry.createdAt as any).seconds * 1000).toLocaleDateString()
      : '';

    return [
      entry.paymentNumber || entry.id || '',
      date,
      entry.orderNumber,
      entry.customerName || '',
      entry.transactionType,
      entry.amount.toFixed(2),
      (entry.orderDeposit || 0).toFixed(2),
      (entry.orderBalance || 0).toFixed(2),
      entry.orderBalanceStatus || '',
      entry.method,
      entry.status,
      entry.stripePaymentId || '',
      entry.description || '',
    ];
  });

  const csvContent = [
    headers.join(','),
    ...rows.map(row => row.map(cell => `"${String(cell).replace(/"/g, '""')}"`).join(',')),
  ].join('\n');

  return csvContent;
}

/**
 * Download CSV file
 */
export function downloadCSV(csvContent: string, filename: string): void {
  const blob = new Blob([csvContent], { type: 'text/csv;charset=utf-8;' });
  const link = document.createElement('a');
  const url = URL.createObjectURL(blob);

  link.setAttribute('href', url);
  link.setAttribute('download', filename);
  link.style.visibility = 'hidden';
  document.body.appendChild(link);
  link.click();
  document.body.removeChild(link);
}
