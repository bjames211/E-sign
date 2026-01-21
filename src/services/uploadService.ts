import { ref, uploadBytes, getDownloadURL } from 'firebase/storage';
import { collection, addDoc, serverTimestamp, doc, getDoc, setDoc } from 'firebase/firestore';
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

// Generate sequential order number
async function generateOrderNumber(): Promise<string> {
  const counterRef = doc(db, 'counters', 'orders');
  const counterSnap = await getDoc(counterRef);

  let nextNumber = 1;
  if (counterSnap.exists()) {
    nextNumber = (counterSnap.data().current || 0) + 1;
  }

  // Update counter
  await setDoc(counterRef, { current: nextNumber });

  // Format: ORD-00001
  return `ORD-${String(nextNumber).padStart(5, '0')}`;
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
