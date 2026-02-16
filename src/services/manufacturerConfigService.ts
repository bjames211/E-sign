import {
  collection,
  doc,
  getDocs,
  setDoc,
  updateDoc,
  deleteDoc,
  query,
  where,
  orderBy,
  onSnapshot,
  serverTimestamp,
} from 'firebase/firestore';
import { db } from '../config/firebase';
import { ManufacturerConfig } from '../types/admin';

const COLLECTION = 'manufacturer_config';

function toDocId(name: string): string {
  return name.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/(^-|-$)/g, '');
}

export async function getManufacturerConfigs(): Promise<ManufacturerConfig[]> {
  const q = query(collection(db, COLLECTION), orderBy('name', 'asc'));
  const snapshot = await getDocs(q);
  return snapshot.docs.map((d) => ({ id: d.id, ...d.data() } as ManufacturerConfig));
}

export async function getActiveManufacturerConfigs(): Promise<ManufacturerConfig[]> {
  const q = query(
    collection(db, COLLECTION),
    where('active', '==', true),
    orderBy('name', 'asc')
  );
  const snapshot = await getDocs(q);
  return snapshot.docs.map((d) => ({ id: d.id, ...d.data() } as ManufacturerConfig));
}

export async function saveManufacturerConfig(config: {
  name: string;
  signNowTemplateId: string;
  depositPercent?: number | null;
  depositTiers?: { upTo: number | null; percent: number }[];
  active: boolean;
}): Promise<void> {
  const docId = toDocId(config.name);
  await setDoc(doc(db, COLLECTION, docId), {
    ...config,
    createdAt: serverTimestamp(),
    updatedAt: serverTimestamp(),
  });
}

export async function updateManufacturerConfig(
  id: string,
  updates: Partial<Omit<ManufacturerConfig, 'id' | 'createdAt'>>
): Promise<void> {
  await updateDoc(doc(db, COLLECTION, id), {
    ...updates,
    updatedAt: serverTimestamp(),
  });
}

export async function deleteManufacturerConfig(id: string): Promise<void> {
  await deleteDoc(doc(db, COLLECTION, id));
}

export function subscribeToManufacturerConfigs(
  callback: (configs: ManufacturerConfig[]) => void
): () => void {
  const q = query(collection(db, COLLECTION), orderBy('name', 'asc'));
  return onSnapshot(q, (snapshot) => {
    const configs = snapshot.docs.map((d) => ({ id: d.id, ...d.data() } as ManufacturerConfig));
    callback(configs);
  });
}
