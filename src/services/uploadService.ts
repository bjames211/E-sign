import { ref, uploadBytes, getDownloadURL } from 'firebase/storage';
import { collection, addDoc, serverTimestamp } from 'firebase/firestore';
import { storage, db } from '../config/firebase';

export interface SignerInfo {
  email: string;
  name: string;
}

export interface UploadResult {
  documentId: string;
  storageUrl: string;
  status: 'pending' | 'processing' | 'sent' | 'signed' | 'error';
}

export async function uploadDocument(
  file: File,
  signerInfo: SignerInfo,
  installer: string
): Promise<UploadResult> {
  const timestamp = Date.now();
  const fileName = `documents/${timestamp}_${file.name}`;
  const storageRef = ref(storage, fileName);

  // Upload to Firebase Storage
  const snapshot = await uploadBytes(storageRef, file);
  const downloadUrl = await getDownloadURL(snapshot.ref);

  // Create Firestore record to trigger Cloud Function
  const docRef = await addDoc(collection(db, 'esign_documents'), {
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
  };
}
