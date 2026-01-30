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

const PAYMENTS_COLLECTION = 'payments';
const ORDERS_COLLECTION = 'orders';

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

// Create a new payment record
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
}

// Approve a manual payment
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
}

// Update order's payment summary (denormalized for quick access)
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
