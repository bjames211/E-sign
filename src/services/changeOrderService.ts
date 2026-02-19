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
  setDoc,
  Timestamp,
} from 'firebase/firestore';
import { ref, uploadBytes, getDownloadURL } from 'firebase/storage';
import { db, storage } from '../config/firebase';
import {
  ChangeOrder,
  ChangeOrderFormData,
  ChangeOrderFiles,
  ChangeOrderPendingFiles,
  PricingSnapshot,
  PricingDifferences,
  calculateDifferences,
  calculateTotal,
  computeCustomerChanges,
  computeBuildingChanges,
} from '../types/changeOrder';
import { Order, PricingInfo, OrderFile, CustomerInfo, BuildingInfo } from '../types/order';

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

const CHANGE_ORDERS_COLLECTION = 'change_orders';
const ORDERS_COLLECTION = 'orders';
const COUNTERS_COLLECTION = 'counters';

// Upload a single file to Firebase Storage for change order
async function uploadChangeOrderFile(
  file: File,
  changeOrderNumber: string,
  category: string
): Promise<OrderFile> {
  const timestamp = Date.now();
  const sanitizedName = file.name.replace(/[^a-zA-Z0-9.-]/g, '_');
  const storagePath = `change_orders/${changeOrderNumber}/${category}/${timestamp}_${sanitizedName}`;
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

// Upload all files for a change order
async function uploadChangeOrderFiles(
  pendingFiles: ChangeOrderPendingFiles | undefined,
  changeOrderNumber: string
): Promise<ChangeOrderFiles> {
  const files: ChangeOrderFiles = {
    orderFormPdf: null,  // Use null instead of undefined for Firestore compatibility
    renderings: [],
    extraFiles: [],
    installerFiles: [],
  };

  if (!pendingFiles) {
    return files;
  }

  // Upload order form PDF
  if (pendingFiles.orderFormPdf?.file) {
    files.orderFormPdf = await uploadChangeOrderFile(
      pendingFiles.orderFormPdf.file,
      changeOrderNumber,
      'order-form'
    );
  }

  // Upload renderings
  if (pendingFiles.renderings?.length) {
    for (const pending of pendingFiles.renderings) {
      if (pending?.file) {
        const uploaded = await uploadChangeOrderFile(pending.file, changeOrderNumber, 'renderings');
        files.renderings.push(uploaded);
      }
    }
  }

  // Upload extra files
  if (pendingFiles.extraFiles?.length) {
    for (const pending of pendingFiles.extraFiles) {
      if (pending?.file) {
        const uploaded = await uploadChangeOrderFile(pending.file, changeOrderNumber, 'extra');
        files.extraFiles.push(uploaded);
      }
    }
  }

  // Upload installer files
  if (pendingFiles.installerFiles?.length) {
    for (const pending of pendingFiles.installerFiles) {
      if (pending?.file) {
        const uploaded = await uploadChangeOrderFile(pending.file, changeOrderNumber, 'installer');
        files.installerFiles.push(uploaded);
      }
    }
  }

  return files;
}

// Generate sequential change order number
async function generateChangeOrderNumber(): Promise<string> {
  const counterRef = doc(db, COUNTERS_COLLECTION, 'change_orders');
  const counterSnap = await getDoc(counterRef);

  let nextNumber = 1;
  if (counterSnap.exists()) {
    nextNumber = (counterSnap.data().current || 0) + 1;
  }

  await setDoc(counterRef, { current: nextNumber });
  return `CO-${String(nextNumber).padStart(5, '0')}`;
}

// Convert PricingInfo to PricingSnapshot
function pricingToSnapshot(pricing: PricingInfo): PricingSnapshot {
  return {
    subtotalBeforeTax: pricing.subtotalBeforeTax,
    extraMoneyFluff: pricing.extraMoneyFluff,
    deposit: pricing.deposit,
    total: calculateTotal(pricing.subtotalBeforeTax, pricing.extraMoneyFluff),
  };
}

// Calculate cumulative differences from original order
function calculateCumulativeFromOriginal(
  originalPricing: PricingInfo,
  newValues: PricingSnapshot
): PricingDifferences {
  const originalSnapshot = pricingToSnapshot(originalPricing);
  return calculateDifferences(originalSnapshot, newValues);
}

// Create a new change order
export async function createChangeOrder(
  order: Order,
  formData: ChangeOrderFormData,
  userId: string
): Promise<ChangeOrder> {
  if (!order.id) {
    throw new Error('Order must have an ID');
  }

  // Check for existing active change order that blocks creation
  // Only block if there's a DRAFT change order (user should edit it instead)
  // Allow creating new CO if existing one is pending_signature (will cancel it when sent)
  if (order.activeChangeOrderId) {
    const existingCO = await getChangeOrder(order.activeChangeOrderId);
    if (existingCO && existingCO.status === 'draft') {
      throw new Error(
        `Cannot create new change order. ${existingCO.changeOrderNumber} is still in draft. Please edit it instead.`
      );
    }
  }

  const changeOrderNumber = await generateChangeOrderNumber();
  const now = serverTimestamp();

  // Upload files first
  const uploadedFiles = await uploadChangeOrderFiles(formData.pendingFiles, changeOrderNumber);

  // Current order pricing becomes the "previous" values
  const previousValues = pricingToSnapshot(order.pricing);

  // Parse new values from form
  const newValues: PricingSnapshot = {
    subtotalBeforeTax: parseFloat(formData.newValues.subtotalBeforeTax) || 0,
    extraMoneyFluff: parseFloat(formData.newValues.extraMoneyFluff) || 0,
    deposit: parseFloat(formData.newValues.deposit) || 0,
    total: 0, // Will be calculated
  };
  newValues.total = calculateTotal(newValues.subtotalBeforeTax, newValues.extraMoneyFluff);

  // Calculate differences
  const differences = calculateDifferences(previousValues, newValues);

  // Calculate cumulative from original
  const originalPricing = order.originalPricing || order.pricing;
  const cumulativeFromOriginal = calculateCumulativeFromOriginal(originalPricing, newValues);

  // Build customer changes if customer is being edited
  let customerChanges: ReturnType<typeof computeCustomerChanges> = [];
  let newCustomer: CustomerInfo | undefined;
  let previousCustomer: CustomerInfo | undefined;
  if (formData.editCustomer && formData.customer) {
    previousCustomer = { ...order.customer };
    newCustomer = formData.customer;
    customerChanges = computeCustomerChanges(order.customer, formData.customer);
  }

  // Build building changes if building is being edited
  let buildingChanges: ReturnType<typeof computeBuildingChanges> = formData.buildingChanges || [];
  let newBuilding: BuildingInfo | undefined;
  let previousBuilding: BuildingInfo | undefined;
  if (formData.editBuilding && formData.building) {
    previousBuilding = { ...order.building };
    newBuilding = formData.building;
    buildingChanges = computeBuildingChanges(order.building, formData.building);
  }

  // Snapshot of previous files from the order (use null instead of undefined for Firestore)
  const previousFiles: ChangeOrderFiles = {
    orderFormPdf: order.files?.orderFormPdf || null,
    renderings: order.files?.renderings || [],
    extraFiles: order.files?.extraFiles || [],
    installerFiles: order.files?.installerFiles || [],
  };

  // Build change order object - only include defined values (Firestore doesn't allow undefined)
  const changeOrder: Record<string, unknown> = {
    orderId: order.id,
    orderNumber: order.orderNumber,
    changeOrderNumber,
    status: 'draft',
    reason: formData.reason,
    previousValues,
    newValues,
    differences,
    cumulativeFromOriginal,
    buildingChanges,
    customerChanges,
    previousFiles,
    files: uploadedFiles,
    createdBy: userId,
    createdAt: now,
    updatedAt: now,
  };

  // Only add customer/building fields if they have values
  if (previousCustomer) {
    changeOrder.previousCustomer = previousCustomer;
  }
  if (previousBuilding) {
    changeOrder.previousBuilding = previousBuilding;
  }
  if (newCustomer) {
    changeOrder.newCustomer = newCustomer;
  }
  if (newBuilding) {
    changeOrder.newBuilding = newBuilding;
  }

  // Remove any undefined values before saving to Firestore
  const cleanedChangeOrder = removeUndefinedValues(changeOrder);
  const docRef = await addDoc(collection(db, CHANGE_ORDERS_COLLECTION), cleanedChangeOrder);

  // Update the parent order to track this change order
  const orderRef = doc(db, ORDERS_COLLECTION, order.id);
  await updateDoc(orderRef, {
    activeChangeOrderId: docRef.id,
    activeChangeOrderStatus: 'draft',
    hasChangeOrders: true,
    changeOrderCount: (order.changeOrderCount || 0) + 1,
    updatedAt: serverTimestamp(),
  });

  return {
    id: docRef.id,
    orderId: order.id,
    orderNumber: order.orderNumber,
    changeOrderNumber,
    status: 'draft',
    reason: formData.reason,
    previousValues,
    newValues,
    differences,
    cumulativeFromOriginal,
    previousCustomer,
    previousBuilding,
    newCustomer,
    newBuilding,
    customerChanges,
    buildingChanges,
    files: uploadedFiles,
    createdBy: userId,
    createdAt: Timestamp.now(),
    updatedAt: Timestamp.now(),
  } as ChangeOrder;
}

// Update an existing change order (only if still in draft)
export async function updateChangeOrder(
  changeOrderId: string,
  formData: Partial<ChangeOrderFormData>,
  order: Order
): Promise<void> {
  const changeOrderRef = doc(db, CHANGE_ORDERS_COLLECTION, changeOrderId);
  const changeOrderSnap = await getDoc(changeOrderRef);

  if (!changeOrderSnap.exists()) {
    throw new Error('Change order not found');
  }

  const existingChangeOrder = changeOrderSnap.data() as ChangeOrder;

  if (existingChangeOrder.status !== 'draft') {
    throw new Error('Can only update draft change orders');
  }

  const updates: Record<string, unknown> = {
    updatedAt: serverTimestamp(),
  };

  if (formData.reason !== undefined) {
    updates.reason = formData.reason;
  }

  if (formData.newValues) {
    const newValues: PricingSnapshot = {
      subtotalBeforeTax: parseFloat(formData.newValues.subtotalBeforeTax) || 0,
      extraMoneyFluff: parseFloat(formData.newValues.extraMoneyFluff) || 0,
      deposit: parseFloat(formData.newValues.deposit) || 0,
      total: 0,
    };
    newValues.total = calculateTotal(newValues.subtotalBeforeTax, newValues.extraMoneyFluff);

    updates.newValues = newValues;
    updates.differences = calculateDifferences(existingChangeOrder.previousValues, newValues);

    // Recalculate cumulative from original
    const originalPricing = order.originalPricing || order.pricing;
    updates.cumulativeFromOriginal = calculateCumulativeFromOriginal(originalPricing, newValues);
  }

  // Handle customer changes
  if (formData.editCustomer !== undefined) {
    if (formData.editCustomer && formData.customer) {
      updates.previousCustomer = existingChangeOrder.previousCustomer || { ...order.customer };
      updates.newCustomer = formData.customer;
      updates.customerChanges = computeCustomerChanges(order.customer, formData.customer);
    } else if (!formData.editCustomer) {
      // Clear customer changes if no longer editing
      updates.newCustomer = null;
      updates.customerChanges = [];
    }
  }

  // Handle building changes
  if (formData.editBuilding !== undefined) {
    if (formData.editBuilding && formData.building) {
      updates.previousBuilding = existingChangeOrder.previousBuilding || { ...order.building };
      updates.newBuilding = formData.building;
      updates.buildingChanges = computeBuildingChanges(order.building, formData.building);
    } else if (!formData.editBuilding) {
      // Clear building changes if no longer editing
      updates.newBuilding = null;
      updates.buildingChanges = [];
    }
  } else if (formData.buildingChanges !== undefined) {
    // Legacy support for direct buildingChanges update
    updates.buildingChanges = formData.buildingChanges;
  }

  // Handle file uploads - upload new files and merge with existing
  if (formData.pendingFiles) {
    const newUploadedFiles = await uploadChangeOrderFiles(
      formData.pendingFiles,
      existingChangeOrder.changeOrderNumber
    );

    // Merge new files with existing files
    const existingFiles = existingChangeOrder.files || {
      orderFormPdf: undefined,
      renderings: [],
      extraFiles: [],
      installerFiles: [],
    };

    const mergedFiles: ChangeOrderFiles = {
      // If new PDF uploaded, use it; otherwise keep existing
      orderFormPdf: newUploadedFiles.orderFormPdf || existingFiles.orderFormPdf,
      // Append new files to existing arrays
      renderings: [...existingFiles.renderings, ...newUploadedFiles.renderings],
      extraFiles: [...existingFiles.extraFiles, ...newUploadedFiles.extraFiles],
      installerFiles: [...existingFiles.installerFiles, ...newUploadedFiles.installerFiles],
    };

    updates.files = mergedFiles;
  }

  // Remove any undefined values before saving to Firestore
  const cleanedUpdates = removeUndefinedValues(updates);
  await updateDoc(changeOrderRef, cleanedUpdates);
}

// Get a single change order
export async function getChangeOrder(changeOrderId: string): Promise<ChangeOrder | null> {
  const docRef = doc(db, CHANGE_ORDERS_COLLECTION, changeOrderId);
  const docSnap = await getDoc(docRef);

  if (!docSnap.exists()) {
    return null;
  }

  return {
    id: docSnap.id,
    ...docSnap.data(),
  } as ChangeOrder;
}

// Get all change orders for an order
export async function getChangeOrdersForOrder(orderId: string): Promise<ChangeOrder[]> {
  const q = query(
    collection(db, CHANGE_ORDERS_COLLECTION),
    where('orderId', '==', orderId),
    orderBy('createdAt', 'desc')
  );
  const querySnapshot = await getDocs(q);

  return querySnapshot.docs.map((doc) => ({
    id: doc.id,
    ...doc.data(),
  })) as ChangeOrder[];
}

// Cancel a change order
// Rolls back pricing to previous values and cancels SignNow invite if pending
export async function cancelChangeOrder(
  changeOrderId: string,
  reason: string
): Promise<void> {
  const changeOrderRef = doc(db, CHANGE_ORDERS_COLLECTION, changeOrderId);
  const changeOrderSnap = await getDoc(changeOrderRef);

  if (!changeOrderSnap.exists()) {
    throw new Error('Change order not found');
  }

  const changeOrder = changeOrderSnap.data() as ChangeOrder;

  if (changeOrder.status === 'signed') {
    throw new Error('Cannot cancel a signed change order');
  }

  // Cancel SignNow invite if the CO was pending signature
  if (changeOrder.status === 'pending_signature' && changeOrder.esignDocumentId) {
    try {
      const response = await fetch(
        `${import.meta.env.VITE_FUNCTIONS_URL || ''}/cancelSignature`,
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ orderId: changeOrder.orderId }),
        }
      );
      const result = await response.json();
      if (!result.success) {
        console.warn('Failed to cancel SignNow invite:', result.error);
      }
    } catch (err) {
      console.warn('Error cancelling SignNow invite:', err);
    }
  }

  // Mark the change order as cancelled
  await updateDoc(changeOrderRef, {
    status: 'cancelled',
    cancelledAt: serverTimestamp(),
    cancelledReason: reason,
    updatedAt: serverTimestamp(),
  });

  // Rollback parent order pricing to previous values and clear active CO
  const orderRef = doc(db, ORDERS_COLLECTION, changeOrder.orderId);
  const orderSnap = await getDoc(orderRef);
  const orderData = orderSnap.exists() ? orderSnap.data() : null;

  const orderUpdate: Record<string, unknown> = {
    activeChangeOrderId: null,
    activeChangeOrderStatus: null,
    updatedAt: serverTimestamp(),
  };

  // Restore pricing if it was changed by sendChangeOrderForSignature
  if (changeOrder.status === 'pending_signature' && changeOrder.previousValues) {
    orderUpdate.pricing = {
      subtotalBeforeTax: changeOrder.previousValues.subtotalBeforeTax,
      extraMoneyFluff: changeOrder.previousValues.extraMoneyFluff,
      deposit: changeOrder.previousValues.deposit,
    };
    // Restore customer/building if they were changed
    if (changeOrder.previousCustomer) {
      orderUpdate.customer = changeOrder.previousCustomer;
    }
    if (changeOrder.previousBuilding) {
      orderUpdate.building = changeOrder.previousBuilding;
    }
    // Restore status to what it was before the CO reset it to draft
    // If order was ready_for_manufacturer or signed before CO, restore that
    if (orderData?.status === 'draft' || orderData?.status === 'sent_for_signature') {
      // The CO flow resets to draft then sends — if cancelled, go back to previous state
      // We can't always know the exact previous status, but signed orders should go back to signed
      if (orderData?.signedAt) {
        const isPaid = orderData?.payment?.status === 'paid' || orderData?.payment?.status === 'manually_approved';
        orderUpdate.status = isPaid ? 'ready_for_manufacturer' : 'signed';
      }
    }
  }

  await updateDoc(orderRef, orderUpdate);

  // Recalculate ledger summary to reflect restored pricing
  try {
    const { recalculateLedgerSummary } = await import('./paymentService');
    await recalculateLedgerSummary(changeOrder.orderId);
  } catch (err) {
    console.warn('Failed to recalculate ledger summary after CO cancellation:', err);
  }
}

// Delete a change order (only if draft and no signature sent)
export async function deleteChangeOrder(changeOrderId: string): Promise<void> {
  const changeOrder = await getChangeOrder(changeOrderId);
  if (!changeOrder) {
    throw new Error('Change order not found');
  }

  if (changeOrder.status !== 'draft') {
    throw new Error('Can only delete draft change orders');
  }

  // Delete the change order
  const changeOrderRef = doc(db, CHANGE_ORDERS_COLLECTION, changeOrderId);
  await updateDoc(changeOrderRef, {
    status: 'cancelled',
    cancelledAt: serverTimestamp(),
    cancelledReason: 'Deleted by user',
    updatedAt: serverTimestamp(),
  });

  // Clear the active change order on the parent order if this was it
  const orderRef = doc(db, ORDERS_COLLECTION, changeOrder.orderId);
  const orderSnap = await getDoc(orderRef);
  if (orderSnap.exists()) {
    const order = orderSnap.data() as Order;
    if (order.activeChangeOrderId === changeOrderId) {
      await updateDoc(orderRef, {
        activeChangeOrderId: null,
        activeChangeOrderStatus: null,
        updatedAt: serverTimestamp(),
      });
    }
  }
}

