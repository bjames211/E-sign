import {
  collection,
  doc,
  getDocs,
  getDoc,
  setDoc,
  updateDoc,
  deleteDoc,
  addDoc,
  query,
  where,
  orderBy,
  onSnapshot,
  serverTimestamp,
} from 'firebase/firestore';
import { db, auth } from '../config/firebase';
import { ManufacturerConfig } from '../types/admin';

const COLLECTION = 'manufacturer_config';
const CHANGELOG_COLLECTION = 'manufacturer_config_changelog';

function toDocId(name: string): string {
  return name.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/(^-|-$)/g, '');
}

async function logConfigChange(
  configId: string,
  configName: string,
  action: 'created' | 'updated' | 'deleted',
  changes: { field: string; oldValue: unknown; newValue: unknown }[] = [],
) {
  try {
    const user = auth.currentUser;
    await addDoc(collection(db, CHANGELOG_COLLECTION), {
      configId,
      configName,
      action,
      changes,
      userId: user?.uid || 'unknown',
      userEmail: user?.email || 'unknown',
      timestamp: serverTimestamp(),
    });
  } catch (err) {
    console.error('Failed to log manufacturer config change:', err);
  }
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
  sku?: string | null;
  signNowTemplateId: string;
  depositPercent?: number | null;
  depositTiers?: { upTo: number | null; percent: number }[];
  active: boolean;
}): Promise<void> {
  const docId = toDocId(config.name);
  // Strip undefined values — Firestore rejects them
  const data: Record<string, unknown> = {
    name: config.name,
    signNowTemplateId: config.signNowTemplateId,
    active: config.active,
    createdAt: serverTimestamp(),
    updatedAt: serverTimestamp(),
  };
  if (config.sku !== undefined) data.sku = config.sku;
  if (config.depositPercent !== undefined) data.depositPercent = config.depositPercent;
  if (config.depositTiers !== undefined) data.depositTiers = config.depositTiers;
  await setDoc(doc(db, COLLECTION, docId), data);

  await logConfigChange(docId, config.name, 'created', [
    { field: 'name', oldValue: null, newValue: config.name },
    { field: 'sku', oldValue: null, newValue: config.sku || null },
    { field: 'signNowTemplateId', oldValue: null, newValue: config.signNowTemplateId },
    { field: 'depositPercent', oldValue: null, newValue: config.depositPercent ?? null },
    { field: 'depositTiers', oldValue: null, newValue: config.depositTiers || null },
    { field: 'active', oldValue: null, newValue: config.active },
  ]);
}

export async function updateManufacturerConfig(
  id: string,
  updates: Partial<Omit<ManufacturerConfig, 'id' | 'createdAt'>>
): Promise<void> {
  const docRef = doc(db, COLLECTION, id);

  // Fetch current state for changelog diff
  const currentSnap = await getDoc(docRef);
  const currentData = currentSnap.data() as ManufacturerConfig | undefined;

  // Strip undefined values — Firestore rejects them
  const cleanUpdates: Record<string, unknown> = { updatedAt: serverTimestamp() };
  for (const [key, val] of Object.entries(updates)) {
    if (val !== undefined) cleanUpdates[key] = val;
  }
  await updateDoc(docRef, cleanUpdates);

  // Log field-level changes
  if (currentData) {
    const changes: { field: string; oldValue: unknown; newValue: unknown }[] = [];
    for (const [key, newVal] of Object.entries(updates)) {
      if (key === 'updatedAt') continue;
      const oldVal = (currentData as unknown as Record<string, unknown>)[key];
      if (JSON.stringify(oldVal) !== JSON.stringify(newVal)) {
        changes.push({ field: key, oldValue: oldVal ?? null, newValue: newVal });
      }
    }
    if (changes.length > 0) {
      await logConfigChange(id, currentData.name, 'updated', changes);
    }
  }
}

export async function deleteManufacturerConfig(id: string): Promise<void> {
  const docRef = doc(db, COLLECTION, id);

  // Fetch current state for changelog
  const currentSnap = await getDoc(docRef);
  const currentData = currentSnap.data() as ManufacturerConfig | undefined;

  await deleteDoc(docRef);

  if (currentData) {
    await logConfigChange(id, currentData.name, 'deleted', [
      { field: 'name', oldValue: currentData.name, newValue: null },
      { field: 'sku', oldValue: currentData.sku || null, newValue: null },
      { field: 'signNowTemplateId', oldValue: currentData.signNowTemplateId, newValue: null },
      { field: 'active', oldValue: currentData.active, newValue: null },
    ]);
  }
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
