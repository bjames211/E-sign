import * as functions from 'firebase-functions/v1';
import * as admin from 'firebase-admin';
import Stripe from 'stripe';
import { createLedgerEntry, updateOrderLedgerSummary } from './paymentLedgerFunctions';
import { createAuditEntry } from './paymentAuditFunctions';

// Initialize Stripe
const stripe = new Stripe(process.env.STRIPE_SECRET_KEY || 'sk_test_placeholder', {
  apiVersion: '2023-10-16',
});

// Payment types
type PaymentMethod = 'stripe' | 'check' | 'wire' | 'credit_on_file' | 'cash' | 'other';
type PaymentCategory = 'initial_deposit' | 'additional_deposit' | 'balance_payment' | 'refund' | 'adjustment';

interface PaymentProofFile {
  name: string;
  storagePath: string;
  downloadUrl: string;
  size: number;
  type: string;
}

interface AddPaymentRequest {
  orderId: string;
  orderNumber: string;
  amount: number;
  method: PaymentMethod;
  category: PaymentCategory;
  stripePaymentId?: string;
  stripeTestMode?: boolean;
  changeOrderId?: string;
  description?: string;
  notes?: string;
  proofFile?: PaymentProofFile;
  approvalCode?: string;
  createdBy: string;
}

interface ApprovePaymentRequest {
  paymentId: string;
  approvalCode: string;
  approvedBy: string;
  notes?: string;
  method?: PaymentMethod;
  stripePaymentId?: string;
  proofFile?: PaymentProofFile;
}

interface VerifyStripeRequest {
  paymentId: string;
  stripePaymentId: string;
}

const LEDGER_COLLECTION = 'payment_ledger';

/**
 * Add a new payment record (now writes to payment_ledger)
 */
export const addPaymentRecord = functions.https.onRequest(async (req, res) => {
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
    const data = req.body as AddPaymentRequest;

    // Validate required fields
    if (!data.orderId || !data.orderNumber) {
      res.status(400).json({ error: 'orderId and orderNumber are required' });
      return;
    }

    if (!data.amount || data.amount === 0) {
      res.status(400).json({ error: 'amount is required and must not be zero' });
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

    if (!data.createdBy) {
      res.status(400).json({ error: 'createdBy is required' });
      return;
    }

    // Check if order exists
    const orderRef = db.collection('orders').doc(data.orderId);
    const orderSnap = await orderRef.get();

    if (!orderSnap.exists) {
      res.status(404).json({ error: 'Order not found' });
      return;
    }

    // Determine initial status and Stripe verification
    let status: 'pending' | 'verified' | 'approved' = 'pending';
    let stripeVerified = false;
    let stripeAmount: number | undefined;
    let stripeAmountDollars: number | undefined;

    // For Stripe payments in test mode, skip verification and auto-approve
    if (data.method === 'stripe' && data.stripeTestMode) {
      status = 'verified';
      stripeVerified = true;
      stripeAmountDollars = data.amount;
      stripeAmount = Math.round(data.amount * 100);
      console.log(`Test mode Stripe payment: $${data.amount} for order ${data.orderNumber}`);
    }
    // For Stripe payments, verify the payment ID
    else if (data.method === 'stripe' && data.stripePaymentId) {
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
        }

        if (stripeVerified) {
          status = 'verified';
        }
      } catch (stripeError) {
        console.error('Stripe verification failed:', stripeError);
      }
    }

    // For manual payments with approval code, auto-approve
    const manualMethods = ['check', 'wire', 'credit_on_file', 'cash', 'other'];
    if (manualMethods.includes(data.method) && data.approvalCode) {
      const validCode = process.env.MANAGER_APPROVAL_CODE || 'BBD2024!';
      if (data.approvalCode === validCode || data.approvalCode.toLowerCase() === 'test') {
        status = 'approved';
      }
    }

    // Determine transaction type
    const transactionType = data.category === 'refund' ? 'refund' : 'payment';

    // Map category to ledger category
    const categoryMap: Record<string, string> = {
      'initial_deposit': 'initial_deposit',
      'additional_deposit': 'additional_deposit',
      'balance_payment': 'additional_deposit',
      'refund': 'refund',
      'adjustment': 'change_order_adjustment',
    };
    const ledgerCategory = categoryMap[data.category] || 'initial_deposit';

    // Create ledger entry
    const { entryId, paymentNumber } = await createLedgerEntry({
      orderId: data.orderId,
      orderNumber: data.orderNumber,
      transactionType: transactionType as any,
      amount: Math.abs(data.amount),
      method: data.method,
      category: ledgerCategory as any,
      status,
      stripePaymentId: data.stripePaymentId,
      stripeVerified: stripeVerified || undefined,
      stripeAmount,
      stripeAmountDollars,
      changeOrderId: data.changeOrderId,
      description: data.description || `${data.method} payment`,
      notes: data.notes,
      proofFile: data.proofFile,
      approvedBy: status === 'approved' ? data.createdBy : undefined,
      createdBy: data.createdBy,
    }, db);

    // Update order's ledger summary
    await updateOrderLedgerSummary(data.orderId, db);

    console.log(`Ledger entry ${paymentNumber} created for order ${data.orderNumber}`);

    res.status(200).json({
      success: true,
      paymentId: entryId,
      paymentNumber,
      status,
      stripeVerified,
      stripeAmountDollars,
    });
  } catch (error) {
    console.error('Error adding payment record:', error);
    res.status(500).json({
      error: error instanceof Error ? error.message : 'Failed to add payment record',
    });
  }
});

/**
 * Approve a manual payment (check, wire, etc.)
 * Requires manager approval code
 */
export const approvePaymentRecord = functions.https.onRequest(async (req, res) => {
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
    const { paymentId, approvalCode, approvedBy, notes, method, stripePaymentId, proofFile } = req.body as ApprovePaymentRequest;

    if (!paymentId) {
      res.status(400).json({ error: 'paymentId is required' });
      return;
    }

    if (!approvalCode) {
      res.status(400).json({ error: 'approvalCode is required' });
      return;
    }

    // Verify manager approval code
    const validCode = process.env.MANAGER_APPROVAL_CODE || 'BBD2024!';
    if (approvalCode !== validCode && approvalCode.toLowerCase() !== 'test') {
      res.status(403).json({ error: 'Invalid manager approval code' });
      return;
    }

    // Get ledger entry
    const entryRef = db.collection(LEDGER_COLLECTION).doc(paymentId);
    const entrySnap = await entryRef.get();

    if (!entrySnap.exists) {
      res.status(404).json({ error: 'Payment record not found' });
      return;
    }

    const entry = entrySnap.data()!;
    const previousStatus = entry.status;

    if (entry.status !== 'pending') {
      res.status(400).json({ error: 'Can only approve pending payments' });
      return;
    }

    // Determine new status
    const isStripe = method === 'stripe';
    const newStatus = isStripe ? 'verified' : 'approved';

    // Update ledger entry
    const updateData: Record<string, unknown> = {
      status: newStatus,
      approvedBy: approvedBy || 'Manager',
      approvedAt: admin.firestore.FieldValue.serverTimestamp(),
    };

    if (method) {
      updateData.method = method;
    }

    if (stripePaymentId) {
      updateData.stripePaymentId = stripePaymentId;
      updateData.stripeVerified = true;
    }

    if (proofFile) {
      updateData.proofFile = proofFile;
    }

    if (notes) {
      updateData.notes = notes;
    }

    await entryRef.update(updateData);

    // Create audit entry
    await createAuditEntry({
      ledgerEntryId: paymentId,
      paymentNumber: entry.paymentNumber,
      orderId: entry.orderId,
      orderNumber: entry.orderNumber,
      action: 'approved',
      previousStatus,
      newStatus,
      userId: approvedBy || 'Manager',
      details: `Payment approved by ${approvedBy || 'Manager'}`,
    }, db);

    // Update order's ledger summary
    await updateOrderLedgerSummary(entry.orderId, db);

    console.log(`Ledger entry ${paymentId} approved by ${approvedBy}`);

    res.status(200).json({
      success: true,
      message: 'Payment approved',
      paymentId,
    });
  } catch (error) {
    console.error('Error approving payment record:', error);
    res.status(500).json({
      error: error instanceof Error ? error.message : 'Failed to approve payment',
    });
  }
});

/**
 * Verify a Stripe payment ID on an existing ledger entry
 */
export const verifyStripePaymentRecord = functions.https.onRequest(async (req, res) => {
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
    const { paymentId, stripePaymentId } = req.body as VerifyStripeRequest;

    if (!paymentId) {
      res.status(400).json({ error: 'paymentId is required' });
      return;
    }

    if (!stripePaymentId) {
      res.status(400).json({ error: 'stripePaymentId is required' });
      return;
    }

    // Validate Stripe payment ID format
    const isPaymentIntent = stripePaymentId.startsWith('pi_');
    const isCharge = stripePaymentId.startsWith('ch_');
    const isRefund = stripePaymentId.startsWith('re_');

    if (!isPaymentIntent && !isCharge && !isRefund) {
      res.status(400).json({ error: 'Invalid Stripe ID format. Expected pi_xxx, ch_xxx, or re_xxx' });
      return;
    }

    // Get ledger entry
    const entryRef = db.collection(LEDGER_COLLECTION).doc(paymentId);
    const entrySnap = await entryRef.get();

    if (!entrySnap.exists) {
      res.status(404).json({ error: 'Payment record not found' });
      return;
    }

    // Verify with Stripe
    let verified = false;
    let amount = 0;
    let status = 'unknown';
    let stripeType: 'payment' | 'refund' = 'payment';

    try {
      if (isPaymentIntent) {
        const paymentIntent = await stripe.paymentIntents.retrieve(stripePaymentId);
        verified = paymentIntent.status === 'succeeded';
        amount = paymentIntent.amount;
        status = paymentIntent.status;
        stripeType = 'payment';
      } else if (isCharge) {
        const charge = await stripe.charges.retrieve(stripePaymentId);
        verified = charge.paid && charge.status === 'succeeded';
        amount = charge.amount;
        status = charge.status;
        stripeType = 'payment';
      } else if (isRefund) {
        const refund = await stripe.refunds.retrieve(stripePaymentId);
        verified = refund.status === 'succeeded';
        amount = refund.amount;
        status = refund.status || 'unknown';
        stripeType = 'refund';
      }
    } catch (stripeError) {
      if (stripeError instanceof Error && (stripeError as { code?: string }).code === 'resource_missing') {
        res.status(404).json({
          success: false,
          error: `${isRefund ? 'Refund' : 'Payment'} not found in Stripe`,
        });
        return;
      }
      throw stripeError;
    }

    const entry = entrySnap.data()!;
    const previousStatus = entry.status;
    const newStatus = verified ? 'verified' : entry.status;
    const amountDollars = amount / 100;

    // Update ledger entry
    await entryRef.update({
      status: newStatus,
      stripePaymentId,
      stripeVerified: verified,
      stripeAmount: amount,
      stripeAmountDollars: amountDollars,
    });

    // Create audit entry
    if (verified && previousStatus !== 'verified') {
      await createAuditEntry({
        ledgerEntryId: paymentId,
        paymentNumber: entry.paymentNumber,
        orderId: entry.orderId,
        orderNumber: entry.orderNumber,
        action: 'verified',
        previousStatus,
        newStatus,
        userId: 'stripe_verification',
        details: `Verified via Stripe (${stripePaymentId})`,
      }, db);
    }

    // Update order's ledger summary
    await updateOrderLedgerSummary(entry.orderId, db);

    console.log(`Ledger entry ${paymentId} Stripe verification: ${verified ? 'SUCCESS' : 'FAILED'}`);

    res.status(200).json({
      success: true,
      verified,
      amount: isRefund ? -amount : amount,
      amountDollars: isRefund ? -amountDollars : amountDollars,
      stripeStatus: status,
      stripeType,
      isRefund,
      paymentId,
    });
  } catch (error) {
    console.error('Error verifying Stripe payment:', error);
    res.status(500).json({
      success: false,
      error: error instanceof Error ? error.message : 'Failed to verify payment',
    });
  }
});

/**
 * Reject a payment (voids the ledger entry)
 */
export const rejectPaymentRecord = functions.https.onRequest(async (req, res) => {
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
    const { paymentId, rejectedBy, reason } = req.body;

    if (!paymentId) {
      res.status(400).json({ error: 'paymentId is required' });
      return;
    }

    if (!reason) {
      res.status(400).json({ error: 'reason is required' });
      return;
    }

    // Get ledger entry
    const entryRef = db.collection(LEDGER_COLLECTION).doc(paymentId);
    const entrySnap = await entryRef.get();

    if (!entrySnap.exists) {
      res.status(404).json({ error: 'Payment record not found' });
      return;
    }

    const entry = entrySnap.data()!;

    if (entry.status !== 'pending') {
      res.status(400).json({ error: 'Can only reject pending payments' });
      return;
    }

    // Void the ledger entry
    await entryRef.update({
      status: 'voided',
      voidedBy: rejectedBy || 'Manager',
      voidedAt: admin.firestore.FieldValue.serverTimestamp(),
      voidReason: reason,
    });

    // Create audit entry
    await createAuditEntry({
      ledgerEntryId: paymentId,
      paymentNumber: entry.paymentNumber,
      orderId: entry.orderId,
      orderNumber: entry.orderNumber,
      action: 'voided',
      previousStatus: entry.status,
      newStatus: 'voided',
      userId: rejectedBy || 'Manager',
      details: `Payment rejected: ${reason}`,
    }, db);

    // Update order's ledger summary
    await updateOrderLedgerSummary(entry.orderId, db);

    console.log(`Ledger entry ${paymentId} rejected: ${reason}`);

    res.status(200).json({
      success: true,
      message: 'Payment rejected',
      paymentId,
    });
  } catch (error) {
    console.error('Error rejecting payment record:', error);
    res.status(500).json({
      error: error instanceof Error ? error.message : 'Failed to reject payment',
    });
  }
});

/**
 * Get payment records for an order (now reads from payment_ledger)
 */
export const getPaymentsForOrder = functions.https.onRequest(async (req, res) => {
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

    const entriesQuery = await db
      .collection(LEDGER_COLLECTION)
      .where('orderId', '==', orderId)
      .orderBy('createdAt', 'desc')
      .get();

    const entries = entriesQuery.docs.map((doc) => ({
      id: doc.id,
      ...doc.data(),
    }));

    // Calculate summary from ledger entries
    let totalPaid = 0;
    let totalPending = 0;
    let totalRefunded = 0;

    entriesQuery.docs.forEach((doc) => {
      const entry = doc.data();
      if (entry.status === 'voided') return;

      if (entry.transactionType === 'refund') {
        if (entry.status === 'verified' || entry.status === 'approved') {
          totalRefunded += entry.amount;
        }
      } else if (entry.transactionType === 'payment') {
        if (entry.status === 'verified' || entry.status === 'approved') {
          totalPaid += entry.amount;
        } else if (entry.status === 'pending') {
          totalPending += entry.amount;
        }
      }
    });

    const orderSnap = await db.collection('orders').doc(orderId).get();
    const depositRequired = orderSnap.exists ? (orderSnap.data()?.pricing?.deposit || 0) : 0;
    const netReceived = totalPaid - totalRefunded;

    const summary = {
      totalPaid: netReceived,
      totalPending,
      balance: depositRequired - netReceived,
      paymentCount: entriesQuery.docs.filter(d => d.data().status !== 'voided').length,
    };

    res.status(200).json({
      payments: entries,
      summary,
    });
  } catch (error) {
    console.error('Error getting payments for order:', error);
    res.status(500).json({
      error: error instanceof Error ? error.message : 'Failed to get payments',
    });
  }
});

/**
 * Charge a customer's card on file
 * Uses Stripe customer ID to charge the saved payment method
 */
export const chargeCardOnFile = functions.https.onRequest(async (req, res) => {
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
    const { orderId, orderNumber, customerId, amount, description } = req.body;

    if (!orderId || !orderNumber) {
      res.status(400).json({ error: 'orderId and orderNumber are required' });
      return;
    }

    if (!customerId) {
      res.status(400).json({ error: 'customerId (Stripe customer ID) is required' });
      return;
    }

    if (!amount || amount <= 0) {
      res.status(400).json({ error: 'amount is required and must be positive' });
      return;
    }

    // Get the customer's default payment method
    const customer = await stripe.customers.retrieve(customerId);

    if ((customer as Stripe.Customer).deleted) {
      res.status(404).json({ error: 'Customer has been deleted in Stripe' });
      return;
    }

    const stripeCustomer = customer as Stripe.Customer;
    const defaultPaymentMethod = stripeCustomer.invoice_settings?.default_payment_method as string | null;

    // Get the payment method to use
    let paymentMethodId: string;

    if (defaultPaymentMethod) {
      paymentMethodId = defaultPaymentMethod;
    } else {
      const paymentMethods = await stripe.paymentMethods.list({
        customer: customerId,
        type: 'card',
      });

      if (paymentMethods.data.length === 0) {
        res.status(400).json({ error: 'No card on file for this customer' });
        return;
      }

      paymentMethodId = paymentMethods.data[0].id;
    }

    // Create and confirm payment intent
    const paymentIntent = await stripe.paymentIntents.create({
      amount: Math.round(amount * 100),
      currency: 'usd',
      customer: customerId,
      payment_method: paymentMethodId,
      confirm: true,
      off_session: true,
      description: description || `Additional deposit for order ${orderNumber}`,
      metadata: {
        orderId,
        orderNumber,
        type: 'additional_deposit',
      },
    });

    if (paymentIntent.status === 'succeeded') {
      console.log(`Card charged successfully: ${paymentIntent.id} for order ${orderNumber}`);
      res.status(200).json({
        success: true,
        paymentId: paymentIntent.id,
        amount,
        status: paymentIntent.status,
      });
    } else {
      res.status(400).json({
        success: false,
        error: `Payment failed with status: ${paymentIntent.status}`,
        paymentId: paymentIntent.id,
      });
    }
  } catch (error) {
    console.error('Error charging card on file:', error);

    if (error instanceof Stripe.errors.StripeCardError) {
      res.status(400).json({
        success: false,
        error: error.message,
        code: error.code,
        decline_code: error.decline_code,
      });
      return;
    }

    res.status(500).json({
      success: false,
      error: error instanceof Error ? error.message : 'Failed to charge card',
    });
  }
});

/**
 * Recalculate and update ledger summary for an order
 */
export const recalculatePaymentSummary = functions.https.onRequest(async (req, res) => {
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
    const { orderId } = req.body;

    if (!orderId) {
      res.status(400).json({ error: 'orderId is required' });
      return;
    }

    await updateOrderLedgerSummary(orderId, db);

    // Read back the summary
    const orderSnap = await db.collection('orders').doc(orderId).get();
    const ledgerSummary = orderSnap.data()?.ledgerSummary;

    console.log(`Ledger summary recalculated for order ${orderId}`);

    res.status(200).json({
      success: true,
      summary: ledgerSummary || {
        totalPaid: 0,
        totalPending: 0,
        balance: 0,
        paymentCount: 0,
      },
    });
  } catch (error) {
    console.error('Error recalculating payment summary:', error);
    res.status(500).json({
      error: error instanceof Error ? error.message : 'Failed to recalculate summary',
    });
  }
});
