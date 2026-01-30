import * as functions from 'firebase-functions/v1';
import * as admin from 'firebase-admin';
import Stripe from 'stripe';

// Initialize Stripe
const stripe = new Stripe(process.env.STRIPE_SECRET_KEY || 'sk_test_placeholder', {
  apiVersion: '2023-10-16',
});

// Payment types
type PaymentMethod = 'stripe' | 'check' | 'wire' | 'credit_on_file' | 'cash' | 'other';
type PaymentCategory = 'initial_deposit' | 'additional_deposit' | 'balance_payment' | 'refund' | 'adjustment';
type PaymentRecordStatus = 'pending' | 'verified' | 'approved' | 'failed' | 'cancelled';

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
  stripeTestMode?: boolean;           // Skip Stripe verification for testing
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

interface PaymentSummary {
  totalPaid: number;
  totalPending: number;
  balance: number;
  paymentCount: number;
  lastPaymentAt?: FirebaseFirestore.Timestamp;
}

// Helper to calculate payment summary
async function calculatePaymentSummary(orderId: string, db: FirebaseFirestore.Firestore): Promise<PaymentSummary> {
  const paymentsQuery = await db
    .collection('payments')
    .where('orderId', '==', orderId)
    .get();

  let totalPaid = 0;
  let totalPending = 0;
  let lastPaymentAt: FirebaseFirestore.Timestamp | undefined;

  paymentsQuery.docs.forEach((doc) => {
    const payment = doc.data();
    if (payment.status === 'verified' || payment.status === 'approved') {
      totalPaid += payment.amount;
      if (!lastPaymentAt || (payment.createdAt && payment.createdAt.toMillis() > lastPaymentAt.toMillis())) {
        lastPaymentAt = payment.createdAt;
      }
    } else if (payment.status === 'pending') {
      totalPending += payment.amount;
    }
  });

  // Get order to know deposit required
  const orderSnap = await db.collection('orders').doc(orderId).get();
  const depositRequired = orderSnap.exists ? (orderSnap.data()?.pricing?.deposit || 0) : 0;

  const summary: PaymentSummary = {
    totalPaid,
    totalPending,
    balance: depositRequired - totalPaid,
    paymentCount: paymentsQuery.docs.length,
  };

  // Only include lastPaymentAt if it exists (Firestore doesn't accept undefined)
  if (lastPaymentAt) {
    summary.lastPaymentAt = lastPaymentAt;
  }

  return summary;
}

// Helper to update order's payment summary
async function updateOrderPaymentSummary(orderId: string, db: FirebaseFirestore.Firestore): Promise<void> {
  const summary = await calculatePaymentSummary(orderId, db);
  await db.collection('orders').doc(orderId).update({
    paymentSummary: summary,
    updatedAt: admin.firestore.FieldValue.serverTimestamp(),
  });
}

/**
 * Add a new payment record
 * Optionally verifies Stripe payment if stripePaymentId is provided
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

    // Determine initial status
    let status: PaymentRecordStatus = 'pending';
    let stripeVerified = false;
    let stripeAmount: number | undefined;
    let stripeAmountDollars: number | undefined;
    let stripeStatus: string | undefined;
    let isTestPayment = false;

    // For Stripe payments in test mode, skip verification and auto-approve
    if (data.method === 'stripe' && data.stripeTestMode) {
      isTestPayment = true;
      status = 'verified';
      stripeVerified = true;
      stripeAmountDollars = data.amount;
      stripeAmount = Math.round(data.amount * 100);
      stripeStatus = 'test_mode';
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
          stripeStatus = paymentIntent.status;
        } else if (data.stripePaymentId.startsWith('ch_')) {
          const charge = await stripe.charges.retrieve(data.stripePaymentId);
          stripeVerified = charge.paid && charge.status === 'succeeded';
          stripeAmount = charge.amount;
          stripeAmountDollars = charge.amount / 100;
          stripeStatus = charge.status;
        }

        if (stripeVerified) {
          status = 'verified';
        }
      } catch (stripeError) {
        console.error('Stripe verification failed:', stripeError);
        // Continue with pending status
      }
    }

    // For manual payments with approval code, auto-approve
    const manualMethods = ['check', 'wire', 'credit_on_file', 'cash', 'other'];
    let approvedBy: string | undefined;
    let approvedAt: FirebaseFirestore.FieldValue | undefined;

    if (manualMethods.includes(data.method) && data.approvalCode) {
      const validCode = process.env.MANAGER_APPROVAL_CODE || 'BBD2024!';
      if (data.approvalCode === validCode || data.approvalCode.toLowerCase() === 'test') {
        status = 'approved';
        approvedBy = data.createdBy;
        approvedAt = admin.firestore.FieldValue.serverTimestamp();
      }
    }

    // Build payment record
    const paymentRecord: Record<string, unknown> = {
      orderId: data.orderId,
      orderNumber: data.orderNumber,
      amount: data.amount,
      method: data.method,
      category: data.category,
      status,
      createdBy: data.createdBy,
      createdAt: admin.firestore.FieldValue.serverTimestamp(),
      updatedAt: admin.firestore.FieldValue.serverTimestamp(),
    };

    // Add optional fields
    if (data.stripePaymentId) {
      paymentRecord.stripePaymentId = data.stripePaymentId;
    }
    if (stripeVerified !== undefined) {
      paymentRecord.stripeVerified = stripeVerified;
    }
    if (stripeAmount !== undefined) {
      paymentRecord.stripeAmount = stripeAmount;
    }
    if (stripeAmountDollars !== undefined) {
      paymentRecord.stripeAmountDollars = stripeAmountDollars;
    }
    if (stripeStatus) {
      paymentRecord.stripeStatus = stripeStatus;
    }
    if (isTestPayment) {
      paymentRecord.isTestPayment = true;
    }
    if (data.changeOrderId) {
      paymentRecord.changeOrderId = data.changeOrderId;
    }
    if (data.description) {
      paymentRecord.description = data.description;
    }
    if (data.notes) {
      paymentRecord.notes = data.notes;
    }
    if (data.proofFile) {
      paymentRecord.proofFile = data.proofFile;
    }
    if (approvedBy) {
      paymentRecord.approvedBy = approvedBy;
    }
    if (approvedAt) {
      paymentRecord.approvedAt = approvedAt;
    }

    // Save payment record
    const docRef = await db.collection('payments').add(paymentRecord);

    // Update order's payment summary
    await updateOrderPaymentSummary(data.orderId, db);

    console.log(`Payment record created: ${docRef.id} for order ${data.orderNumber}`);

    res.status(200).json({
      success: true,
      paymentId: docRef.id,
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

    // Verify manager approval code (also accept "test" for testing)
    const validCode = process.env.MANAGER_APPROVAL_CODE || 'BBD2024!';
    if (approvalCode !== validCode && approvalCode.toLowerCase() !== 'test') {
      res.status(403).json({ error: 'Invalid manager approval code' });
      return;
    }

    // Get payment record
    const paymentRef = db.collection('payments').doc(paymentId);
    const paymentSnap = await paymentRef.get();

    if (!paymentSnap.exists) {
      res.status(404).json({ error: 'Payment record not found' });
      return;
    }

    const payment = paymentSnap.data();

    if (payment?.status !== 'pending') {
      res.status(400).json({ error: 'Can only approve pending payments' });
      return;
    }

    // Determine status based on method
    const isStripe = method === 'stripe';
    const newStatus = isStripe ? 'verified' : 'approved';

    // Update payment record
    const updateData: Record<string, unknown> = {
      status: newStatus,
      approvedBy: approvedBy || 'Manager',
      approvedAt: admin.firestore.FieldValue.serverTimestamp(),
      updatedAt: admin.firestore.FieldValue.serverTimestamp(),
    };

    // Update method if provided
    if (method) {
      updateData.method = method;
    }

    // Add Stripe payment ID if provided
    if (stripePaymentId) {
      updateData.stripePaymentId = stripePaymentId;
      updateData.stripeVerified = true;
    }

    // Add proof file if provided
    if (proofFile) {
      updateData.proofFile = proofFile;
    }

    if (notes) {
      updateData.notes = notes;
    }

    await paymentRef.update(updateData);

    // Update order's payment summary
    await updateOrderPaymentSummary(payment?.orderId, db);

    console.log(`Payment record ${paymentId} approved by ${approvedBy}`);

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
 * Verify a Stripe payment ID on an existing payment record
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

    // Get payment record
    const paymentRef = db.collection('payments').doc(paymentId);
    const paymentSnap = await paymentRef.get();

    if (!paymentSnap.exists) {
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

    // Update payment record
    const newStatus: PaymentRecordStatus = verified ? 'verified' : 'failed';
    // Refunds are negative amounts
    const amountDollars = isRefund ? -(amount / 100) : (amount / 100);

    await paymentRef.update({
      status: newStatus,
      stripePaymentId,
      stripeVerified: verified,
      stripeAmount: amount,
      stripeAmountDollars: Math.abs(amountDollars), // Store absolute value
      stripeStatus: status,
      stripeType: stripeType,
      // If it's a refund, update the amount to be negative
      ...(isRefund ? { amount: amountDollars } : {}),
      updatedAt: admin.firestore.FieldValue.serverTimestamp(),
    });

    // Update order's payment summary
    const payment = paymentSnap.data();
    await updateOrderPaymentSummary(payment?.orderId, db);

    console.log(`${isRefund ? 'Refund' : 'Payment'} record ${paymentId} Stripe verification: ${verified ? 'SUCCESS' : 'FAILED'}`);

    res.status(200).json({
      success: true,
      verified,
      amount: isRefund ? -amount : amount, // Return negative for refunds
      amountDollars,
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
 * Reject a payment
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

    // Get payment record
    const paymentRef = db.collection('payments').doc(paymentId);
    const paymentSnap = await paymentRef.get();

    if (!paymentSnap.exists) {
      res.status(404).json({ error: 'Payment record not found' });
      return;
    }

    const payment = paymentSnap.data();

    if (payment?.status !== 'pending') {
      res.status(400).json({ error: 'Can only reject pending payments' });
      return;
    }

    // Update payment record
    await paymentRef.update({
      status: 'failed',
      rejectedBy: rejectedBy || 'Manager',
      rejectedAt: admin.firestore.FieldValue.serverTimestamp(),
      rejectionReason: reason,
      updatedAt: admin.firestore.FieldValue.serverTimestamp(),
    });

    // Update order's payment summary
    await updateOrderPaymentSummary(payment?.orderId, db);

    console.log(`Payment record ${paymentId} rejected: ${reason}`);

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
 * Get payment records for an order
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

    const paymentsQuery = await db
      .collection('payments')
      .where('orderId', '==', orderId)
      .orderBy('createdAt', 'desc')
      .get();

    const payments = paymentsQuery.docs.map((doc) => ({
      id: doc.id,
      ...doc.data(),
    }));

    // Also get the summary
    const summary = await calculatePaymentSummary(orderId, db);

    res.status(200).json({
      payments,
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

    // Validate required fields
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

    if (!defaultPaymentMethod) {
      // Try to get the first payment method attached to the customer
      const paymentMethods = await stripe.paymentMethods.list({
        customer: customerId,
        type: 'card',
      });

      if (paymentMethods.data.length === 0) {
        res.status(400).json({ error: 'No card on file for this customer' });
        return;
      }

      // Use the first card
      const paymentMethodId = paymentMethods.data[0].id;

      // Create and confirm payment intent with the card
      const paymentIntent = await stripe.paymentIntents.create({
        amount: Math.round(amount * 100), // Convert to cents
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
          amount: amount,
          status: paymentIntent.status,
        });
      } else {
        res.status(400).json({
          success: false,
          error: `Payment failed with status: ${paymentIntent.status}`,
          paymentId: paymentIntent.id,
        });
      }
    } else {
      // Use the default payment method
      const paymentIntent = await stripe.paymentIntents.create({
        amount: Math.round(amount * 100), // Convert to cents
        currency: 'usd',
        customer: customerId,
        payment_method: defaultPaymentMethod,
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
          amount: amount,
          status: paymentIntent.status,
        });
      } else {
        res.status(400).json({
          success: false,
          error: `Payment failed with status: ${paymentIntent.status}`,
          paymentId: paymentIntent.id,
        });
      }
    }
  } catch (error) {
    console.error('Error charging card on file:', error);

    // Handle specific Stripe errors
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
 * Recalculate and update payment summary for an order
 * Useful for fixing out-of-sync summaries
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

    await updateOrderPaymentSummary(orderId, db);
    const summary = await calculatePaymentSummary(orderId, db);

    console.log(`Payment summary recalculated for order ${orderId}`);

    res.status(200).json({
      success: true,
      summary,
    });
  } catch (error) {
    console.error('Error recalculating payment summary:', error);
    res.status(500).json({
      error: error instanceof Error ? error.message : 'Failed to recalculate summary',
    });
  }
});
