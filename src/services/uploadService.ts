import { ref, uploadBytes, getDownloadURL } from 'firebase/storage';
import { collection, addDoc, serverTimestamp, doc } from 'firebase/firestore';
import { storage, db } from '../config/firebase';

export interface SignerInfo {
  email: string;
  name: string;
}

export interface UploadResult {
  documentId: string;
  storageUrl: string;
  status: 'pending' | 'processing' | 'sent' | 'signed' | 'error';
  orderNumber: string;
}

// Generate sequential order number with uniqueness check
// Uses same counter as orderService.ts to prevent duplicates
async function generateOrderNumber(): Promise<string> {
  const { runTransaction, query, where, getDocs, limit, collection: firestoreCollection } = await import('firebase/firestore');
  const counterRef = doc(db, 'counters', 'order_number');

  let orderNumber = '';
  let attempts = 0;
  const maxAttempts = 10;

  while (attempts < maxAttempts) {
    attempts++;

    // Get next number atomically using transaction
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
    const ordersRef = firestoreCollection(db, 'orders');
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

export async function uploadDocument(
  file: File,
  signerInfo: SignerInfo,
  installer: string
): Promise<UploadResult> {
  const timestamp = Date.now();
  const fileName = `documents/${timestamp}_${file.name}`;
  const storageRef = ref(storage, fileName);

  // Generate order number
  const orderNumber = await generateOrderNumber();

  // Upload to Firebase Storage
  const snapshot = await uploadBytes(storageRef, file);
  const downloadUrl = await getDownloadURL(snapshot.ref);

  // Create Firestore record to trigger Cloud Function
  const docRef = await addDoc(collection(db, 'esign_documents'), {
    orderNumber,
    fileName: file.name,
    storagePath: fileName,
    downloadUrl,
    signer: signerInfo,
    installer,
    status: 'pending',
    createdAt: serverTimestamp(),
  });

  return {
    documentId: docRef.id,
    storageUrl: downloadUrl,
    status: 'pending',
    orderNumber,
  };
}
