import { Timestamp } from 'firebase/firestore';
import { PaymentSummary, OrderLedgerSummary } from './payment';

export type OrderStatus = 'draft' | 'pending_payment' | 'sent_for_signature' | 'signed' | 'ready_for_manufacturer';

export type PaymentType =
  | 'stripe_already_paid'
  | 'stripe_pay_now'
  | 'stripe_pay_later'
  | 'check'
  | 'wire'
  | 'credit_on_file'
  | 'other';

// Payment status tracks whether payment has been received/verified
export type PaymentStatus = 'pending' | 'paid' | 'manually_approved' | 'failed';

// Manual payment types that require manager approval
export const MANUAL_PAYMENT_TYPES: PaymentType[] = ['check', 'wire', 'credit_on_file', 'other'];

// Helper to check if payment type requires manual approval
export const requiresManualPaymentApproval = (type: PaymentType): boolean =>
  MANUAL_PAYMENT_TYPES.includes(type);

export interface CustomerInfo {
  firstName: string;
  lastName: string;
  deliveryAddress: string;
  state: string;
  zip: string;
  phone: string;
  email: string;
}

export interface BuildingInfo {
  manufacturer: string;
  buildingType: string;
  overallWidth: string;
  buildingLength: string;
  baseRailLength: string;
  buildingHeight: string;
  lullLiftRequired: boolean;
  foundationType: string;
  permittingStructure: string;
  drawingType: string;
  customerLandIsReady: boolean;
}

export interface PricingInfo {
  subtotalBeforeTax: number;
  extraMoneyFluff: number;
  deposit: number;
}

export interface StripeVerification {
  verified: boolean;
  verifiedAt?: Timestamp;
  paymentAmount?: number;        // Amount from Stripe in cents
  paymentAmountDollars?: number; // Amount converted to dollars
  matchesDeposit: boolean;       // Does Stripe amount match our deposit?
  amountDifference?: number;     // Difference if mismatch
  isUnique: boolean;             // Is this payment ID unique (not used elsewhere)?
  duplicateOrderId?: string;     // If not unique, which order uses it?
  stripeStatus?: string;         // Payment status from Stripe (succeeded, pending, etc.)
  errorMessage?: string;         // Error if verification failed
}

// Proof file for manual payment approvals (check, wire, etc.)
export interface PaymentProofFile {
  name: string;
  storagePath: string;
  downloadUrl: string;
  size: number;
  type: string;
  uploadedAt: Timestamp;
}

export interface PaymentInfo {
  type: PaymentType;
  status: PaymentStatus;
  stripePaymentId?: string;
  stripeCustomerId?: string;  // Stripe customer ID for saved cards
  stripePaymentLinkId?: string;
  stripePaymentLinkUrl?: string;
  stripeVerification?: StripeVerification;
  manualApproval?: {
    approved: boolean;
    approvedBy?: string;
    approvedAt?: Timestamp;
    notes?: string;
    proofFile?: PaymentProofFile;  // Required proof image (check photo, wire confirmation, etc.)
  };
  notes?: string;
}

export interface OrderFile {
  name: string;
  storagePath: string;
  downloadUrl: string;
  size: number;
  type: string;
  uploadedAt: Timestamp;
}

export interface OrderFiles {
  orderFormPdf?: OrderFile;        // PDF to send to customer for e-sign
  renderings: OrderFile[];          // 3D renderings
  extraFiles: OrderFile[];          // Additional files
  installerFiles: OrderFile[];      // Files for installer
}

export interface OrderValidation {
  validatedAt?: Timestamp;
  pdfExtractedData?: {
    customerName: string | null;
    email: string | null;
    subtotal: number | null;
    deposit: number | null;
    depositPercent: number | null;
  } | null;
  warnings: string[];
  errors: string[];
  depositCheck: {
    expectedPercent: number;
    actualPercent: number;
    isDiscrepancy: boolean;
  };
  managerApprovalRequired: boolean;
  managerApprovalGiven: boolean;
  managerApprovedAt?: Timestamp | null;
}

// Expected deposit percentages by manufacturer
export const DEPOSIT_PERCENTAGES: Record<string, number> = {
  'Eagle Carports': 19,
  'American Carports': 20,
  'Coast to Coast Carports': 20,
};

// Helper to check deposit discrepancy
export const checkDepositDiscrepancy = (
  manufacturer: string,
  subtotal: number,
  deposit: number
): { hasDiscrepancy: boolean; expectedPercent: number; actualPercent: number; expectedDeposit: number } => {
  const expectedPercent = DEPOSIT_PERCENTAGES[manufacturer] || 20;
  const actualPercent = subtotal > 0 ? (deposit / subtotal) * 100 : 0;
  const expectedDeposit = (subtotal * expectedPercent) / 100;
  const hasDiscrepancy = Math.abs(actualPercent - expectedPercent) > 0.5;
  return { hasDiscrepancy, expectedPercent, actualPercent, expectedDeposit };
};

export interface DepositDiscrepancy {
  hasDiscrepancy: boolean;
  expectedPercent: number;
  actualPercent: number;
  expectedDeposit: number;
  actualDeposit: number;
}

export interface Order {
  id?: string;
  orderNumber: string;
  status: OrderStatus;
  customer: CustomerInfo;
  building: BuildingInfo;
  pricing: PricingInfo;
  originalPricing?: PricingInfo;  // Locked original values for audit trail
  payment: PaymentInfo;
  files: OrderFiles;
  salesPerson: string;
  orderFormName: string;
  paymentNotes: string;
  referredBy: string;
  specialNotes: string;
  esignDocumentId?: string;
  quoteId?: string;
  validation?: OrderValidation;
  needsManagerApproval?: boolean;
  needsPaymentApproval?: boolean;  // For manual payment types
  depositDiscrepancy?: DepositDiscrepancy;  // Flags if deposit doesn't match expected %
  paymentSummary?: PaymentSummary;  // Denormalized payment summary for quick access (legacy)
  ledgerSummary?: OrderLedgerSummary;  // Payment ledger summary - single source of truth
  needsAudit?: boolean;  // True if deposit discrepancy detected at order creation
  isTestMode?: boolean;  // Test mode - skips PDF validation and SignNow
  testPaymentAmount?: number;  // Test payment amount entered by user
  // Change order tracking
  changeOrderCount?: number;  // Total number of change orders created
  activeChangeOrderId?: string;  // Currently active change order (if any)
  activeChangeOrderStatus?: 'draft' | 'pending_signature';  // Status of active change order
  hasChangeOrders?: boolean;  // Quick flag to check if any change orders exist
  totalDepositDifference?: number;  // Cumulative deposit difference from original
  additionalDepositDue?: number;  // Amount owed from change orders (positive = customer owes)
  refundDue?: number;  // Amount we owe customer from change orders (positive = we owe)
  sentForSignatureAt?: Timestamp;
  signedAt?: Timestamp;
  paidAt?: Timestamp;
  readyForManufacturerAt?: Timestamp;
  createdAt: Timestamp;
  updatedAt: Timestamp;
  createdBy: string;
}

export interface Quote {
  id?: string;
  quoteNumber: string;
  customerName: string;
  customer: CustomerInfo;
  building: BuildingInfo;
  pricing: PricingInfo;
  createdAt: Timestamp;
}

// For file uploads in form (before upload completes)
export interface PendingFile {
  file: File;
  preview?: string;
}

export interface OrderFormFiles {
  orderFormPdf: PendingFile | null;
  renderings: PendingFile[];
  extraFiles: PendingFile[];
  installerFiles: PendingFile[];
}

// Form state type (for controlled inputs before saving)
export interface OrderFormData {
  customer: CustomerInfo;
  building: BuildingInfo;
  pricing: {
    subtotalBeforeTax: string;
    extraMoneyFluff: string;
    deposit: string;
  };
  payment: {
    type: PaymentType;
    stripePaymentId: string;
    notes: string;
    status?: PaymentStatus;
    stripeTestMode?: boolean;
    testAmount?: string;
  };
  files: OrderFormFiles;
  salesPerson: string;
  orderFormName: string;
  paymentNotes: string;
  referredBy: string;
  specialNotes: string;
  quoteId?: string;
}

export const initialCustomerInfo: CustomerInfo = {
  firstName: '',
  lastName: '',
  deliveryAddress: '',
  state: '',
  zip: '',
  phone: '',
  email: '',
};

export const initialBuildingInfo: BuildingInfo = {
  manufacturer: '',
  buildingType: '',
  overallWidth: '',
  buildingLength: '',
  baseRailLength: '',
  buildingHeight: '',
  lullLiftRequired: false,
  foundationType: '',
  permittingStructure: '',
  drawingType: '',
  customerLandIsReady: false,
};

export const initialOrderFormFiles: OrderFormFiles = {
  orderFormPdf: null,
  renderings: [],
  extraFiles: [],
  installerFiles: [],
};

export const initialOrderFormData: OrderFormData = {
  customer: initialCustomerInfo,
  building: initialBuildingInfo,
  pricing: {
    subtotalBeforeTax: '',
    extraMoneyFluff: '',
    deposit: '',
  },
  payment: {
    type: 'stripe_pay_now',
    stripePaymentId: '',
    notes: '',
  },
  files: initialOrderFormFiles,
  salesPerson: '',
  orderFormName: '',
  paymentNotes: '',
  referredBy: '',
  specialNotes: '',
};
