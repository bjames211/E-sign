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
  setDoc,
  Timestamp,
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

const ORDERS_COLLECTION = 'orders';
const QUOTES_COLLECTION = 'quotes';
const COUNTERS_COLLECTION = 'counters';

// Generate sequential order number
async function generateOrderNumber(): Promise<string> {
  const counterRef = doc(db, COUNTERS_COLLECTION, 'orders_form');
  const counterSnap = await getDoc(counterRef);

  let nextNumber = 1;
  if (counterSnap.exists()) {
    nextNumber = (counterSnap.data().current || 0) + 1;
  }

  await setDoc(counterRef, { current: nextNumber });
  return `ORD-${String(nextNumber).padStart(5, '0')}`;
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
  // Test mode - mark as paid immediately
  if (isTestMode) {
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
  // Manual payment types - pending until manually approved
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

  await updateDoc(docRef, updates);
}

// Update order status
export async function updateOrderStatus(
  orderId: string,
  status: OrderStatus,
  additionalData?: Record<string, unknown>
): Promise<void> {
  const docRef = doc(db, ORDERS_COLLECTION, orderId);
  await updateDoc(docRef, {
    status,
    updatedAt: serverTimestamp(),
    ...additionalData,
  });
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
