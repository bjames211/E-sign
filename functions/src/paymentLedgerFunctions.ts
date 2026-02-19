import * as functions from 'firebase-functions/v1';
import * as admin from 'firebase-admin';
import { createAuditEntry } from './paymentAuditFunctions';
import { isValidApprovalCode } from './config/approvalCode';
import { stripe } from './config/stripe';

// ============================================================
// PAYMENT NUMBER GENERATION
// ============================================================

/**
 * Generate next payment number (PAY-00001 format)
 * Uses a counter document in Firestore for atomic increments
 */
export async function generatePaymentNumber(db: FirebaseFirestore.Firestore): Promise<string> {
  const counterRef = db.collection('counters').doc('payment_number');

  const result = await db.runTransaction(async (transaction) => {
    const counterDoc = await transaction.get(counterRef);

    let nextNumber = 1;
    if (counterDoc.exists) {
      nextNumber = (counterDoc.data()?.current || 0) + 1;
    }

    transaction.set(counterRef, { current: nextNumber }, { merge: true });

    return nextNumber;
  });

  // Format as PAY-00001
  return `PAY-${result.toString().padStart(5, '0')}`;
}

// ============================================================
// PAYMENT LEDGER TYPES
// ============================================================

type LedgerTransactionType = 'payment' | 'refund' | 'deposit_increase' | 'deposit_decrease';
type LedgerEntryStatus = 'pending' | 'verified' | 'approved' | 'voided';
type LedgerCategory = 'initial_deposit' | 'additional_deposit' | 'refund' | 'change_order_adjustment';
type PaymentMethod = 'stripe' | 'check' | 'wire' | 'credit_on_file' | 'cash' | 'other';
type BalanceStatus = 'paid' | 'underpaid' | 'overpaid' | 'pending';

interface PaymentProofFile {
  name: string;
  storagePath: string;
  downloadUrl: string;
  size: number;
  type: string;
}

interface OrderLedgerSummary {
  depositRequired: number;
  originalDeposit: number;
  depositAdjustments: number;
  totalReceived: number;
  totalRefunded: number;
  netReceived: number;
  balance: number;
  balanceStatus: BalanceStatus;
  pendingReceived: number;
  pendingRefunds: number;
  entryCount: number;
  lastEntryAt?: FirebaseFirestore.Timestamp;
  calculatedAt: FirebaseFirestore.Timestamp;
}

interface AddLedgerEntryRequest {
  orderId?: string;  // Optional - can be looked up from orderNumber
  orderNumber: string;
  changeOrderId?: string;
  changeOrderNumber?: string;
  transactionType: LedgerTransactionType;
  amount: number;
  method: PaymentMethod;
  category: LedgerCategory;
  status?: LedgerEntryStatus;  // Optional - defaults to 'pending' unless verified
  stripePaymentId?: string;
  description: string;
  notes?: string;
  proofFile?: PaymentProofFile;
  approvalCode?: string;
  createdBy: string;
}

// ============================================================
// LEDGER SUMMARY CALCULATION
// ============================================================

/**
 * Calculate the ledger summary for an order by querying all non-voided entries
 * This is the core calculation function that ensures accurate accounting.
 */
export async function calculateOrderLedgerSummary(
  orderId: string,
  db: FirebaseFirestore.Firestore
): Promise<OrderLedgerSummary> {
  // Get the order to know current deposit (from pricing, which is always up-to-date with change orders)
  const orderSnap = await db.collection('orders').doc(orderId).get();
  const orderData = orderSnap.data();

  // Use current pricing.deposit as the authoritative deposit amount
  // This is updated by change orders automatically
  const depositRequired = orderData?.pricing?.deposit || 0;
  const originalDeposit = orderData?.originalPricing?.deposit || depositRequired;

  // Query all non-voided ledger entries for this order
  const entriesQuery = await db
    .collection('payment_ledger')
    .where('orderId', '==', orderId)
    .get();

  // Initialize accumulators
  let totalReceived = 0;
  let totalRefunded = 0;
  let depositAdjustments = depositRequired - originalDeposit; // Calculate adjustment from pricing diff
  let pendingReceived = 0;
  let pendingRefunds = 0;
  let entryCount = 0;
  let lastEntryAt: FirebaseFirestore.Timestamp | undefined;

  // Process each entry
  entriesQuery.docs.forEach((doc) => {
    const entry = doc.data();

    // Skip voided entries
    if (entry.status === 'voided') {
      return;
    }

    entryCount++;

    // Track last entry timestamp
    if (entry.createdAt) {
      if (!lastEntryAt || entry.createdAt.toMillis() > lastEntryAt.toMillis()) {
        lastEntryAt = entry.createdAt;
      }
    }

    const isConfirmed = entry.status === 'verified' || entry.status === 'approved';
    const isPending = entry.status === 'pending';

    switch (entry.transactionType) {
      case 'payment':
        if (isConfirmed) {
          totalReceived += entry.amount;
        } else if (isPending) {
          pendingReceived += entry.amount;
        }
        break;

      case 'refund':
        if (isConfirmed) {
          totalRefunded += entry.amount;
        } else if (isPending) {
          pendingRefunds += entry.amount;
        }
        break;

      // deposit_increase and deposit_decrease entries are no longer needed
      // since we calculate depositRequired directly from order.pricing.deposit
      case 'deposit_increase':
      case 'deposit_decrease':
        // These are informational only, actual deposit comes from order pricing
        break;
    }
  });

  // Calculate derived values
  const netReceived = totalReceived - totalRefunded;
  const balance = depositRequired - netReceived;

  // Determine balance status
  let balanceStatus: BalanceStatus;
  if (pendingReceived > 0 && netReceived === 0) {
    balanceStatus = 'pending';
  } else if (balance === 0) {
    balanceStatus = 'paid';
  } else if (balance > 0) {
    balanceStatus = 'underpaid';
  } else {
    balanceStatus = 'overpaid';
  }

  const summary: OrderLedgerSummary = {
    depositRequired,
    originalDeposit,
    depositAdjustments,
    totalReceived,
    totalRefunded,
    netReceived,
    balance,
    balanceStatus,
    pendingReceived,
    pendingRefunds,
    entryCount,
    calculatedAt: admin.firestore.Timestamp.now(),
  };

  // Only include lastEntryAt if it exists
  if (lastEntryAt) {
    summary.lastEntryAt = lastEntryAt;
  }

  return summary;
}

/**
 * Update the order document with the calculated ledger summary
 * Also syncs payment.status to match ledger reality (single source of truth)
 */
export async function updateOrderLedgerSummary(
  orderId: string,
  db: FirebaseFirestore.Firestore
): Promise<OrderLedgerSummary> {
  const summary = await calculateOrderLedgerSummary(orderId, db);

  // Build update data with ledger summary
  const updateData: Record<string, unknown> = {
    ledgerSummary: summary,
    updatedAt: admin.firestore.FieldValue.serverTimestamp(),
  };

  // Sync payment.status to match ledger reality
  // This eliminates the dual-source-of-truth problem
  const orderSnap = await db.collection('orders').doc(orderId).get();
  const orderData = orderSnap.data();
  const currentPaymentStatus = orderData?.payment?.status;

  if ((summary.balanceStatus === 'paid' || summary.balanceStatus === 'overpaid') && summary.entryCount > 0) {
    // Ledger shows fully paid AND has at least one confirmed entry
    // The entryCount > 0 check prevents $0 deposit orders from auto-marking as paid with no money received
    if (currentPaymentStatus !== 'paid' && currentPaymentStatus !== 'manually_approved') {
      updateData['payment.status'] = 'paid';
      if (!orderData?.paidAt) {
        updateData.paidAt = admin.firestore.FieldValue.serverTimestamp();
      }
      console.log(`Ledger sync: Order ${orderId} payment.status updated to 'paid' (was '${currentPaymentStatus}')`);
    }
  } else if (summary.balanceStatus === 'underpaid') {
    // Ledger shows underpaid — reset payment.status if it was previously paid
    if (currentPaymentStatus === 'paid' || currentPaymentStatus === 'manually_approved') {
      updateData['payment.status'] = 'pending';
      console.log(`Ledger sync: Order ${orderId} payment.status updated to 'pending' (was '${currentPaymentStatus}', balance underpaid: $${summary.balance})`);
    }
  }

  await db.collection('orders').doc(orderId).update(updateData);

  console.log(`Ledger summary updated for order ${orderId}: balance=$${summary.balance}, status=${summary.balanceStatus}`);

  return summary;
}

// ============================================================
// LEDGER ENTRY CREATION
// ============================================================

/**
 * Create a new payment ledger entry
 * Amount should ALWAYS be positive - transactionType determines direction
 */
export async function createLedgerEntry(
  data: {
    orderId: string;
    orderNumber: string;
    changeOrderId?: string;
    changeOrderNumber?: string;
    transactionType: LedgerTransactionType;
    amount: number;
    method: PaymentMethod;
    category: LedgerCategory;
    status: LedgerEntryStatus;
    stripePaymentId?: string;
    stripeVerified?: boolean;
    stripeAmount?: number;
    stripeAmountDollars?: number;
    description: string;
    notes?: string;
    proofFile?: PaymentProofFile;
    approvedBy?: string;
    createdBy: string;
    userEmail?: string;
    skipAudit?: boolean;  // For internal use when audit is handled separately
  },
  db: FirebaseFirestore.Firestore
): Promise<{ entryId: string; paymentNumber: string }> {
  // Generate payment number
  const paymentNumber = await generatePaymentNumber(db);

  // Ensure amount is positive
  const absoluteAmount = Math.abs(data.amount);

  // Calculate balance after this transaction
  // Get order's deposit requirement and current ledger state
  const orderSnap = await db.collection('orders').doc(data.orderId).get();
  const orderData = orderSnap.data();
  const depositRequired = orderData?.pricing?.deposit || 0;

  // Get all existing non-voided entries for this order
  const existingEntriesSnap = await db.collection('payment_ledger')
    .where('orderId', '==', data.orderId)
    .get();

  let currentNetReceived = 0;
  existingEntriesSnap.docs.forEach(doc => {
    const entry = doc.data();
    if (entry.status === 'voided') return;

    const isConfirmed = entry.status === 'verified' || entry.status === 'approved';
    if (!isConfirmed) return;

    if (entry.transactionType === 'payment') {
      currentNetReceived += entry.amount || 0;
    } else if (entry.transactionType === 'refund') {
      currentNetReceived -= entry.amount || 0;
    }
  });

  // Calculate new balance after this entry (only if entry will be confirmed)
  let balanceAfter = depositRequired - currentNetReceived;
  const willBeConfirmed = data.status === 'verified' || data.status === 'approved';
  if (willBeConfirmed) {
    if (data.transactionType === 'payment') {
      balanceAfter = depositRequired - (currentNetReceived + absoluteAmount);
    } else if (data.transactionType === 'refund') {
      balanceAfter = depositRequired - (currentNetReceived - absoluteAmount);
    }
  }

  const entryData: Record<string, unknown> = {
    orderId: data.orderId,
    orderNumber: data.orderNumber,
    paymentNumber,
    transactionType: data.transactionType,
    amount: absoluteAmount,
    method: data.method,
    category: data.category,
    status: data.status,
    description: data.description,
    createdBy: data.createdBy,
    createdAt: admin.firestore.FieldValue.serverTimestamp(),
    // Running balance after this transaction
    balanceAfter,
    depositAtTime: depositRequired,
  };

  // Add optional fields
  if (data.changeOrderId) {
    entryData.changeOrderId = data.changeOrderId;
  }
  if (data.changeOrderNumber) {
    entryData.changeOrderNumber = data.changeOrderNumber;
  }
  if (data.stripePaymentId) {
    entryData.stripePaymentId = data.stripePaymentId;
  }
  if (data.stripeVerified !== undefined) {
    entryData.stripeVerified = data.stripeVerified;
  }
  if (data.stripeAmount !== undefined) {
    entryData.stripeAmount = data.stripeAmount;
  }
  if (data.stripeAmountDollars !== undefined) {
    entryData.stripeAmountDollars = data.stripeAmountDollars;
  }
  if (data.notes) {
    entryData.notes = data.notes;
  }
  if (data.proofFile) {
    entryData.proofFile = data.proofFile;
  }
  if (data.approvedBy) {
    entryData.approvedBy = data.approvedBy;
    entryData.approvedAt = admin.firestore.FieldValue.serverTimestamp();
  }

  // Create the entry
  const docRef = await db.collection('payment_ledger').add(entryData);

  console.log(`Ledger entry created: ${docRef.id} (${paymentNumber}) (${data.transactionType}) $${absoluteAmount} for order ${data.orderNumber}`);

  // Create audit entry for the creation (unless skipped)
  if (!data.skipAudit) {
    try {
      await createAuditEntry({
        ledgerEntryId: docRef.id,
        paymentNumber,
        orderId: data.orderId,
        orderNumber: data.orderNumber,
        action: 'created',
        newStatus: data.status,
        userId: data.createdBy,
        userEmail: data.userEmail,
        details: `${data.transactionType} of ${absoluteAmount} via ${data.method}`,
      }, db);
    } catch (auditError) {
      console.error('Failed to create audit entry:', auditError);
      // Don't fail the main operation if audit fails
    }
  }

  return { entryId: docRef.id, paymentNumber };
}

// ============================================================
// HTTP ENDPOINTS
// ============================================================

/**
 * Add a new payment ledger entry via HTTP
 */
export const addLedgerEntry = functions.https.onRequest(async (req, res) => {
  res.set('Access-Control-Allow-Origin', '*');
  res.set('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.set('Access-Control-Allow-Headers', 'Content-Type');

  if (req.method === 'OPTIONS') {
    res.status(204).send('');
    return;
  }

  if (req.method !== 'POST') {
    res.status(405).json({ error: 'Method not allowed' });
    return;
  }

  try {
    const db = admin.firestore();
    const data = req.body as AddLedgerEntryRequest;

    // Validate required fields - allow lookup by orderNumber if orderId not provided
    if (!data.orderNumber && !data.orderId) {
      res.status(400).json({ error: 'orderNumber or orderId is required' });
      return;
    }

    // If no orderId provided, look it up from orderNumber
    let orderId = data.orderId;
    if (!orderId && data.orderNumber) {
      const orderQuery = await db.collection('orders')
        .where('orderNumber', '==', data.orderNumber)
        .limit(1)
        .get();

      if (orderQuery.empty) {
        res.status(404).json({ error: `Order ${data.orderNumber} not found` });
        return;
      }

      orderId = orderQuery.docs[0].id;
    }

    // At this point orderId must be defined
    if (!orderId) {
      res.status(400).json({ error: 'Could not determine orderId' });
      return;
    }

    if (!data.amount || data.amount <= 0) {
      res.status(400).json({ error: 'amount is required and must be positive' });
      return;
    }

    if (!data.transactionType) {
      res.status(400).json({ error: 'transactionType is required' });
      return;
    }

    if (!data.method) {
      res.status(400).json({ error: 'method is required' });
      return;
    }

    if (!data.category) {
      res.status(400).json({ error: 'category is required' });
      return;
    }

    if (!data.description) {
      res.status(400).json({ error: 'description is required' });
      return;
    }

    if (!data.createdBy) {
      res.status(400).json({ error: 'createdBy is required' });
      return;
    }

    // Check if order exists
    const orderRef = db.collection('orders').doc(orderId);
    const orderSnap = await orderRef.get();

    if (!orderSnap.exists) {
      res.status(404).json({ error: 'Order not found' });
      return;
    }

    // Determine initial status and handle Stripe verification
    let status: LedgerEntryStatus = data.status || 'pending';
    let stripeVerified = false;
    let stripeAmount: number | undefined;
    let stripeAmountDollars: number | undefined;
    let approvedBy: string | undefined;

    // If status is 'approved', set approvedBy
    if (status === 'approved') {
      approvedBy = data.createdBy;
    }

    // For Stripe payments, verify the payment ID (overrides passed status if verified)
    if (data.method === 'stripe' && data.stripePaymentId) {
      try {
        if (data.stripePaymentId.startsWith('pi_')) {
          const paymentIntent = await stripe.paymentIntents.retrieve(data.stripePaymentId);
          stripeVerified = paymentIntent.status === 'succeeded';
          stripeAmount = paymentIntent.amount;
          stripeAmountDollars = paymentIntent.amount / 100;
        } else if (data.stripePaymentId.startsWith('ch_')) {
          const charge = await stripe.charges.retrieve(data.stripePaymentId);
          stripeVerified = charge.paid && charge.status === 'succeeded';
          stripeAmount = charge.amount;
          stripeAmountDollars = charge.amount / 100;
        } else if (data.stripePaymentId.startsWith('re_')) {
          const refund = await stripe.refunds.retrieve(data.stripePaymentId);
          stripeVerified = refund.status === 'succeeded';
          stripeAmount = refund.amount;
          stripeAmountDollars = refund.amount / 100;
        }

        if (stripeVerified) {
          status = 'verified';
        }
      } catch (stripeError) {
        console.error('Stripe verification failed:', stripeError);
        // Keep the passed-in status if Stripe verification fails
      }
    }

    // For manual payments with approval code, auto-approve
    const manualMethods = ['check', 'wire', 'credit_on_file', 'cash', 'other'];
    if (manualMethods.includes(data.method) && data.approvalCode) {
      if (isValidApprovalCode(data.approvalCode)) {
        status = 'approved';
        approvedBy = data.createdBy;
      }
    }

    // Create the ledger entry
    const { entryId, paymentNumber } = await createLedgerEntry({
      orderId,
      orderNumber: data.orderNumber,
      changeOrderId: data.changeOrderId,
      changeOrderNumber: data.changeOrderNumber,
      transactionType: data.transactionType,
      amount: data.amount,
      method: data.method,
      category: data.category,
      status,
      stripePaymentId: data.stripePaymentId,
      stripeVerified,
      stripeAmount,
      stripeAmountDollars,
      description: data.description,
      notes: data.notes,
      proofFile: data.proofFile,
      approvedBy,
      createdBy: data.createdBy,
    }, db);

    // Update the order's ledger summary
    const summary = await updateOrderLedgerSummary(orderId, db);

    res.status(200).json({
      success: true,
      entryId,
      paymentNumber,
      status,
      stripeVerified,
      summary,
    });
  } catch (error) {
    console.error('Error adding ledger entry:', error);
    res.status(500).json({
      error: error instanceof Error ? error.message : 'Failed to add ledger entry',
    });
  }
});

/**
 * Void a ledger entry (instead of deleting)
 */
export const voidLedgerEntry = functions.https.onRequest(async (req, res) => {
  res.set('Access-Control-Allow-Origin', '*');
  res.set('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.set('Access-Control-Allow-Headers', 'Content-Type');

  if (req.method === 'OPTIONS') {
    res.status(204).send('');
    return;
  }

  if (req.method !== 'POST') {
    res.status(405).json({ error: 'Method not allowed' });
    return;
  }

  try {
    const db = admin.firestore();
    const { entryId, voidedBy, voidReason } = req.body;

    if (!entryId) {
      res.status(400).json({ error: 'entryId is required' });
      return;
    }

    if (!voidedBy) {
      res.status(400).json({ error: 'voidedBy is required' });
      return;
    }

    if (!voidReason) {
      res.status(400).json({ error: 'voidReason is required' });
      return;
    }

    // Get the entry
    const entryRef = db.collection('payment_ledger').doc(entryId);
    const entrySnap = await entryRef.get();

    if (!entrySnap.exists) {
      res.status(404).json({ error: 'Ledger entry not found' });
      return;
    }

    const entry = entrySnap.data();

    if (entry?.status === 'voided') {
      res.status(400).json({ error: 'Entry is already voided' });
      return;
    }

    const previousStatus = entry?.status;

    // Void the entry
    await entryRef.update({
      status: 'voided',
      voidedAt: admin.firestore.FieldValue.serverTimestamp(),
      voidedBy,
      voidReason,
    });

    // Create audit entry
    try {
      await createAuditEntry({
        ledgerEntryId: entryId,
        paymentNumber: entry?.paymentNumber,
        orderId: entry?.orderId,
        orderNumber: entry?.orderNumber,
        action: 'voided',
        previousStatus,
        newStatus: 'voided',
        userId: voidedBy,
        details: voidReason,
      }, db);
    } catch (auditError) {
      console.error('Failed to create void audit entry:', auditError);
    }

    // Recalculate the order's ledger summary
    const summary = await updateOrderLedgerSummary(entry?.orderId, db);

    console.log(`Ledger entry ${entryId} (${entry?.paymentNumber}) voided by ${voidedBy}: ${voidReason}`);

    res.status(200).json({
      success: true,
      entryId,
      summary,
    });
  } catch (error) {
    console.error('Error voiding ledger entry:', error);
    res.status(500).json({
      error: error instanceof Error ? error.message : 'Failed to void ledger entry',
    });
  }
});

/**
 * Approve a pending ledger entry
 */
export const approveLedgerEntry = functions.https.onRequest(async (req, res) => {
  res.set('Access-Control-Allow-Origin', '*');
  res.set('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.set('Access-Control-Allow-Headers', 'Content-Type');

  if (req.method === 'OPTIONS') {
    res.status(204).send('');
    return;
  }

  if (req.method !== 'POST') {
    res.status(405).json({ error: 'Method not allowed' });
    return;
  }

  try {
    const db = admin.firestore();
    const { entryId, approvalCode, approvedBy, stripePaymentId, proofFile } = req.body;

    if (!entryId) {
      res.status(400).json({ error: 'entryId is required' });
      return;
    }

    if (!approvalCode) {
      res.status(400).json({ error: 'approvalCode is required' });
      return;
    }

    // Verify approval code
    if (!isValidApprovalCode(approvalCode)) {
      res.status(403).json({ error: 'Invalid approval code' });
      return;
    }

    // Get the entry
    const entryRef = db.collection('payment_ledger').doc(entryId);
    const entrySnap = await entryRef.get();

    if (!entrySnap.exists) {
      res.status(404).json({ error: 'Ledger entry not found' });
      return;
    }

    const entry = entrySnap.data();

    if (entry?.status !== 'pending') {
      res.status(400).json({ error: 'Can only approve pending entries' });
      return;
    }

    // Build update data
    const updateData: Record<string, unknown> = {
      status: 'approved',
      approvedBy: approvedBy || 'Manager',
      approvedAt: admin.firestore.FieldValue.serverTimestamp(),
    };

    // Add Stripe verification if provided
    if (stripePaymentId) {
      updateData.stripePaymentId = stripePaymentId;

      // Verify with Stripe
      try {
        if (stripePaymentId.startsWith('pi_')) {
          const paymentIntent = await stripe.paymentIntents.retrieve(stripePaymentId);
          updateData.stripeVerified = paymentIntent.status === 'succeeded';
          updateData.stripeAmount = paymentIntent.amount;
          updateData.stripeAmountDollars = paymentIntent.amount / 100;
          if (paymentIntent.status === 'succeeded') {
            updateData.status = 'verified';
          }
        } else if (stripePaymentId.startsWith('ch_')) {
          const charge = await stripe.charges.retrieve(stripePaymentId);
          updateData.stripeVerified = charge.paid && charge.status === 'succeeded';
          updateData.stripeAmount = charge.amount;
          updateData.stripeAmountDollars = charge.amount / 100;
          if (charge.paid && charge.status === 'succeeded') {
            updateData.status = 'verified';
          }
        }
      } catch (stripeError) {
        console.error('Stripe verification failed during approval:', stripeError);
      }
    }

    // Add proof file if provided
    if (proofFile) {
      updateData.proofFile = proofFile;
    }

    await entryRef.update(updateData);

    // Create audit entry
    try {
      await createAuditEntry({
        ledgerEntryId: entryId,
        paymentNumber: entry?.paymentNumber,
        orderId: entry?.orderId,
        orderNumber: entry?.orderNumber,
        action: 'approved',
        previousStatus: 'pending',
        newStatus: updateData.status as string,
        userId: approvedBy || 'Manager',
        details: stripePaymentId ? `Approved with Stripe verification: ${stripePaymentId}` : 'Manual approval',
      }, db);
    } catch (auditError) {
      console.error('Failed to create approval audit entry:', auditError);
    }

    // Recalculate ledger summary
    const summary = await updateOrderLedgerSummary(entry?.orderId, db);

    // Check if order should advance to ready_for_manufacturer (signed + fully paid)
    if (summary.balanceStatus === 'paid' || summary.balanceStatus === 'overpaid') {
      const orderRef = db.collection('orders').doc(entry?.orderId);
      const orderSnap = await orderRef.get();
      const orderData = orderSnap.data();
      if (orderData?.status === 'signed') {
        await orderRef.update({
          status: 'ready_for_manufacturer',
          readyForManufacturerAt: admin.firestore.FieldValue.serverTimestamp(),
        });
        console.log(`Order ${entry?.orderId} advanced to ready_for_manufacturer after ledger entry approval`);
      }
    }

    console.log(`Ledger entry ${entryId} (${entry?.paymentNumber}) approved by ${approvedBy || 'Manager'}`);

    res.status(200).json({
      success: true,
      entryId,
      status: updateData.status,
      summary,
    });
  } catch (error) {
    console.error('Error approving ledger entry:', error);
    res.status(500).json({
      error: error instanceof Error ? error.message : 'Failed to approve ledger entry',
    });
  }
});

/**
 * Approve a legacy payment stored in order.payment field
 * This creates a ledger entry and updates the order's payment status
 */
export const approveLegacyPayment = functions.https.onRequest(async (req, res) => {
  res.set('Access-Control-Allow-Origin', '*');
  res.set('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.set('Access-Control-Allow-Headers', 'Content-Type');

  if (req.method === 'OPTIONS') {
    res.status(204).send('');
    return;
  }

  if (req.method !== 'POST') {
    res.status(405).json({ error: 'Method not allowed' });
    return;
  }

  try {
    const db = admin.firestore();
    const { orderId, orderNumber, approvalCode, approvedBy, method, amount, proofFile } = req.body;

    if (!orderId && !orderNumber) {
      res.status(400).json({ error: 'orderId or orderNumber is required' });
      return;
    }

    if (!approvalCode) {
      res.status(400).json({ error: 'approvalCode is required' });
      return;
    }

    // Verify approval code
    if (!isValidApprovalCode(approvalCode)) {
      res.status(403).json({ error: 'Invalid approval code' });
      return;
    }

    // Find the order
    let targetOrderId = orderId;
    if (!targetOrderId && orderNumber) {
      const orderQuery = await db.collection('orders')
        .where('orderNumber', '==', orderNumber)
        .limit(1)
        .get();

      if (orderQuery.empty) {
        res.status(404).json({ error: `Order ${orderNumber} not found` });
        return;
      }
      targetOrderId = orderQuery.docs[0].id;
    }

    const orderRef = db.collection('orders').doc(targetOrderId);
    const orderSnap = await orderRef.get();

    if (!orderSnap.exists) {
      res.status(404).json({ error: 'Order not found' });
      return;
    }

    const orderData = orderSnap.data();

    // Verify the payment is pending
    if (orderData?.payment?.status !== 'pending') {
      res.status(400).json({ error: 'Payment is not pending approval' });
      return;
    }

    // Determine amount and method
    const paymentAmount = amount || orderData?.pricing?.deposit || 0;
    const paymentMethod = method || orderData?.payment?.type || 'other';

    // Map payment types to methods
    const typeToMethod: Record<string, string> = {
      'check': 'check',
      'wire': 'wire',
      'credit_on_file': 'credit_on_file',
      'other': 'other',
      'stripe_pay_now': 'stripe',
      'stripe_already_paid': 'stripe',
      'stripe_pay_later': 'stripe',
    };
    const ledgerMethod = typeToMethod[paymentMethod] || 'other';

    // Create ledger entry with approved status
    const { entryId, paymentNumber } = await createLedgerEntry({
      orderId: targetOrderId,
      orderNumber: orderData?.orderNumber || orderNumber,
      transactionType: 'payment',
      amount: paymentAmount,
      method: ledgerMethod as any,
      category: 'initial_deposit',
      status: 'approved',
      description: `Initial deposit (${paymentMethod.replace(/_/g, ' ')})`,
      createdBy: approvedBy || 'Manager',
      approvedBy: approvedBy || 'Manager',
      ...(proofFile && { proofFile }),
    }, db);

    // Update the order's payment status + check if ready for manufacturer
    const legacyUpdateData: Record<string, unknown> = {
      'payment.status': 'manually_approved',
      'payment.approvedBy': approvedBy || 'Manager',
      'payment.approvedAt': admin.firestore.FieldValue.serverTimestamp(),
      paidAt: admin.firestore.FieldValue.serverTimestamp(),
    };

    // If order is signed + now paid → advance to ready_for_manufacturer
    if (orderData?.status === 'signed') {
      legacyUpdateData.status = 'ready_for_manufacturer';
      legacyUpdateData.readyForManufacturerAt = admin.firestore.FieldValue.serverTimestamp();
      console.log(`Order ${targetOrderId} advanced to ready_for_manufacturer after legacy payment approval`);
    }

    await orderRef.update(legacyUpdateData);

    // Recalculate ledger summary
    const summary = await updateOrderLedgerSummary(targetOrderId, db);

    console.log(`Legacy payment approved for order ${orderData?.orderNumber || targetOrderId}, created ledger entry ${paymentNumber}`);

    res.status(200).json({
      success: true,
      orderId: targetOrderId,
      entryId,
      paymentNumber,
      status: 'approved',
      summary,
    });
  } catch (error) {
    console.error('Error approving legacy payment:', error);
    res.status(500).json({
      error: error instanceof Error ? error.message : 'Failed to approve legacy payment',
    });
  }
});

/**
 * Get ledger entries for an order
 */
export const getLedgerEntries = functions.https.onRequest(async (req, res) => {
  res.set('Access-Control-Allow-Origin', '*');
  res.set('Access-Control-Allow-Methods', 'GET, OPTIONS');
  res.set('Access-Control-Allow-Headers', 'Content-Type');

  if (req.method === 'OPTIONS') {
    res.status(204).send('');
    return;
  }

  if (req.method !== 'GET') {
    res.status(405).json({ error: 'Method not allowed' });
    return;
  }

  try {
    const db = admin.firestore();
    let orderId = req.query.orderId as string;
    const orderNumber = req.query.orderNumber as string;
    const includeVoided = req.query.includeVoided === 'true';

    // Allow querying by orderNumber as alternative to orderId
    if (!orderId && orderNumber) {
      const orderQuery = await db.collection('orders')
        .where('orderNumber', '==', orderNumber)
        .limit(1)
        .get();

      if (!orderQuery.empty) {
        orderId = orderQuery.docs[0].id;
      }
    }

    if (!orderId) {
      res.status(400).json({ error: 'orderId or orderNumber query parameter is required' });
      return;
    }

    let query = db
      .collection('payment_ledger')
      .where('orderId', '==', orderId)
      .orderBy('createdAt', 'desc');

    const entriesQuery = await query.get();

    const entries = entriesQuery.docs
      .filter((doc) => includeVoided || doc.data().status !== 'voided')
      .map((doc) => ({
        id: doc.id,
        ...doc.data(),
      }));

    // Get or calculate summary
    const orderSnap = await db.collection('orders').doc(orderId).get();
    let summary = orderSnap.data()?.ledgerSummary;

    // If no summary exists, calculate it
    if (!summary) {
      summary = await calculateOrderLedgerSummary(orderId, db);
    }

    res.status(200).json({
      entries,
      summary,
    });
  } catch (error) {
    console.error('Error getting ledger entries:', error);
    res.status(500).json({
      error: error instanceof Error ? error.message : 'Failed to get ledger entries',
    });
  }
});

/**
 * Get all pending ledger entries across all orders
 */
export const getPendingLedgerEntries = functions.https.onRequest(async (req, res) => {
  res.set('Access-Control-Allow-Origin', '*');
  res.set('Access-Control-Allow-Methods', 'GET, OPTIONS');
  res.set('Access-Control-Allow-Headers', 'Content-Type');

  if (req.method === 'OPTIONS') {
    res.status(204).send('');
    return;
  }

  if (req.method !== 'GET') {
    res.status(405).json({ error: 'Method not allowed' });
    return;
  }

  try {
    const db = admin.firestore();

    const pendingQuery = await db
      .collection('payment_ledger')
      .where('status', '==', 'pending')
      .get();

    const entries = pendingQuery.docs.map((doc) => ({
      id: doc.id,
      ...doc.data(),
    }));

    res.status(200).json({ entries, count: entries.length });
  } catch (error) {
    console.error('Error getting pending ledger entries:', error);
    res.status(500).json({
      error: error instanceof Error ? error.message : 'Failed to get pending ledger entries',
    });
  }
});

/**
 * Recalculate and update ledger summary for an order
 */
export const recalculateLedgerSummary = functions.https.onRequest(async (req, res) => {
  res.set('Access-Control-Allow-Origin', '*');
  res.set('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.set('Access-Control-Allow-Headers', 'Content-Type');

  if (req.method === 'OPTIONS') {
    res.status(204).send('');
    return;
  }

  if (req.method !== 'POST') {
    res.status(405).json({ error: 'Method not allowed' });
    return;
  }

  try {
    const db = admin.firestore();
    let { orderId, orderNumber } = req.body;

    // Allow orderNumber as alternative to orderId
    if (!orderId && orderNumber) {
      const orderQuery = await db.collection('orders')
        .where('orderNumber', '==', orderNumber)
        .limit(1)
        .get();

      if (!orderQuery.empty) {
        orderId = orderQuery.docs[0].id;
      }
    }

    if (!orderId) {
      res.status(400).json({ error: 'orderId or orderNumber is required' });
      return;
    }

    const summary = await updateOrderLedgerSummary(orderId, db);

    console.log(`Ledger summary recalculated for order ${orderId}`);

    res.status(200).json({
      success: true,
      summary,
    });
  } catch (error) {
    console.error('Error recalculating ledger summary:', error);
    res.status(500).json({
      error: error instanceof Error ? error.message : 'Failed to recalculate summary',
    });
  }
});

/**
 * Audit an order - returns detailed order, pricing, and change order info
 */
export const auditOrder = functions.https.onRequest(async (req, res) => {
  res.set('Access-Control-Allow-Origin', '*');
  res.set('Access-Control-Allow-Methods', 'GET, OPTIONS');
  res.set('Access-Control-Allow-Headers', 'Content-Type');

  if (req.method === 'OPTIONS') {
    res.status(204).send('');
    return;
  }

  if (req.method !== 'GET') {
    res.status(405).json({ error: 'Method not allowed' });
    return;
  }

  try {
    const db = admin.firestore();
    const orderNumber = req.query.orderNumber as string;

    if (!orderNumber) {
      res.status(400).json({ error: 'orderNumber query parameter is required' });
      return;
    }

    // Find order
    const orderQuery = await db.collection('orders')
      .where('orderNumber', '==', orderNumber)
      .limit(1)
      .get();

    if (orderQuery.empty) {
      res.status(404).json({ error: 'Order not found' });
      return;
    }

    const orderDoc = orderQuery.docs[0];
    const order = orderDoc.data();

    // Get change orders
    const cosSnap = await db.collection('change_orders')
      .where('orderId', '==', orderDoc.id)
      .get();

    const changeOrders = cosSnap.docs.map(doc => {
      const co = doc.data();
      return {
        id: doc.id,
        changeOrderNumber: co.changeOrderNumber,
        status: co.status,
        previousValues: {
          deposit: co.previousValues?.deposit,
          subtotalBeforeTax: co.previousValues?.subtotalBeforeTax,
          extraMoneyFluff: co.previousValues?.extraMoneyFluff,
        },
        newValues: {
          deposit: co.newValues?.deposit,
          subtotalBeforeTax: co.newValues?.subtotalBeforeTax,
          extraMoneyFluff: co.newValues?.extraMoneyFluff,
        },
        differences: co.differences,
        createdAt: co.createdAt,
      };
    });

    res.status(200).json({
      order: {
        id: orderDoc.id,
        orderNumber: order.orderNumber,
        status: order.status,
        pricing: {
          deposit: order.pricing?.deposit,
          subtotalBeforeTax: order.pricing?.subtotalBeforeTax,
          extraMoneyFluff: order.pricing?.extraMoneyFluff,
        },
        originalPricing: order.originalPricing ? {
          deposit: order.originalPricing?.deposit,
          subtotalBeforeTax: order.originalPricing?.subtotalBeforeTax,
          extraMoneyFluff: order.originalPricing?.extraMoneyFluff,
        } : null,
        ledgerSummary: order.ledgerSummary,
        hasChangeOrders: order.hasChangeOrders,
        changeOrderCount: order.changeOrderCount,
        activeChangeOrderId: order.activeChangeOrderId,
        activeChangeOrderStatus: order.activeChangeOrderStatus,
      },
      changeOrders,
    });
  } catch (error) {
    console.error('Error auditing order:', error);
    res.status(500).json({
      error: error instanceof Error ? error.message : 'Failed to audit order',
    });
  }
});

/**
 * Get ALL ledger entries across all orders with filtering and pagination
 * This powers the "All Payments" tab in the Manager dashboard
 */
export const getAllLedgerEntries = functions.https.onRequest(async (req, res) => {
  res.set('Access-Control-Allow-Origin', '*');
  res.set('Access-Control-Allow-Methods', 'GET, OPTIONS');
  res.set('Access-Control-Allow-Headers', 'Content-Type');

  if (req.method === 'OPTIONS') {
    res.status(204).send('');
    return;
  }

  if (req.method !== 'GET') {
    res.status(405).json({ error: 'Method not allowed' });
    return;
  }

  try {
    const db = admin.firestore();

    // Parse query parameters
    const status = req.query.status as string;
    const transactionType = req.query.transactionType as string;
    const startDateStr = req.query.startDate as string;
    const endDateStr = req.query.endDate as string;
    const search = req.query.search as string;
    const limitParam = parseInt(req.query.limit as string) || 50;
    const offsetParam = parseInt(req.query.offset as string) || 0;
    const includeVoided = req.query.includeVoided === 'true';

    // Build query with Firestore-level filters (much faster than fetching all + filtering in JS)
    let query: FirebaseFirestore.Query = db.collection('payment_ledger');

    // Push status filter to Firestore
    if (status && status !== 'all') {
      query = query.where('status', '==', status);
    } else if (!includeVoided) {
      query = query.where('status', 'in', ['pending', 'verified', 'approved']);
    }

    // Push date range filters to Firestore
    if (startDateStr) {
      const startDate = new Date(startDateStr);
      query = query.where('createdAt', '>=', admin.firestore.Timestamp.fromDate(startDate));
    }
    if (endDateStr) {
      const endDate = new Date(endDateStr);
      endDate.setHours(23, 59, 59, 999);
      query = query.where('createdAt', '<=', admin.firestore.Timestamp.fromDate(endDate));
    }

    // Order by createdAt (required for date range queries, good default sort)
    query = query.orderBy('createdAt', 'desc');

    const snapshot = await query.get();

    let entries = snapshot.docs.map((doc) => ({
      id: doc.id,
      ...doc.data(),
    })) as Array<Record<string, unknown>>;

    // Filter by transaction type in memory (avoids needing extra composite indexes)
    if (transactionType && transactionType !== 'all') {
      entries = entries.filter(e => e.transactionType === transactionType);
    }

    // Search filter in memory (Firestore doesn't support text search)
    if (search) {
      const searchLower = search.toLowerCase();
      entries = entries.filter(e => {
        const orderNumber = (e.orderNumber as string || '').toLowerCase();
        const stripePaymentId = (e.stripePaymentId as string || '').toLowerCase();
        const paymentNumber = (e.paymentNumber as string || '').toLowerCase();
        const description = (e.description as string || '').toLowerCase();

        return orderNumber.includes(searchLower) ||
               stripePaymentId.includes(searchLower) ||
               paymentNumber.includes(searchLower) ||
               description.includes(searchLower);
      });
    }

    // Get total count before pagination
    const total = entries.length;

    // Apply pagination
    const paginatedEntries = entries.slice(offsetParam, offsetParam + limitParam);

    // Enrich entries with customer names and order financial info
    const orderIds = [...new Set(paginatedEntries.map(e => e.orderId as string))];

    // Batch fetch orders using getAll (single round-trip instead of N parallel gets)
    const orderRefs = orderIds.map(id => db.collection('orders').doc(id));
    const orderDocs = orderRefs.length > 0 ? await db.getAll(...orderRefs) : [];

    // Build initial order map and identify orders with pending_signature change orders
    const ordersWithPendingCO: string[] = [];
    const orderDataMap: Record<string, FirebaseFirestore.DocumentData> = {};

    orderDocs.forEach(doc => {
      if (doc.exists) {
        const data = doc.data();
        orderDataMap[doc.id] = data!;
        if (data?.activeChangeOrderStatus === 'pending_signature') {
          ordersWithPendingCO.push(doc.id);
        }
      }
    });

    // Only fetch change orders for orders that actually have pending_signature status
    const liveChangeOrderMap: Record<string, { deposit: number; subtotal: number }> = {};

    if (ordersWithPendingCO.length > 0) {
      const changeOrderSnapshots = await Promise.all(
        ordersWithPendingCO.map(id =>
          db.collection('change_orders')
            .where('orderId', '==', id)
            .where('status', '==', 'pending_signature')
            .limit(1)
            .get()
        )
      );

      changeOrderSnapshots.forEach((snapshot, index) => {
        if (!snapshot.empty) {
          const coData = snapshot.docs[0].data();
          liveChangeOrderMap[ordersWithPendingCO[index]] = {
            deposit: coData.newValues?.deposit || 0,
            subtotal: coData.newValues?.subtotalBeforeTax || 0,
          };
        }
      });
    }

    const orderMap: Record<string, {
      customerName: string;
      depositRequired: number;
      balance: number;
      balanceStatus: string;
    }> = {};

    Object.entries(orderDataMap).forEach(([docId, data]) => {
      const firstName = data?.customer?.firstName || '';
      const lastName = data?.customer?.lastName || '';
      const ledgerSummary = data?.ledgerSummary;
      const netReceived = ledgerSummary?.netReceived || 0;

      const liveCO = liveChangeOrderMap[docId];
      const effectiveDeposit = liveCO
        ? liveCO.deposit
        : (ledgerSummary?.depositRequired || data?.pricing?.deposit || 0);
      const effectiveBalance = effectiveDeposit - netReceived;
      const effectiveBalanceStatus = effectiveBalance === 0 ? 'paid'
        : effectiveBalance > 0 ? 'underpaid' : 'overpaid';

      orderMap[docId] = {
        customerName: `${firstName} ${lastName}`.trim() || 'Unknown',
        depositRequired: effectiveDeposit,
        balance: effectiveBalance,
        balanceStatus: effectiveBalanceStatus,
      };
    });

    // Add customer name and order financial info to entries
    const enrichedEntries = paginatedEntries.map(entry => ({
      ...entry,
      customerName: orderMap[entry.orderId as string]?.customerName || 'Unknown',
      orderDeposit: orderMap[entry.orderId as string]?.depositRequired || 0,
      orderBalance: orderMap[entry.orderId as string]?.balance || 0,
      orderBalanceStatus: orderMap[entry.orderId as string]?.balanceStatus || 'unknown',
    }));

    res.status(200).json({
      entries: enrichedEntries,
      total,
      hasMore: offsetParam + limitParam < total,
      limit: limitParam,
      offset: offsetParam,
    });
  } catch (error) {
    console.error('Error getting all ledger entries:', error);
    res.status(500).json({
      error: error instanceof Error ? error.message : 'Failed to get ledger entries',
    });
  }
});

/**
 * Assign payment numbers to existing ledger entries that don't have one
 * Run this once for migration
 */
export const migratePaymentNumbers = functions.https.onRequest(async (req, res) => {
  res.set('Access-Control-Allow-Origin', '*');
  res.set('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.set('Access-Control-Allow-Headers', 'Content-Type');

  if (req.method === 'OPTIONS') {
    res.status(204).send('');
    return;
  }

  if (req.method !== 'POST') {
    res.status(405).json({ error: 'Method not allowed' });
    return;
  }

  try {
    const db = admin.firestore();
    const { dryRun = true } = req.body;

    // Get all ledger entries without payment numbers, ordered by createdAt
    const snapshot = await db
      .collection('payment_ledger')
      .orderBy('createdAt', 'asc')
      .get();

    let migrated = 0;
    let skipped = 0;

    for (const doc of snapshot.docs) {
      const entry = doc.data();

      if (entry.paymentNumber) {
        skipped++;
        continue;
      }

      if (!dryRun) {
        const paymentNumber = await generatePaymentNumber(db);
        await doc.ref.update({ paymentNumber });
      }

      migrated++;
    }

    res.status(200).json({
      success: true,
      dryRun,
      migrated,
      skipped,
      total: snapshot.size,
      message: dryRun
        ? `Dry run complete. Would assign numbers to ${migrated} entries, skip ${skipped}.`
        : `Migration complete. Assigned numbers to ${migrated} entries, skipped ${skipped}.`,
    });
  } catch (error) {
    console.error('Error migrating payment numbers:', error);
    res.status(500).json({
      error: error instanceof Error ? error.message : 'Failed to migrate payment numbers',
    });
  }
});

/**
 * Calculate and set balanceAfter for existing ledger entries
 * This calculates the running balance after each transaction
 */
export const migrateBalanceAfter = functions.https.onRequest(async (req, res) => {
  res.set('Access-Control-Allow-Origin', '*');
  res.set('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.set('Access-Control-Allow-Headers', 'Content-Type');

  if (req.method === 'OPTIONS') {
    res.status(204).send('');
    return;
  }

  if (req.method !== 'POST') {
    res.status(405).json({ error: 'Method not allowed' });
    return;
  }

  try {
    const db = admin.firestore();
    const { dryRun = true } = req.body;

    // Get all unique order IDs from ledger entries
    const allEntriesSnap = await db.collection('payment_ledger').get();
    const orderIds = [...new Set(allEntriesSnap.docs.map(doc => doc.data().orderId as string))];

    console.log(`Processing ${orderIds.length} orders...`);

    let totalUpdated = 0;
    let totalSkipped = 0;
    const results: Array<{ orderId: string; entries: number; updated: number }> = [];

    for (const orderId of orderIds) {
      // Get order's deposit
      const orderSnap = await db.collection('orders').doc(orderId).get();
      const orderData = orderSnap.data();
      const depositRequired = orderData?.pricing?.deposit || 0;

      // Get all entries for this order, sorted by createdAt ascending (oldest first)
      const entriesSnap = await db.collection('payment_ledger')
        .where('orderId', '==', orderId)
        .orderBy('createdAt', 'asc')
        .get();

      let runningNetReceived = 0;
      let updated = 0;

      for (const doc of entriesSnap.docs) {
        const entry = doc.data();

        // Calculate running balance based on transaction type and status
        const isConfirmed = entry.status === 'verified' || entry.status === 'approved';

        if (isConfirmed && entry.status !== 'voided') {
          if (entry.transactionType === 'payment') {
            runningNetReceived += entry.amount || 0;
          } else if (entry.transactionType === 'refund') {
            runningNetReceived -= entry.amount || 0;
          }
        }

        const balanceAfter = depositRequired - runningNetReceived;

        // Update if different or not set
        if (!dryRun && (entry.balanceAfter !== balanceAfter || entry.depositAtTime !== depositRequired)) {
          await doc.ref.update({
            balanceAfter,
            depositAtTime: depositRequired,
          });
          updated++;
          totalUpdated++;
        } else if (entry.balanceAfter !== balanceAfter) {
          updated++;
          totalUpdated++;
        } else {
          totalSkipped++;
        }
      }

      results.push({
        orderId,
        entries: entriesSnap.size,
        updated,
      });
    }

    res.status(200).json({
      success: true,
      dryRun,
      totalOrders: orderIds.length,
      totalUpdated,
      totalSkipped,
      message: dryRun
        ? `Dry run complete. Would update ${totalUpdated} entries across ${orderIds.length} orders.`
        : `Migration complete. Updated ${totalUpdated} entries across ${orderIds.length} orders.`,
      results,
    });
  } catch (error) {
    console.error('Error migrating balanceAfter:', error);
    res.status(500).json({
      error: error instanceof Error ? error.message : 'Failed to migrate balanceAfter',
    });
  }
});

/**
 * Fix duplicate order number by renaming one order
 */
export const fixDuplicateOrderNumber = functions.https.onRequest(async (req, res) => {
  res.set('Access-Control-Allow-Origin', '*');
  res.set('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.set('Access-Control-Allow-Headers', 'Content-Type');

  if (req.method === 'OPTIONS') {
    res.status(204).send('');
    return;
  }

  if (req.method !== 'POST') {
    res.status(405).json({ error: 'Method not allowed' });
    return;
  }

  try {
    const db = admin.firestore();
    const { orderId, newOrderNumber } = req.body;

    if (!orderId || !newOrderNumber) {
      res.status(400).json({ error: 'orderId and newOrderNumber are required' });
      return;
    }

    // Verify the order exists
    const orderRef = db.collection('orders').doc(orderId);
    const orderSnap = await orderRef.get();

    if (!orderSnap.exists) {
      res.status(404).json({ error: 'Order not found' });
      return;
    }

    const oldOrderNumber = orderSnap.data()?.orderNumber;

    // Check if new order number is already in use
    const existingQuery = await db.collection('orders')
      .where('orderNumber', '==', newOrderNumber)
      .limit(1)
      .get();

    if (!existingQuery.empty) {
      res.status(400).json({ error: `Order number ${newOrderNumber} is already in use` });
      return;
    }

    // Update the order document
    await orderRef.update({
      orderNumber: newOrderNumber,
      updatedAt: admin.firestore.FieldValue.serverTimestamp(),
    });

    // Update all ledger entries for this order
    const ledgerQuery = await db.collection('payment_ledger')
      .where('orderId', '==', orderId)
      .get();

    let ledgerUpdated = 0;
    for (const doc of ledgerQuery.docs) {
      await doc.ref.update({ orderNumber: newOrderNumber });
      ledgerUpdated++;
    }

    // Update any change orders for this order
    const changeOrderQuery = await db.collection('change_orders')
      .where('orderId', '==', orderId)
      .get();

    let changeOrdersUpdated = 0;
    for (const doc of changeOrderQuery.docs) {
      await doc.ref.update({ orderNumber: newOrderNumber });
      changeOrdersUpdated++;
    }

    res.status(200).json({
      success: true,
      orderId,
      oldOrderNumber,
      newOrderNumber,
      ledgerEntriesUpdated: ledgerUpdated,
      changeOrdersUpdated,
    });
  } catch (error) {
    console.error('Error fixing duplicate order number:', error);
    res.status(500).json({
      error: error instanceof Error ? error.message : 'Failed to fix duplicate order number',
    });
  }
});

/**
 * Sync order number counter to highest existing order number
 * Run this once to fix counter after duplicate fixes
 */
export const syncOrderNumberCounter = functions.https.onRequest(async (req, res) => {
  res.set('Access-Control-Allow-Origin', '*');
  res.set('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.set('Access-Control-Allow-Headers', 'Content-Type');

  if (req.method === 'OPTIONS') {
    res.status(204).send('');
    return;
  }

  try {
    const db = admin.firestore();

    // Find highest order number across all orders
    const ordersSnap = await db.collection('orders').get();

    let maxNumber = 0;
    ordersSnap.docs.forEach(doc => {
      const orderNumber = doc.data().orderNumber;
      if (orderNumber && typeof orderNumber === 'string') {
        const match = orderNumber.match(/ORD-(\d+)/);
        if (match) {
          const num = parseInt(match[1], 10);
          if (num > maxNumber) {
            maxNumber = num;
          }
        }
      }
    });

    // Update the unified counter document
    await db.collection('counters').doc('order_number').set({
      current: maxNumber,
      syncedAt: admin.firestore.FieldValue.serverTimestamp(),
    });

    res.status(200).json({
      success: true,
      highestOrderNumber: maxNumber,
      counterSetTo: maxNumber,
      message: `Counter synced to ${maxNumber}. Next order will be ORD-${String(maxNumber + 1).padStart(5, '0')}`,
    });
  } catch (error) {
    console.error('Error syncing order number counter:', error);
    res.status(500).json({
      error: error instanceof Error ? error.message : 'Failed to sync counter',
    });
  }
});
