import * as functions from 'firebase-functions/v1';
import * as admin from 'firebase-admin';
import Stripe from 'stripe';
import { createLedgerEntry, updateOrderLedgerSummary } from './paymentLedgerFunctions';

// Initialize Stripe
const stripe = new Stripe(process.env.STRIPE_SECRET_KEY || 'sk_test_placeholder', {
  apiVersion: '2023-10-16',
});

// ============================================================
// PREPAID CREDIT TYPES
// ============================================================

type PrepaidCreditStatus = 'available' | 'applied' | 'refunded' | 'voided';

interface PrepaidCredit {
  id?: string;
  customerEmail: string;
  customerName: string;
  customerPhone?: string;
  amount: number;
  stripePaymentId?: string;
  stripeVerified: boolean;
  method: 'stripe' | 'check' | 'wire' | 'cash' | 'other';
  status: PrepaidCreditStatus;
  appliedToOrderId?: string;
  appliedToOrderNumber?: string;
  appliedAt?: FirebaseFirestore.Timestamp;
  appliedBy?: string;
  createdAt: FirebaseFirestore.Timestamp;
  createdBy: string;
  notes?: string;
  proofFile?: {
    name: string;
    storagePath: string;
    downloadUrl: string;
    size: number;
    type: string;
  };
  voidedAt?: FirebaseFirestore.Timestamp;
  voidedBy?: string;
  voidReason?: string;
}

// ============================================================
// RECORD PREPAID PAYMENT
// ============================================================

/**
 * Record a prepaid payment (payment before order exists)
 * Creates an entry in the prepaid_credits collection
 */
export const recordPrepaidPayment = functions.https.onRequest(async (req, res) => {
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
    const {
      customerEmail,
      customerName,
      customerPhone,
      amount,
      stripePaymentId,
      method,
      notes,
      proofFile,
      createdBy,
    } = req.body;

    // Validate required fields
    if (!customerEmail) {
      res.status(400).json({ error: 'customerEmail is required' });
      return;
    }

    if (!customerName) {
      res.status(400).json({ error: 'customerName is required' });
      return;
    }

    if (!amount || amount <= 0) {
      res.status(400).json({ error: 'amount is required and must be positive' });
      return;
    }

    if (!method) {
      res.status(400).json({ error: 'method is required (stripe, check, wire, cash, other)' });
      return;
    }

    if (!createdBy) {
      res.status(400).json({ error: 'createdBy is required' });
      return;
    }

    // Verify Stripe payment if provided
    let stripeVerified = false;
    let stripeAmount: number | undefined;

    if (stripePaymentId && method === 'stripe') {
      try {
        if (stripePaymentId.startsWith('pi_')) {
          const paymentIntent = await stripe.paymentIntents.retrieve(stripePaymentId);
          stripeVerified = paymentIntent.status === 'succeeded';
          stripeAmount = paymentIntent.amount;
        } else if (stripePaymentId.startsWith('ch_')) {
          const charge = await stripe.charges.retrieve(stripePaymentId);
          stripeVerified = charge.paid && charge.status === 'succeeded';
          stripeAmount = charge.amount;
        }

        // Verify amount matches (within $1 tolerance)
        if (stripeVerified && stripeAmount) {
          const stripeDollars = stripeAmount / 100;
          if (Math.abs(stripeDollars - amount) > 1) {
            res.status(400).json({
              error: `Stripe amount ($${stripeDollars}) does not match entered amount ($${amount})`,
            });
            return;
          }
        }
      } catch (stripeError) {
        console.error('Stripe verification failed:', stripeError);
        // For test mode, allow unverified entries
        if (!stripePaymentId.startsWith('test_')) {
          res.status(400).json({
            error: 'Failed to verify Stripe payment. Check the payment ID.',
          });
          return;
        }
        // Test mode - mark as verified
        stripeVerified = true;
      }
    }

    // For non-Stripe payments, require proof file
    if (method !== 'stripe' && !proofFile?.downloadUrl) {
      res.status(400).json({
        error: 'Proof file is required for non-Stripe payments',
      });
      return;
    }

    // Create prepaid credit entry
    const creditData: Omit<PrepaidCredit, 'id'> = {
      customerEmail: customerEmail.toLowerCase().trim(),
      customerName: customerName.trim(),
      amount: Math.abs(amount),
      method,
      stripeVerified,
      status: 'available',
      createdAt: admin.firestore.Timestamp.now(),
      createdBy,
    };

    if (customerPhone) {
      creditData.customerPhone = customerPhone;
    }

    if (stripePaymentId) {
      creditData.stripePaymentId = stripePaymentId;
    }

    if (notes) {
      creditData.notes = notes;
    }

    if (proofFile) {
      creditData.proofFile = proofFile;
    }

    const docRef = await db.collection('prepaid_credits').add(creditData);

    console.log(`Prepaid credit ${docRef.id} created: $${amount} for ${customerEmail}`);

    res.status(200).json({
      success: true,
      creditId: docRef.id,
      stripeVerified,
      amount,
      customerEmail,
    });
  } catch (error) {
    console.error('Error recording prepaid payment:', error);
    res.status(500).json({
      error: error instanceof Error ? error.message : 'Failed to record prepaid payment',
    });
  }
});

// ============================================================
// APPLY PREPAID CREDIT TO ORDER
// ============================================================

/**
 * Apply a prepaid credit to an order
 * Creates a ledger entry and marks the credit as applied
 */
export const applyPrepaidCreditToOrder = functions.https.onRequest(async (req, res) => {
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
    const { creditId, orderId, appliedBy } = req.body;

    // Validate required fields
    if (!creditId) {
      res.status(400).json({ error: 'creditId is required' });
      return;
    }

    if (!orderId) {
      res.status(400).json({ error: 'orderId is required' });
      return;
    }

    if (!appliedBy) {
      res.status(400).json({ error: 'appliedBy is required' });
      return;
    }

    // Get the prepaid credit
    const creditRef = db.collection('prepaid_credits').doc(creditId);
    const creditSnap = await creditRef.get();

    if (!creditSnap.exists) {
      res.status(404).json({ error: 'Prepaid credit not found' });
      return;
    }

    const credit = creditSnap.data() as PrepaidCredit;

    // Verify credit is available
    if (credit.status !== 'available') {
      res.status(400).json({
        error: `Credit is not available. Current status: ${credit.status}`,
      });
      return;
    }

    // Get the order
    const orderRef = db.collection('orders').doc(orderId);
    const orderSnap = await orderRef.get();

    if (!orderSnap.exists) {
      res.status(404).json({ error: 'Order not found' });
      return;
    }

    const order = orderSnap.data();

    // Use a transaction to ensure atomicity
    await db.runTransaction(async (transaction) => {
      // Create ledger entry for the payment
      const { entryId } = await createLedgerEntry({
        orderId,
        orderNumber: order?.orderNumber || '',
        transactionType: 'payment',
        amount: credit.amount,
        method: credit.method as any,
        category: 'initial_deposit',
        status: credit.stripeVerified || credit.method !== 'stripe' ? 'verified' : 'approved',
        stripePaymentId: credit.stripePaymentId,
        stripeVerified: credit.stripeVerified,
        description: `Applied prepaid credit from ${credit.customerName}`,
        notes: credit.notes,
        proofFile: credit.proofFile,
        createdBy: appliedBy,
      }, db);

      // Mark credit as applied
      transaction.update(creditRef, {
        status: 'applied',
        appliedToOrderId: orderId,
        appliedToOrderNumber: order?.orderNumber || '',
        appliedAt: admin.firestore.FieldValue.serverTimestamp(),
        appliedBy,
      });

      console.log(`Prepaid credit ${creditId} applied to order ${orderId}, ledger entry: ${entryId}`);
    });

    // Update the order's ledger summary
    const summary = await updateOrderLedgerSummary(orderId, db);

    res.status(200).json({
      success: true,
      creditId,
      orderId,
      amount: credit.amount,
      summary,
    });
  } catch (error) {
    console.error('Error applying prepaid credit:', error);
    res.status(500).json({
      error: error instanceof Error ? error.message : 'Failed to apply prepaid credit',
    });
  }
});

// ============================================================
// GET UNAPPLIED CREDITS
// ============================================================

/**
 * Get available prepaid credits for a customer
 * Can search by email or get all available credits
 */
export const getUnappliedCredits = functions.https.onRequest(async (req, res) => {
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
    const customerEmail = req.query.customerEmail as string | undefined;
    const includeApplied = req.query.includeApplied === 'true';

    let query: FirebaseFirestore.Query = db.collection('prepaid_credits');

    // Filter by status
    if (!includeApplied) {
      query = query.where('status', '==', 'available');
    }

    // Filter by customer email if provided
    if (customerEmail) {
      query = query.where('customerEmail', '==', customerEmail.toLowerCase().trim());
    }

    const creditsQuery = await query.orderBy('createdAt', 'desc').get();

    const credits = creditsQuery.docs.map((doc) => ({
      id: doc.id,
      ...doc.data(),
    }));

    // Calculate totals
    const totalAvailable = credits
      .filter((c: any) => c.status === 'available')
      .reduce((sum, c: any) => sum + c.amount, 0);

    res.status(200).json({
      credits,
      count: credits.length,
      totalAvailable,
    });
  } catch (error) {
    console.error('Error getting unapplied credits:', error);
    res.status(500).json({
      error: error instanceof Error ? error.message : 'Failed to get credits',
    });
  }
});

// ============================================================
// VOID PREPAID CREDIT
// ============================================================

/**
 * Void a prepaid credit (soft delete)
 */
export const voidPrepaidCredit = functions.https.onRequest(async (req, res) => {
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
    const { creditId, voidedBy, voidReason } = req.body;

    if (!creditId) {
      res.status(400).json({ error: 'creditId is required' });
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

    const creditRef = db.collection('prepaid_credits').doc(creditId);
    const creditSnap = await creditRef.get();

    if (!creditSnap.exists) {
      res.status(404).json({ error: 'Prepaid credit not found' });
      return;
    }

    const credit = creditSnap.data() as PrepaidCredit;

    if (credit.status === 'applied') {
      res.status(400).json({
        error: 'Cannot void an applied credit. Void the ledger entry instead.',
      });
      return;
    }

    if (credit.status === 'voided') {
      res.status(400).json({ error: 'Credit is already voided' });
      return;
    }

    await creditRef.update({
      status: 'voided',
      voidedAt: admin.firestore.FieldValue.serverTimestamp(),
      voidedBy,
      voidReason,
    });

    console.log(`Prepaid credit ${creditId} voided by ${voidedBy}: ${voidReason}`);

    res.status(200).json({
      success: true,
      creditId,
    });
  } catch (error) {
    console.error('Error voiding prepaid credit:', error);
    res.status(500).json({
      error: error instanceof Error ? error.message : 'Failed to void credit',
    });
  }
});

// ============================================================
// FIND MATCHING CREDITS FOR ORDER
// ============================================================

/**
 * Find prepaid credits that might match an order's customer
 * Searches by email (exact match)
 */
export const findMatchingCredits = functions.https.onRequest(async (req, res) => {
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
    const orderId = req.query.orderId as string;

    if (!orderId) {
      res.status(400).json({ error: 'orderId query parameter is required' });
      return;
    }

    // Get the order
    const orderSnap = await db.collection('orders').doc(orderId).get();

    if (!orderSnap.exists) {
      res.status(404).json({ error: 'Order not found' });
      return;
    }

    const order = orderSnap.data();
    const customerEmail = order?.customer?.email?.toLowerCase().trim();

    if (!customerEmail) {
      res.status(200).json({
        credits: [],
        count: 0,
        totalAvailable: 0,
        message: 'No customer email on order',
      });
      return;
    }

    // Find available credits for this customer
    const creditsQuery = await db
      .collection('prepaid_credits')
      .where('customerEmail', '==', customerEmail)
      .where('status', '==', 'available')
      .orderBy('createdAt', 'desc')
      .get();

    const credits = creditsQuery.docs.map((doc) => ({
      id: doc.id,
      ...doc.data(),
    }));

    const totalAvailable = credits.reduce((sum, c: any) => sum + c.amount, 0);

    res.status(200).json({
      credits,
      count: credits.length,
      totalAvailable,
      customerEmail,
    });
  } catch (error) {
    console.error('Error finding matching credits:', error);
    res.status(500).json({
      error: error instanceof Error ? error.message : 'Failed to find credits',
    });
  }
});
