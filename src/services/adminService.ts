import {
  doc,
  getDoc,
  setDoc,
  collection,
  getDocs,
} from 'firebase/firestore';
import { db } from '../config/firebase';
import { AdminOptionType, ALL_ADMIN_OPTION_TYPES } from '../types/admin';

const ADMIN_OPTIONS_COLLECTION = 'admin_options';

// Get options for a specific type
export async function getAdminOptions(type: AdminOptionType): Promise<string[]> {
  const docRef = doc(db, ADMIN_OPTIONS_COLLECTION, type);
  const docSnap = await getDoc(docRef);

  if (!docSnap.exists()) {
    return [];
  }

  return docSnap.data().values || [];
}

// Get all admin options
export async function getAllAdminOptions(): Promise<Record<AdminOptionType, string[]>> {
  const result: Partial<Record<AdminOptionType, string[]>> = {};

  const querySnapshot = await getDocs(collection(db, ADMIN_OPTIONS_COLLECTION));
  querySnapshot.forEach((doc) => {
    const type = doc.id as AdminOptionType;
    if (ALL_ADMIN_OPTION_TYPES.includes(type)) {
      result[type] = doc.data().values || [];
    }
  });

  // Ensure all types have at least an empty array
  for (const type of ALL_ADMIN_OPTION_TYPES) {
    if (!result[type]) {
      result[type] = [];
    }
  }

  return result as Record<AdminOptionType, string[]>;
}

// Set options for a specific type (replaces all values)
export async function setAdminOptions(type: AdminOptionType, values: string[]): Promise<void> {
  const docRef = doc(db, ADMIN_OPTIONS_COLLECTION, type);
  await setDoc(docRef, {
    type,
    values,
  });
}

// Add a single option to a type
export async function addAdminOption(type: AdminOptionType, value: string): Promise<void> {
  const current = await getAdminOptions(type);
  if (!current.includes(value)) {
    await setAdminOptions(type, [...current, value]);
  }
}

// Remove a single option from a type
export async function removeAdminOption(type: AdminOptionType, value: string): Promise<void> {
  const current = await getAdminOptions(type);
  await setAdminOptions(type, current.filter((v) => v !== value));
}

// Update an option (rename)
export async function updateAdminOption(
  type: AdminOptionType,
  oldValue: string,
  newValue: string
): Promise<void> {
  const current = await getAdminOptions(type);
  const index = current.indexOf(oldValue);
  if (index !== -1) {
    current[index] = newValue;
    await setAdminOptions(type, current);
  }
}

// Reorder options
export async function reorderAdminOptions(
  type: AdminOptionType,
  fromIndex: number,
  toIndex: number
): Promise<void> {
  const current = await getAdminOptions(type);
  const [removed] = current.splice(fromIndex, 1);
  current.splice(toIndex, 0, removed);
  await setAdminOptions(type, current);
}

// Seed initial admin options (call once during setup)
export async function seedAdminOptions(): Promise<void> {
  const defaultOptions: Record<AdminOptionType, string[]> = {
    manufacturers: [
      'Eagle Carports',
      'American Carports',
      'American West Coast',
      'Viking Steel Structures',
      'Coast to Coast Carports',
    ],
    building_types: [
      'Carport',
      'Garage',
      'Barn',
      'Workshop',
      'RV Cover',
      'Commercial',
      'Agricultural',
    ],
    overall_widths: [
      '12\'',
      '18\'',
      '20\'',
      '22\'',
      '24\'',
      '26\'',
      '28\'',
      '30\'',
      '40\'',
      '50\'',
      '60\'',
    ],
    building_lengths: [
      '21\'',
      '26\'',
      '31\'',
      '36\'',
      '41\'',
      '51\'',
      '61\'',
      '81\'',
      '101\'',
    ],
    base_rail_lengths: [
      '21\'',
      '26\'',
      '31\'',
      '36\'',
      '41\'',
      '51\'',
      '61\'',
    ],
    building_heights: [
      '6\'',
      '7\'',
      '8\'',
      '9\'',
      '10\'',
      '11\'',
      '12\'',
      '14\'',
      '16\'',
    ],
    foundation_types: [
      'Concrete',
      'Asphalt',
      'Gravel',
      'Dirt',
      'Mobile Home Anchors',
    ],
    permitting_structures: [
      'Standard',
      'Engineer Certified',
      'Permit Required',
      'No Permit Needed',
    ],
    drawing_types: [
      'Standard Drawing',
      'Custom Drawing',
      'Engineer Stamped',
      'As-Built',
    ],
    sales_persons: [
      'John Smith',
      'Jane Doe',
      'Bob Johnson',
    ],
    states: [
      'AL', 'AK', 'AZ', 'AR', 'CA', 'CO', 'CT', 'DE', 'FL', 'GA',
      'HI', 'ID', 'IL', 'IN', 'IA', 'KS', 'KY', 'LA', 'ME', 'MD',
      'MA', 'MI', 'MN', 'MS', 'MO', 'MT', 'NE', 'NV', 'NH', 'NJ',
      'NM', 'NY', 'NC', 'ND', 'OH', 'OK', 'OR', 'PA', 'RI', 'SC',
      'SD', 'TN', 'TX', 'UT', 'VT', 'VA', 'WA', 'WV', 'WI', 'WY',
    ],
  };

  for (const [type, values] of Object.entries(defaultOptions)) {
    await setAdminOptions(type as AdminOptionType, values);
  }
}
