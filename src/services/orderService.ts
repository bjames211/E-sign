import {
  collection,
  addDoc,
  updateDoc,
  deleteDoc,
  doc,
  getDoc,
  getDocs,
  query,
  orderBy,
  where,
  serverTimestamp,
  Timestamp,
  limit as firestoreLimit,
  startAfter,
  QueryDocumentSnapshot,
  DocumentData,
  getCountFromServer,
} from 'firebase/firestore';
import { ref, uploadBytes, getDownloadURL } from 'firebase/storage';
import { db, storage } from '../config/firebase';
import {
  Order,
  OrderFormData,
  OrderStatus,
  Quote,
  OrderFile,
  OrderFiles,
  PaymentStatus,
  requiresManualPaymentApproval,
} from '../types/order';

import { auth } from '../config/firebase';

const ORDERS_COLLECTION = 'orders';
const QUOTES_COLLECTION = 'quotes';
const COUNTERS_COLLECTION = 'counters';
const AUDIT_LOG_COLLECTION = 'order_audit_log';

// --- Order Audit Trail ---
interface AuditFieldChange {
  field: string;
  oldValue: unknown;
  newValue: unknown;
}

interface OrderAuditEntry {
  orderId: string;
  orderNumber: string;
  action: 'created' | 'updated' | 'status_changed' | 'deleted' | 'sent_for_signature' | 'signed';
  changes: AuditFieldChange[];
  userId: string;
  userEmail: string;
  timestamp: ReturnType<typeof serverTimestamp>;
}

async function logOrderAudit(
  orderId: string,
  orderNumber: string,
  action: OrderAuditEntry['action'],
  changes: AuditFieldChange[] = [],
) {
  try {
    const user = auth.currentUser;
    const entry: OrderAuditEntry = {
      orderId,
      orderNumber,
      action,
      changes,
      userId: user?.uid || 'unknown',
      userEmail: user?.email || 'unknown',
      timestamp: serverTimestamp(),
    };
    await addDoc(collection(db, AUDIT_LOG_COLLECTION), entry);
  } catch (err) {
    console.error('Failed to log order audit:', err);
  }
}

function diffFields(oldData: Record<string, unknown>, newData: Record<string, unknown>): AuditFieldChange[] {
  const changes: AuditFieldChange[] = [];
  for (const key of Object.keys(newData)) {
    if (key === 'updatedAt') continue;
    const oldVal = oldData[key];
    const newVal = newData[key];
    if (JSON.stringify(oldVal) !== JSON.stringify(newVal)) {
      changes.push({ field: key, oldValue: oldVal, newValue: newVal });
    }
  }
  return changes;
}

// Fetch audit history for an order
export async function getOrderAuditLog(orderId: string): Promise<(OrderAuditEntry & { id: string })[]> {
  const q = query(
    collection(db, AUDIT_LOG_COLLECTION),
    where('orderId', '==', orderId),
    orderBy('timestamp', 'desc')
  );
  const snap = await getDocs(q);
  return snap.docs.map(d => ({ id: d.id, ...d.data() } as OrderAuditEntry & { id: string }));
}

// Generate sequential order number with uniqueness check
async function generateOrderNumber(): Promise<string> {
  const counterRef = doc(db, COUNTERS_COLLECTION, 'order_number');

  // Use a transaction to ensure atomic increment
  const { runTransaction, query, where, getDocs, limit } = await import('firebase/firestore');

  let orderNumber = '';
  let attempts = 0;
  const maxAttempts = 10;

  while (attempts < maxAttempts) {
    attempts++;

    // Get next number atomically
    const nextNumber = await runTransaction(db, async (transaction) => {
      const counterSnap = await transaction.get(counterRef);
      let current = 0;
      if (counterSnap.exists()) {
        current = counterSnap.data().current || 0;
      }
      const next = current + 1;
      transaction.set(counterRef, { current: next });
      return next;
    });

    orderNumber = `ORD-${String(nextNumber).padStart(5, '0')}`;

    // Verify uniqueness - check if order number already exists
    const ordersRef = collection(db, 'orders');
    const existingQuery = query(ordersRef, where('orderNumber', '==', orderNumber), limit(1));
    const existingSnap = await getDocs(existingQuery);

    if (existingSnap.empty) {
      // Order number is unique, we can use it
      return orderNumber;
    }

    // If duplicate found, loop will try again with next number
    console.warn(`Order number ${orderNumber} already exists, trying next...`);
  }

  throw new Error(`Failed to generate unique order number after ${maxAttempts} attempts`);
}

// Upload a single file to Firebase Storage
async function uploadFile(
  file: File,
  orderNumber: string,
  category: string
): Promise<OrderFile> {
  const timestamp = Date.now();
  const sanitizedName = file.name.replace(/[^a-zA-Z0-9.-]/g, '_');
  const storagePath = `orders/${orderNumber}/${category}/${timestamp}_${sanitizedName}`;
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

// Upload all files for an order
async function uploadOrderFiles(
  formFiles: OrderFormData['files'] | undefined,
  orderNumber: string
): Promise<OrderFiles> {
  const files: OrderFiles = {
    renderings: [],
    extraFiles: [],
    installerFiles: [],
  };

  // Return empty files if no form files provided
  if (!formFiles) {
    return files;
  }

  // Upload order form PDF (only include if exists)
  if (formFiles.orderFormPdf?.file) {
    files.orderFormPdf = await uploadFile(
      formFiles.orderFormPdf.file,
      orderNumber,
      'order-form'
    );
  }

  // Upload renderings
  if (formFiles.renderings?.length) {
    for (const pending of formFiles.renderings) {
      if (pending?.file) {
        const uploaded = await uploadFile(pending.file, orderNumber, 'renderings');
        files.renderings.push(uploaded);
      }
    }
  }

  // Upload extra files
  if (formFiles.extraFiles?.length) {
    for (const pending of formFiles.extraFiles) {
      if (pending?.file) {
        const uploaded = await uploadFile(pending.file, orderNumber, 'extra');
        files.extraFiles.push(uploaded);
      }
    }
  }

  // Upload installer files
  if (formFiles.installerFiles?.length) {
    for (const pending of formFiles.installerFiles) {
      if (pending?.file) {
        const uploaded = await uploadFile(pending.file, orderNumber, 'installer');
        files.installerFiles.push(uploaded);
      }
    }
  }

  return files;
}

// Determine initial payment status based on payment type
function getInitialPaymentStatus(paymentType: string, stripePaymentId?: string, isTestMode?: boolean): PaymentStatus {
  // Manual payment types (check, wire, credit_on_file, other) - ALWAYS pending until manager approves
  // This applies even in test mode - manual payments need approval
  const manualPaymentTypes = ['check', 'wire', 'credit_on_file', 'other'];
  if (manualPaymentTypes.includes(paymentType)) {
    return 'pending';
  }

  // Test mode for Stripe payments - mark as paid immediately
  if (isTestMode && paymentType.startsWith('stripe_')) {
    return 'paid';
  }
  // Stripe already paid - mark as paid (will be verified)
  if (paymentType === 'stripe_already_paid' && stripePaymentId) {
    return 'pending'; // Will be verified and updated
  }
  // Other Stripe types - pending until payment completes
  if (paymentType.startsWith('stripe_')) {
    return 'pending';
  }
  // Default to pending
  return 'pending';
}

// Create a new order
export async function createOrder(
  formData: OrderFormData,
  userId: string
): Promise<Order> {
  const orderNumber = await generateOrderNumber();
  const now = serverTimestamp();

  // Upload all files first
  const uploadedFiles = await uploadOrderFiles(formData.files, orderNumber);

  // Determine if manual payment approval is needed
  const needsPaymentApproval = requiresManualPaymentApproval(formData.payment.type);
  const initialPaymentStatus = getInitialPaymentStatus(
    formData.payment.type,
    formData.payment.stripePaymentId,
    formData.payment.stripeTestMode
  );

  // Parse pricing once for both pricing and originalPricing
  const parsedPricing = {
    subtotalBeforeTax: parseFloat(formData.pricing.subtotalBeforeTax) || 0,
    extraMoneyFluff: parseFloat(formData.pricing.extraMoneyFluff) || 0,
    deposit: parseFloat(formData.pricing.deposit) || 0,
  };

  const order: Omit<Order, 'id' | 'createdAt' | 'updatedAt'> & {
    createdAt: ReturnType<typeof serverTimestamp>;
    updatedAt: ReturnType<typeof serverTimestamp>;
  } = {
    orderNumber,
    status: 'draft',
    customer: formData.customer,
    building: formData.building,
    pricing: parsedPricing,
    originalPricing: parsedPricing,  // Lock in original values for audit trail
    changeOrderCount: 0,
    hasChangeOrders: false,
    payment: {
      type: formData.payment.type,
      status: initialPaymentStatus,
      ...(formData.payment.stripePaymentId && { stripePaymentId: formData.payment.stripePaymentId }),
      ...(formData.payment.notes && { notes: formData.payment.notes }),
    },
    files: uploadedFiles,
    salesPerson: formData.salesPerson || '',
    orderFormName: formData.orderFormName || '',
    paymentNotes: formData.paymentNotes || '',
    referredBy: formData.referredBy || '',
    specialNotes: formData.specialNotes || '',
    ...(formData.quoteId && { quoteId: formData.quoteId }),
    needsPaymentApproval,
    // Set test mode flag if payment is in test mode
    ...(formData.payment.stripeTestMode && { isTestMode: true }),
    // Save test payment amount if provided
    ...(formData.payment.stripeTestMode && formData.payment.testAmount && {
      testPaymentAmount: parseFloat(formData.payment.testAmount) || 0,
    }),
    createdBy: userId,
    createdAt: now,
    updatedAt: now,
  };

  const docRef = await addDoc(collection(db, ORDERS_COLLECTION), order);

  // Audit: log creation
  await logOrderAudit(docRef.id, orderNumber, 'created');

  return {
    ...order,
    id: docRef.id,
    createdAt: Timestamp.now(),
    updatedAt: Timestamp.now(),
  } as Order;
}

// Update an existing order
export async function updateOrder(
  orderId: string,
  formData: Partial<OrderFormData>
): Promise<void> {
  const docRef = doc(db, ORDERS_COLLECTION, orderId);

  const updates: Record<string, unknown> = {
    updatedAt: serverTimestamp(),
  };

  if (formData.customer) {
    updates.customer = formData.customer;
  }
  if (formData.building) {
    updates.building = formData.building;
  }
  if (formData.pricing) {
    updates.pricing = {
      subtotalBeforeTax: parseFloat(formData.pricing.subtotalBeforeTax) || 0,
      extraMoneyFluff: parseFloat(formData.pricing.extraMoneyFluff) || 0,
      deposit: parseFloat(formData.pricing.deposit) || 0,
    };
  }
  if (formData.payment) {
    updates.payment = {
      type: formData.payment.type,
      ...(formData.payment.stripePaymentId && { stripePaymentId: formData.payment.stripePaymentId }),
      ...(formData.payment.notes && { notes: formData.payment.notes }),
    };
  }
  if (formData.salesPerson !== undefined) {
    updates.salesPerson = formData.salesPerson;
  }
  if (formData.orderFormName !== undefined) {
    updates.orderFormName = formData.orderFormName;
  }
  if (formData.paymentNotes !== undefined) {
    updates.paymentNotes = formData.paymentNotes;
  }
  if (formData.referredBy !== undefined) {
    updates.referredBy = formData.referredBy;
  }
  if (formData.specialNotes !== undefined) {
    updates.specialNotes = formData.specialNotes;
  }

  // Audit: read current and diff
  const currentSnap = await getDoc(docRef);
  if (currentSnap.exists()) {
    const currentData = currentSnap.data();
    const changes = diffFields(currentData as Record<string, unknown>, updates);
    if (changes.length > 0) {
      await logOrderAudit(orderId, currentData.orderNumber || '', 'updated', changes);
    }
  }

  await updateDoc(docRef, updates);
}

// Update order status
export async function updateOrderStatus(
  orderId: string,
  status: OrderStatus,
  additionalData?: Record<string, unknown>
): Promise<void> {
  const docRef = doc(db, ORDERS_COLLECTION, orderId);

  // Audit: log status change
  const currentSnap = await getDoc(docRef);
  const currentData = currentSnap.exists() ? currentSnap.data() : null;
  const oldStatus = currentData?.status || 'unknown';

  await updateDoc(docRef, {
    status,
    updatedAt: serverTimestamp(),
    ...additionalData,
  });

  await logOrderAudit(
    orderId,
    currentData?.orderNumber || '',
    'status_changed',
    [{ field: 'status', oldValue: oldStatus, newValue: status }],
  );
}

// Get a single order
export async function getOrder(orderId: string): Promise<Order | null> {
  const docRef = doc(db, ORDERS_COLLECTION, orderId);
  const docSnap = await getDoc(docRef);

  if (!docSnap.exists()) {
    return null;
  }

  return {
    id: docSnap.id,
    ...docSnap.data(),
  } as Order;
}

// Get all orders
export async function getOrders(): Promise<Order[]> {
  const q = query(
    collection(db, ORDERS_COLLECTION),
    orderBy('createdAt', 'desc')
  );
  const querySnapshot = await getDocs(q);

  return querySnapshot.docs.map((doc) => ({
    id: doc.id,
    ...doc.data(),
  })) as Order[];
}

// Paginated orders
export interface PaginatedOrdersResult {
  orders: Order[];
  lastDoc: QueryDocumentSnapshot<DocumentData> | null;
  hasMore: boolean;
  totalCount: number;
}

export async function getOrdersPaginated(
  pageSize: number = 50,
  afterDoc?: QueryDocumentSnapshot<DocumentData> | null,
): Promise<PaginatedOrdersResult> {
  // Get total count
  const countQuery = query(collection(db, ORDERS_COLLECTION));
  const countSnap = await getCountFromServer(countQuery);
  const totalCount = countSnap.data().count;

  // Build paginated query
  const q = afterDoc
    ? query(collection(db, ORDERS_COLLECTION), orderBy('createdAt', 'desc'), startAfter(afterDoc), firestoreLimit(pageSize + 1))
    : query(collection(db, ORDERS_COLLECTION), orderBy('createdAt', 'desc'), firestoreLimit(pageSize + 1));
  const querySnapshot = await getDocs(q);

  const docs = querySnapshot.docs;
  const hasMore = docs.length > pageSize;
  const resultDocs = hasMore ? docs.slice(0, pageSize) : docs;

  return {
    orders: resultDocs.map((doc) => ({
      id: doc.id,
      ...doc.data(),
    })) as Order[],
    lastDoc: resultDocs.length > 0 ? resultDocs[resultDocs.length - 1] : null,
    hasMore,
    totalCount,
  };
}

// Get orders by status
export async function getOrdersByStatus(status: OrderStatus): Promise<Order[]> {
  const q = query(
    collection(db, ORDERS_COLLECTION),
    where('status', '==', status),
    orderBy('createdAt', 'desc')
  );
  const querySnapshot = await getDocs(q);

  return querySnapshot.docs.map((doc) => ({
    id: doc.id,
    ...doc.data(),
  })) as Order[];
}

// Delete an order
export async function deleteOrder(orderId: string): Promise<void> {
  const docRef = doc(db, ORDERS_COLLECTION, orderId);
  await deleteDoc(docRef);
}

// ==================== QUOTES ====================

// Get all quotes
export async function getQuotes(): Promise<Quote[]> {
  const q = query(
    collection(db, QUOTES_COLLECTION),
    orderBy('createdAt', 'desc')
  );
  const querySnapshot = await getDocs(q);

  return querySnapshot.docs.map((doc) => ({
    id: doc.id,
    ...doc.data(),
  })) as Quote[];
}

// Get a single quote
export async function getQuote(quoteId: string): Promise<Quote | null> {
  const docRef = doc(db, QUOTES_COLLECTION, quoteId);
  const docSnap = await getDoc(docRef);

  if (!docSnap.exists()) {
    return null;
  }

  return {
    id: docSnap.id,
    ...docSnap.data(),
  } as Quote;
}

// Search quotes by customer name or quote number
export async function searchQuotes(searchTerm: string): Promise<Quote[]> {
  // Firestore doesn't support full-text search, so we fetch all and filter
  // In production, consider using Algolia or similar
  const quotes = await getQuotes();
  const term = searchTerm.toLowerCase();

  return quotes.filter(
    (quote) =>
      quote.quoteNumber.toLowerCase().includes(term) ||
      quote.customerName.toLowerCase().includes(term)
  );
}

// Create a quote (for seeding/testing)
export async function createQuote(quoteData: Omit<Quote, 'id' | 'createdAt'>): Promise<Quote> {
  const docRef = await addDoc(collection(db, QUOTES_COLLECTION), {
    ...quoteData,
    createdAt: serverTimestamp(),
  });

  return {
    ...quoteData,
    id: docRef.id,
    createdAt: Timestamp.now(),
  } as Quote;
}
