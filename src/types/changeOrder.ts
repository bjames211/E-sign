import { Timestamp } from 'firebase/firestore';
import { OrderFile, PendingFile, CustomerInfo, BuildingInfo } from './order';

export type ChangeOrderStatus = 'draft' | 'pending_signature' | 'signed' | 'cancelled' | 'superseded';

// Change tracking for customer/building fields
export interface CustomerChange {
  field: keyof CustomerInfo;
  fieldLabel: string;
  oldValue: string;
  newValue: string;
}

// Files structure for change orders (same as OrderFiles)
export interface ChangeOrderFiles {
  orderFormPdf?: OrderFile | null;  // New PDF for e-sign (null for Firestore compatibility)
  renderings: OrderFile[];          // 3D renderings
  extraFiles: OrderFile[];          // Additional files
  installerFiles: OrderFile[];      // Files for installer
}

// Pending files for form state (before upload)
export interface ChangeOrderPendingFiles {
  orderFormPdf: PendingFile | null;
  renderings: PendingFile[];
  extraFiles: PendingFile[];
  installerFiles: PendingFile[];
}

export interface PricingSnapshot {
  subtotalBeforeTax: number;
  extraMoneyFluff: number;
  deposit: number;
  total: number; // subtotalBeforeTax + extraMoneyFluff
}

export interface PricingDifferences {
  subtotalDiff: number;
  extraMoneyFluffDiff: number;
  depositDiff: number;
  totalDiff: number;
}

export interface BuildingChange {
  field: string;
  fieldLabel: string; // Human readable label
  oldValue: string;
  newValue: string;
}

export interface ChangeOrder {
  id?: string;
  orderId: string;
  orderNumber: string; // Parent order number for reference
  changeOrderNumber: string; // CO-00001
  status: ChangeOrderStatus;
  reason: string; // Required notes on what changed

  // Pricing at time of change order creation
  previousValues: PricingSnapshot;

  // New pricing values
  newValues: PricingSnapshot;

  // Calculated differences
  differences: PricingDifferences;

  // Cumulative differences from original order
  cumulativeFromOriginal: PricingDifferences;

  // Original customer/building snapshots (for showing diffs)
  previousCustomer?: CustomerInfo;
  previousBuilding?: BuildingInfo;

  // New customer/building values (only if edited)
  newCustomer?: CustomerInfo;
  newBuilding?: BuildingInfo;

  // Track specific customer field changes
  customerChanges?: CustomerChange[];

  // Track specific building spec changes
  buildingChanges: BuildingChange[];

  // Original files from the order (snapshot at time of change order creation)
  previousFiles?: ChangeOrderFiles;

  // New files uploaded with the change order
  files?: ChangeOrderFiles;

  // E-sign tracking
  esignDocumentId?: string;
  sentForSignatureAt?: Timestamp;
  signedAt?: Timestamp;
  cancelledAt?: Timestamp;
  cancelledReason?: string;

  // Test mode
  isTestMode?: boolean;
  testSignedAt?: Timestamp;

  // Payment tracking for deposit differences
  paymentStatus?: 'not_required' | 'pending' | 'collected' | 'refund_pending' | 'refund_complete';
  paymentRecordId?: string;  // Link to PaymentRecord if payment is pending/collected
  depositDifferenceHandled?: boolean;  // Whether the deposit difference has been addressed

  // Audit
  createdAt: Timestamp;
  updatedAt: Timestamp;
  createdBy: string;
}

// Form data for creating/editing change orders
export interface ChangeOrderFormData {
  reason: string;
  newValues: {
    subtotalBeforeTax: string;
    extraMoneyFluff: string;
    deposit: string;
  };

  // Optional sections (toggled in full mode)
  editCustomer: boolean;
  editBuilding: boolean;

  // Customer data (only used if editCustomer = true)
  customer?: CustomerInfo;

  // Building data (only used if editBuilding = true)
  building?: BuildingInfo;

  // Track specific changes
  customerChanges: CustomerChange[];
  buildingChanges: BuildingChange[];

  pendingFiles: ChangeOrderPendingFiles;
}

export const initialChangeOrderPendingFiles: ChangeOrderPendingFiles = {
  orderFormPdf: null,
  renderings: [],
  extraFiles: [],
  installerFiles: [],
};

export const initialChangeOrderFormData: ChangeOrderFormData = {
  reason: '',
  newValues: {
    subtotalBeforeTax: '',
    extraMoneyFluff: '',
    deposit: '',
  },
  editCustomer: false,
  editBuilding: false,
  customer: undefined,
  building: undefined,
  customerChanges: [],
  buildingChanges: [],
  pendingFiles: initialChangeOrderPendingFiles,
};

// Helper to calculate pricing snapshot total
export const calculateTotal = (subtotal: number, extraMoneyFluff: number): number => {
  return subtotal + extraMoneyFluff;
};

// Helper to calculate differences between two pricing snapshots
export const calculateDifferences = (
  previous: PricingSnapshot,
  newValues: PricingSnapshot
): PricingDifferences => {
  return {
    subtotalDiff: newValues.subtotalBeforeTax - previous.subtotalBeforeTax,
    extraMoneyFluffDiff: newValues.extraMoneyFluff - previous.extraMoneyFluff,
    depositDiff: newValues.deposit - previous.deposit,
    totalDiff: newValues.total - previous.total,
  };
};

// Human-readable labels for customer fields
export const CUSTOMER_FIELD_LABELS: Record<keyof CustomerInfo, string> = {
  firstName: 'First Name',
  lastName: 'Last Name',
  deliveryAddress: 'Delivery Address',
  state: 'State',
  zip: 'Zip Code',
  phone: 'Phone',
  email: 'Email',
};

// Human-readable labels for building fields
export const BUILDING_FIELD_LABELS: Record<keyof BuildingInfo, string> = {
  manufacturer: 'Manufacturer',
  buildingType: 'Building Type',
  overallWidth: 'Overall Width',
  buildingLength: 'Building Length',
  baseRailLength: 'Base Rail Length',
  buildingHeight: 'Building Height',
  lullLiftRequired: 'Lull Lift Required',
  foundationType: 'Foundation Type',
  permittingStructure: 'Permitting Structure',
  drawingType: 'Drawing Type',
  customerLandIsReady: 'Customer Land Is Ready',
};

// Helper to compute customer field changes
export const computeCustomerChanges = (
  previous: CustomerInfo,
  current: CustomerInfo
): CustomerChange[] => {
  const changes: CustomerChange[] = [];
  const fields = Object.keys(previous) as (keyof CustomerInfo)[];

  for (const field of fields) {
    const oldVal = previous[field] || '';
    const newVal = current[field] || '';
    if (oldVal !== newVal) {
      changes.push({
        field,
        fieldLabel: CUSTOMER_FIELD_LABELS[field],
        oldValue: String(oldVal),
        newValue: String(newVal),
      });
    }
  }

  return changes;
};

// Helper to compute building field changes
export const computeBuildingChanges = (
  previous: BuildingInfo,
  current: BuildingInfo
): BuildingChange[] => {
  const changes: BuildingChange[] = [];
  const fields = Object.keys(previous) as (keyof BuildingInfo)[];

  for (const field of fields) {
    const oldVal = previous[field];
    const newVal = current[field];
    if (oldVal !== newVal) {
      changes.push({
        field,
        fieldLabel: BUILDING_FIELD_LABELS[field],
        oldValue: typeof oldVal === 'boolean' ? (oldVal ? 'Yes' : 'No') : String(oldVal || ''),
        newValue: typeof newVal === 'boolean' ? (newVal ? 'Yes' : 'No') : String(newVal || ''),
      });
    }
  }

  return changes;
};
