import * as functions from 'firebase-functions/v1';
import * as admin from 'firebase-admin';
import Stripe from 'stripe';
import { createLedgerEntry, updateOrderLedgerSummary } from './paymentLedgerFunctions';
import { createAuditEntry } from './paymentAuditFunctions';
import { stripe, STRIPE_WEBHOOK_SECRET, IS_LIVE_MODE, STRIPE_MODE } from './config/stripe';
import { isValidApprovalCode } from './config/approvalCode';
import { logPaymentEvent, logPaymentEventSync, createPaymentTimer } from './utils/paymentLogger';

interface CreatePaymentIntentRequest {
  amount: number; // in cents
  customerEmail: string;
  customerName: string;
  orderId?: string;
}

interface VerifyPaymentRequest {
  paymentId: string;
}

interface VerifyPaymentForOrderRequest {
  paymentId: string;
  expectedAmount: number; // Expected deposit amount in dollars
  orderId?: string;       // Current order ID (to exclude from duplicate check)
}

interface PaymentVerificationResult {
  verified: boolean;
  paymentAmount: number;         // Amount in cents (negative for refunds)
  paymentAmountDollars: number;  // Amount in dollars (negative for refunds)
  matchesDeposit: boolean;
  amountDifference: number;
  isUnique: boolean;
  duplicateOrderId?: string;
  stripeStatus: string;
  errorMessage?: string;
  stripeCustomerId?: string;     // Customer ID for future charges
  isRefund?: boolean;            // True if this is a refund
}

interface CreatePaymentLinkRequest {
  amount: number; // in cents
  customerEmail: string;
  customerName: string;
  orderId?: string;
}

/**
 * Create a PaymentIntent for "Pay Now" flow
 * Includes idempotency key to prevent duplicate charges on retries
 */
export const createPaymentIntent = functions.https.onRequest(async (req, res) => {
  // Enable CORS
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

  const timer = createPaymentTimer();

  try {
    const { amount, customerEmail, customerName, orderId } = req.body as CreatePaymentIntentRequest;

    if (!amount || amount <= 0) {
      res.status(400).json({ error: 'Invalid amount' });
      return;
    }

    // Create or retrieve Stripe customer
    let customer: Stripe.Customer | undefined;
    if (customerEmail) {
      const existingCustomers = await stripe.customers.list({
        email: customerEmail,
        limit: 1,
      });

      if (existingCustomers.data.length > 0) {
        customer = existingCustomers.data[0];
      } else {
        customer = await stripe.customers.create({
          email: customerEmail,
          name: customerName,
        });

        // Log customer creation
        logPaymentEventSync({
          action: 'customer_created',
          orderId,
          customerId: customer.id,
          status: 'success',
          metadata: { email: customerEmail },
        });
      }
    }

    // Generate idempotency key based on order ID and timestamp
    // This prevents duplicate charges if the same request is retried
    const idempotencyKey = orderId
      ? `pi-${orderId}-${Date.now()}`
      : `pi-${customerEmail || 'guest'}-${amount}-${Date.now()}`;

    // Create PaymentIntent with idempotency
    const paymentIntent = await stripe.paymentIntents.create(
      {
        amount,
        currency: 'usd',
        customer: customer?.id,
        metadata: {
          orderId: orderId || '',
          customerName: customerName || '',
          environment: IS_LIVE_MODE ? 'production' : 'test',
        },
        automatic_payment_methods: {
          enabled: true,
        },
        // Statement descriptor for card statements
        statement_descriptor: 'BBD ORDER',
      },
      {
        idempotencyKey,
      }
    );

    // Log success
    await logPaymentEvent({
      action: 'payment_intent_created',
      orderId,
      amount: amount / 100,
      stripeId: paymentIntent.id,
      customerId: customer?.id,
      status: 'success',
      duration: timer.stop(),
    });

    res.status(200).json({
      clientSecret: paymentIntent.client_secret,
      paymentIntentId: paymentIntent.id,
    });
  } catch (error) {
    // Log error
    await logPaymentEvent({
      action: 'payment_intent_created',
      orderId: req.body?.orderId,
      amount: req.body?.amount ? req.body.amount / 100 : undefined,
      status: 'error',
      error: error instanceof Error ? error.message : 'Unknown error',
      duration: timer.stop(),
    });

    console.error('Error creating PaymentIntent:', error);
    res.status(500).json({
      error: error instanceof Error ? error.message : 'Failed to create payment',
    });
  }
});

/**
 * Verify an existing payment (for "Already Paid" flow)
 */
export const verifyPayment = functions.https.onRequest(async (req, res) => {
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
    const { paymentId } = req.body as VerifyPaymentRequest;

    if (!paymentId) {
      res.status(400).json({ error: 'Payment ID is required' });
      return;
    }

    let verified = false;
    let amount = 0;
    let status = '';

    // Check if it's a PaymentIntent (pi_) or Charge (ch_)
    if (paymentId.startsWith('pi_')) {
      const paymentIntent = await stripe.paymentIntents.retrieve(paymentId);
      verified = paymentIntent.status === 'succeeded';
      amount = paymentIntent.amount;
      status = paymentIntent.status;
    } else if (paymentId.startsWith('ch_')) {
      const charge = await stripe.charges.retrieve(paymentId);
      verified = charge.paid && charge.status === 'succeeded';
      amount = charge.amount;
      status = charge.status;
    } else {
      res.status(400).json({
        error: 'Invalid payment ID format. Expected pi_xxx or ch_xxx',
      });
      return;
    }

    console.log(`Verified payment ${paymentId}: ${verified}, status: ${status}`);

    res.status(200).json({
      verified,
      amount: amount / 100,
      status,
      paymentId,
    });
  } catch (error) {
    console.error('Error verifying payment:', error);

    // Check if it's a Stripe "not found" error
    if (error instanceof Error && (error as { code?: string }).code === 'resource_missing') {
      res.status(404).json({
        verified: false,
        error: 'Payment not found',
      });
      return;
    }

    res.status(500).json({
      verified: false,
      error: error instanceof Error ? error.message : 'Failed to verify payment',
    });
  }
});

/**
 * Create a Payment Link for "Pay Later" flow
 * Now saves card for future use via Stripe Customer
 */
export const createPaymentLink = functions.https.onRequest(async (req, res) => {
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
    const { amount, customerEmail, customerName, orderId } = req.body as CreatePaymentLinkRequest;

    if (!amount || amount <= 0) {
      res.status(400).json({ error: 'Invalid amount' });
      return;
    }

    // Create or retrieve Stripe Customer for saving card
    let customerId: string | undefined;
    if (customerEmail) {
      const existingCustomers = await stripe.customers.list({
        email: customerEmail,
        limit: 1,
      });

      if (existingCustomers.data.length > 0) {
        customerId = existingCustomers.data[0].id;
        console.log(`Using existing Stripe customer: ${customerId}`);
      } else {
        const newCustomer = await stripe.customers.create({
          email: customerEmail,
          name: customerName,
          metadata: {
            orderId: orderId || '',
          },
        });
        customerId = newCustomer.id;
        console.log(`Created new Stripe customer: ${customerId}`);
      }
    }

    // Create a Price for the specific amount
    const price = await stripe.prices.create({
      unit_amount: amount,
      currency: 'usd',
      product_data: {
        name: `BBD Order Deposit${orderId ? ` - ${orderId}` : ''}`,
      },
    });

    // Create Payment Link with customer creation to save card for future use
    const paymentLinkOptions: Stripe.PaymentLinkCreateParams = {
      line_items: [
        {
          price: price.id,
          quantity: 1,
        },
      ],
      metadata: {
        orderId: orderId || '',
        customerName: customerName || '',
        customerEmail: customerEmail || '',
      },
      after_completion: {
        type: 'redirect',
        redirect: {
          url: process.env.PAYMENT_SUCCESS_URL || 'https://example.com/payment-success',
        },
      },
      // Save the payment method for future charges + embed orderId for webhook matching
      payment_intent_data: {
        setup_future_usage: 'off_session',
        metadata: {
          orderId: orderId || '',
          customerName: customerName || '',
          customerEmail: customerEmail || '',
          source: 'payment_link',
        },
      },
    };

    // If we have a customer ID, attach to them; otherwise create customer at checkout
    if (customerId) {
      // Note: Payment links don't support 'customer' directly, but we can use customer_creation
      // and the webhook will handle linking
    }
    // Always create customer if none exists (for saving card)
    paymentLinkOptions.customer_creation = 'always';

    const paymentLink = await stripe.paymentLinks.create(paymentLinkOptions);

    console.log(`Created Payment Link: ${paymentLink.id} for $${amount / 100} (will save card for future use)`);

    // Store payment link info in Firestore for tracking
    await db.collection('payment_links').add({
      paymentLinkId: paymentLink.id,
      url: paymentLink.url,
      amount: amount / 100,
      customerEmail,
      customerName,
      orderId,
      stripeCustomerId: customerId || null,
      status: 'pending',
      createdAt: admin.firestore.FieldValue.serverTimestamp(),
    });

    // If we created/found a customer, save it to the order now
    if (customerId && orderId) {
      try {
        await db.doc(`orders/${orderId}`).update({
          'payment.stripeCustomerId': customerId,
          updatedAt: admin.firestore.FieldValue.serverTimestamp(),
        });
        console.log(`Saved Stripe customer ${customerId} to order ${orderId}`);
      } catch (updateError) {
        console.error('Error saving customer ID to order:', updateError);
      }
    }

    res.status(200).json({
      url: paymentLink.url,
      paymentLinkId: paymentLink.id,
      customerId: customerId || null,
    });
  } catch (error) {
    console.error('Error creating Payment Link:', error);
    res.status(500).json({
      error: error instanceof Error ? error.message : 'Failed to create payment link',
    });
  }
});

/**
 * Generate a payment link for an underpaid order
 * Creates a Stripe Payment Link for the exact balance amount
 * Stores the link on the order and optionally sends email to customer
 */
export const generatePaymentLinkForUnderpaid = functions.https.onRequest(async (req, res) => {
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
    const { orderId, amount: overrideAmount, sendEmail, createdBy } = req.body;

    // Validate required fields
    if (!orderId) {
      res.status(400).json({ error: 'orderId is required' });
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
    const ledgerSummary = order?.ledgerSummary;

    // Check if order has a balance
    const balance = ledgerSummary?.balance || 0;
    if (balance <= 0) {
      res.status(400).json({
        error: `Order is not underpaid. Current balance: $${balance.toFixed(2)}`,
        balance,
        balanceStatus: ledgerSummary?.balanceStatus,
      });
      return;
    }

    // Use override amount or balance
    const paymentAmount = overrideAmount || balance;
    const amountInCents = Math.round(paymentAmount * 100);

    // Get customer info
    const customerEmail = order?.customer?.email;
    const customerName = `${order?.customer?.firstName || ''} ${order?.customer?.lastName || ''}`.trim();
    const orderNumber = order?.orderNumber || orderId;

    // Check if customer already has a Stripe customer ID
    let customerId = order?.payment?.stripeCustomerId;

    if (!customerId && customerEmail) {
      // Try to find existing customer
      const existingCustomers = await stripe.customers.list({
        email: customerEmail,
        limit: 1,
      });

      if (existingCustomers.data.length > 0) {
        customerId = existingCustomers.data[0].id;
      } else {
        // Create new customer
        const newCustomer = await stripe.customers.create({
          email: customerEmail,
          name: customerName,
          metadata: {
            orderId,
            orderNumber,
          },
        });
        customerId = newCustomer.id;
      }

      // Save customer ID to order
      await orderRef.update({
        'payment.stripeCustomerId': customerId,
      });
    }

    // Create a Price for the specific amount
    const price = await stripe.prices.create({
      unit_amount: amountInCents,
      currency: 'usd',
      product_data: {
        name: `Balance Payment - Order ${orderNumber}`,
      },
    });

    // Create Payment Link
    const paymentLink = await stripe.paymentLinks.create({
      line_items: [
        {
          price: price.id,
          quantity: 1,
        },
      ],
      metadata: {
        orderId,
        orderNumber,
        customerEmail: customerEmail || '',
        paymentType: 'balance_payment',
        originalBalance: balance.toString(),
      },
      after_completion: {
        type: 'redirect',
        redirect: {
          url: process.env.PAYMENT_SUCCESS_URL || `https://e-sign-27f9a.web.app/payment-success?order=${orderNumber}`,
        },
      },
      payment_intent_data: {
        setup_future_usage: 'off_session',
        metadata: {
          orderId,
          orderNumber,
          customerEmail: customerEmail || '',
        },
      },
      customer_creation: 'if_required',
    });

    // Store payment link on order
    await orderRef.update({
      'payment.stripePaymentLinkId': paymentLink.id,
      'payment.stripePaymentLinkUrl': paymentLink.url,
      'payment.paymentLinkCreatedAt': admin.firestore.FieldValue.serverTimestamp(),
      'payment.paymentLinkAmount': paymentAmount,
      updatedAt: admin.firestore.FieldValue.serverTimestamp(),
    });

    // Store payment link in payment_links collection for tracking
    await db.collection('payment_links').add({
      paymentLinkId: paymentLink.id,
      url: paymentLink.url,
      amount: paymentAmount,
      amountInCents,
      orderId,
      orderNumber,
      customerEmail: customerEmail || null,
      customerName: customerName || null,
      stripeCustomerId: customerId || null,
      type: 'balance_payment',
      originalBalance: balance,
      status: 'pending',
      createdAt: admin.firestore.FieldValue.serverTimestamp(),
      createdBy: createdBy || 'system',
    });

    console.log(`Payment link created for order ${orderNumber}: $${paymentAmount} - ${paymentLink.url}`);

    // Send email if requested
    let emailSent = false;
    if (sendEmail && customerEmail) {
      try {
        await db.collection('mail').add({
          to: customerEmail,
          message: {
            subject: `Payment Link for Order ${orderNumber}`,
            text: `
Hello ${customerName},

A balance of $${paymentAmount.toFixed(2)} is due for your order ${orderNumber}.

Please complete your payment using this secure link:
${paymentLink.url}

This link will remain active until payment is received.

Thank you,
BBD Team
            `.trim(),
            html: `
<p>Hello ${customerName},</p>

<p>A balance of <strong>$${paymentAmount.toFixed(2)}</strong> is due for your order <strong>${orderNumber}</strong>.</p>

<p><a href="${paymentLink.url}" style="background-color: #1565c0; color: white; padding: 12px 24px; text-decoration: none; border-radius: 4px; display: inline-block;">Complete Payment</a></p>

<p>Or copy this link: ${paymentLink.url}</p>

<p>This link will remain active until payment is received.</p>

<p>Thank you,<br>BBD Team</p>
            `.trim(),
          },
          createdAt: admin.firestore.FieldValue.serverTimestamp(),
        });
        emailSent = true;
        console.log(`Payment link email sent to ${customerEmail}`);
      } catch (emailError) {
        console.error('Failed to send payment link email:', emailError);
      }
    }

    res.status(200).json({
      success: true,
      paymentLinkUrl: paymentLink.url,
      paymentLinkId: paymentLink.id,
      amount: paymentAmount,
      originalBalance: balance,
      emailSent,
      customerId,
    });
  } catch (error) {
    console.error('Error generating payment link:', error);
    res.status(500).json({
      error: error instanceof Error ? error.message : 'Failed to generate payment link',
    });
  }
});

/**
 * Comprehensive payment verification for orders
 * - Verifies payment exists and succeeded in Stripe
 * - Checks if payment amount matches expected deposit
 * - Checks if payment ID is unique (not used by another order)
 */
export const verifyPaymentForOrder = functions.https.onRequest(async (req, res) => {
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
    const { paymentId, expectedAmount, orderId } = req.body as VerifyPaymentForOrderRequest;

    if (!paymentId) {
      res.status(400).json({ error: 'Payment ID is required' });
      return;
    }

    if (!expectedAmount || expectedAmount <= 0) {
      res.status(400).json({ error: 'Expected amount is required' });
      return;
    }

    const result: PaymentVerificationResult = {
      verified: false,
      paymentAmount: 0,
      paymentAmountDollars: 0,
      matchesDeposit: false,
      amountDifference: 0,
      isUnique: true,
      stripeStatus: 'unknown',
    };

    // Detect ID type
    const isPaymentIntent = paymentId.startsWith('pi_');
    const isCharge = paymentId.startsWith('ch_');
    const isRefund = paymentId.startsWith('re_');

    // 1. Verify payment/refund exists in Stripe and get details
    try {
      if (isPaymentIntent) {
        const paymentIntent = await stripe.paymentIntents.retrieve(paymentId);
        result.verified = paymentIntent.status === 'succeeded';
        result.paymentAmount = paymentIntent.amount;
        result.stripeStatus = paymentIntent.status;
        // Get customer ID for future charges
        if (paymentIntent.customer) {
          result.stripeCustomerId = paymentIntent.customer as string;
        }
      } else if (isCharge) {
        const charge = await stripe.charges.retrieve(paymentId);
        result.verified = charge.paid && charge.status === 'succeeded';
        result.paymentAmount = charge.amount;
        result.stripeStatus = charge.status;
        // Get customer ID for future charges
        if (charge.customer) {
          result.stripeCustomerId = charge.customer as string;
        }
      } else if (isRefund) {
        const refund = await stripe.refunds.retrieve(paymentId);
        result.verified = refund.status === 'succeeded';
        result.paymentAmount = -refund.amount; // Negative for refunds
        result.stripeStatus = refund.status || 'unknown';
        result.isRefund = true;
      } else {
        result.errorMessage = 'Invalid Stripe ID format. Expected pi_xxx, ch_xxx, or re_xxx';
        res.status(200).json(result);
        return;
      }
    } catch (stripeError) {
      if (stripeError instanceof Error && (stripeError as { code?: string }).code === 'resource_missing') {
        result.errorMessage = 'Payment not found in Stripe';
      } else {
        result.errorMessage = stripeError instanceof Error ? stripeError.message : 'Failed to verify with Stripe';
      }
      res.status(200).json(result);
      return;
    }

    // Convert to dollars
    result.paymentAmountDollars = result.paymentAmount / 100;

    // 2. Check if amount matches expected deposit (allow $1 tolerance)
    result.amountDifference = Math.abs(result.paymentAmountDollars - expectedAmount);
    result.matchesDeposit = result.amountDifference <= 1;

    if (!result.matchesDeposit) {
      result.errorMessage = `Payment amount ($${result.paymentAmountDollars}) does not match expected deposit ($${expectedAmount})`;
    }

    // 3. Check if payment ID is already used by another order that is ready for manufacturer
    // Only orders that have reached "ready_for_manufacturer" are considered as having "used" the payment
    const existingOrdersQuery = await db
      .collection('orders')
      .where('payment.stripePaymentId', '==', paymentId)
      .limit(10)
      .get();

    // Filter out the current order and only consider orders that are ready_for_manufacturer
    const otherOrders = existingOrdersQuery.docs.filter(doc => {
      if (doc.id === orderId) return false;
      const orderData = doc.data();
      return orderData.status === 'ready_for_manufacturer';
    });

    if (otherOrders.length > 0) {
      result.isUnique = false;
      result.duplicateOrderId = otherOrders[0].id;
      const duplicateOrder = otherOrders[0].data();
      result.errorMessage = `Payment ID already used by order ${duplicateOrder.orderNumber || otherOrders[0].id}`;
    }

    console.log(`Payment verification for ${paymentId}:`, {
      verified: result.verified,
      amount: result.paymentAmountDollars,
      matchesDeposit: result.matchesDeposit,
      isUnique: result.isUnique,
    });

    res.status(200).json(result);
  } catch (error) {
    console.error('Error verifying payment for order:', error);
    res.status(500).json({
      verified: false,
      paymentAmount: 0,
      paymentAmountDollars: 0,
      matchesDeposit: false,
      amountDifference: 0,
      isUnique: false,
      stripeStatus: 'error',
      errorMessage: error instanceof Error ? error.message : 'Verification failed',
    });
  }
});

/**
 * Approve manual payment (check, wire, credit on file, other)
 * Requires manager approval code
 */
export const approveManualPayment = functions.https.onRequest(async (req, res) => {
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
    const { orderId, approvalCode, approvedBy, notes, proofFile, amount } = req.body;

    if (!orderId) {
      res.status(400).json({ error: 'Order ID is required' });
      return;
    }

    // Validate amount is provided
    if (amount === undefined || amount === null || amount <= 0) {
      res.status(400).json({ error: 'Payment amount is required' });
      return;
    }

    // Verify manager approval code
    if (!isValidApprovalCode(approvalCode)) {
      res.status(403).json({ error: 'Invalid manager approval code' });
      return;
    }

    // Get the order
    const orderRef = db.doc(`orders/${orderId}`);
    const orderSnap = await orderRef.get();

    if (!orderSnap.exists) {
      res.status(404).json({ error: 'Order not found' });
      return;
    }

    const orderData = orderSnap.data();
    const paymentType = orderData?.payment?.type;

    // Verify this is a manual payment type
    const manualTypes = ['check', 'wire', 'credit_on_file', 'other'];
    if (!manualTypes.includes(paymentType)) {
      res.status(400).json({ error: 'This payment type does not require manual approval' });
      return;
    }

    // REQUIRE proof file for manual payment approval
    if (!proofFile || !proofFile.downloadUrl) {
      res.status(400).json({
        error: 'Proof file is required for manual payment approval (check photo, wire confirmation, etc.)',
      });
      return;
    }

    // CRITICAL: Create ledger entry FIRST (source of truth), then update order
    await createLedgerEntry({
      orderId,
      orderNumber: orderData?.orderNumber || '',
      transactionType: 'payment',
      amount: amount,
      method: paymentType as any,
      category: 'initial_deposit',
      status: 'approved',
      description: `Manual payment via ${paymentType}`,
      notes: notes || undefined,
      proofFile: {
        name: proofFile.name,
        storagePath: proofFile.storagePath,
        downloadUrl: proofFile.downloadUrl,
        size: proofFile.size || 0,
        type: proofFile.type || 'image/jpeg',
      },
      approvedBy: approvedBy || 'Manager',
      createdBy: approvedBy || 'Manager',
    }, db);

    // Now update order - single atomic update combining payment status + order status
    const manualUpdateData: Record<string, unknown> = {
      'payment.status': 'manually_approved',
      'payment.manualApproval': {
        approved: true,
        approvedBy: approvedBy || 'Manager',
        approvedAt: admin.firestore.FieldValue.serverTimestamp(),
        notes: notes || '',
        proofFile: {
          name: proofFile.name,
          storagePath: proofFile.storagePath,
          downloadUrl: proofFile.downloadUrl,
          size: proofFile.size || 0,
          type: proofFile.type || 'image/jpeg',
          uploadedAt: admin.firestore.FieldValue.serverTimestamp(),
        },
      },
      needsPaymentApproval: false,
      paidAt: admin.firestore.FieldValue.serverTimestamp(),
      updatedAt: admin.firestore.FieldValue.serverTimestamp(),
    };

    // Check if order is now ready for manufacturer (signed + paid) - combine into single update
    if (orderData?.status === 'signed') {
      manualUpdateData.status = 'ready_for_manufacturer';
      manualUpdateData.readyForManufacturerAt = admin.firestore.FieldValue.serverTimestamp();
    }

    await orderRef.update(manualUpdateData);

    // Update order's ledger summary
    await updateOrderLedgerSummary(orderId, db);
    console.log(`Ledger entry created for manual payment on order ${orderId}`);

    console.log(`Manual payment approved for order ${orderId}`);

    res.status(200).json({
      success: true,
      message: 'Payment manually approved',
      orderId,
    });
  } catch (error) {
    console.error('Error approving manual payment:', error);
    res.status(500).json({
      error: error instanceof Error ? error.message : 'Failed to approve payment',
    });
  }
});

/**
 * Stripe webhook handler for payment events
 * Uses stripeEvents collection for idempotency (prevent duplicate processing)
 *
 * Security:
 * - Signature verification is MANDATORY in live mode
 * - Mode mismatch detection (event.livemode vs IS_LIVE_MODE)
 * - Idempotency checking to prevent duplicate processing
 */
export const stripeWebhook = functions.https.onRequest(async (req, res) => {
  const sig = req.headers['stripe-signature'];

  // Log webhook received (before signature verification)
  logPaymentEventSync({
    action: 'webhook_received',
    status: 'info',
    metadata: { hasSignature: !!sig, mode: STRIPE_MODE },
  });

  // MANDATORY signature verification in live mode
  if (!STRIPE_WEBHOOK_SECRET) {
    if (IS_LIVE_MODE) {
      // CRITICAL: Cannot process webhooks without signature verification in production
      console.error('CRITICAL: Missing webhook secret in LIVE mode');
      await logPaymentEvent({
        action: 'webhook_failed',
        status: 'error',
        error: 'Missing webhook secret in live mode - refusing to process',
      });
      res.status(500).send('Webhook not configured for production');
      return;
    }
    console.warn('Warning: Webhook secret not configured (test mode only)');
  }

  if (!sig) {
    await logPaymentEvent({
      action: 'signature_verification_failed',
      status: 'error',
      error: 'Missing stripe-signature header',
    });
    res.status(400).send('Missing stripe-signature header');
    return;
  }

  let event: Stripe.Event;

  try {
    if (STRIPE_WEBHOOK_SECRET) {
      event = stripe.webhooks.constructEvent(req.rawBody, sig, STRIPE_WEBHOOK_SECRET);
    } else {
      // For testing only - never in production (blocked above)
      event = req.body as Stripe.Event;
    }
  } catch (err) {
    await logPaymentEvent({
      action: 'signature_verification_failed',
      status: 'error',
      error: err instanceof Error ? err.message : 'Unknown signature verification error',
    });
    console.error('Webhook signature verification failed:', err);
    res.status(400).send(`Webhook Error: ${err instanceof Error ? err.message : 'Unknown error'}`);
    return;
  }

  // Verify event livemode matches our configuration
  if (event.livemode !== IS_LIVE_MODE) {
    await logPaymentEvent({
      action: 'mode_mismatch',
      stripeEventId: event.id,
      status: 'error',
      error: `Mode mismatch: event.livemode=${event.livemode}, IS_LIVE_MODE=${IS_LIVE_MODE}`,
      metadata: { eventType: event.type },
    });
    console.error(`Mode mismatch: event.livemode=${event.livemode}, IS_LIVE_MODE=${IS_LIVE_MODE}`);
    res.status(400).send('Mode mismatch - event mode does not match server mode');
    return;
  }

  console.log(`Received Stripe webhook: ${event.type} (${IS_LIVE_MODE ? 'LIVE' : 'TEST'} mode)`);

  // Idempotency check - prevent duplicate event processing
  // Uses a transaction to atomically check-and-set, preventing race conditions
  const db = admin.firestore();
  const eventRef = db.collection('stripeEvents').doc(event.id);

  try {
    const isNewEvent = await db.runTransaction(async (transaction) => {
      const existingEvent = await transaction.get(eventRef);
      if (existingEvent.exists) {
        return false; // Already processed
      }
      // Atomically mark as processing - no other instance can pass this check
      transaction.set(eventRef, {
        eventId: event.id,
        eventType: event.type,
        receivedAt: admin.firestore.FieldValue.serverTimestamp(),
        status: 'processing',
        livemode: event.livemode,
        mode: IS_LIVE_MODE ? 'live' : 'test',
      });
      return true;
    });

    if (!isNewEvent) {
      logPaymentEventSync({
        action: 'webhook_duplicate',
        stripeEventId: event.id,
        status: 'info',
        metadata: { eventType: event.type },
      });
      console.log(`Stripe event ${event.id} already processed, skipping`);
      res.status(200).json({ received: true, duplicate: true });
      return;
    }
  } catch (idempotencyError) {
    // If transaction fails, another instance is processing this event
    console.warn('Idempotency transaction failed (likely concurrent processing):', idempotencyError);
    res.status(200).json({ received: true, duplicate: true });
    return;
  }

  const webhookTimer = createPaymentTimer();

  try {
    switch (event.type) {
      case 'payment_intent.succeeded': {
        const paymentIntent = event.data.object as Stripe.PaymentIntent;
        console.log(`PaymentIntent ${paymentIntent.id} succeeded for $${paymentIntent.amount / 100}`);

        // Get customer ID if available (for future charges)
        const stripeCustomerId = paymentIntent.customer as string | null;

        // If we have a payment method and customer, save it as default for future use
        if (stripeCustomerId && paymentIntent.payment_method) {
          try {
            await stripe.customers.update(stripeCustomerId, {
              invoice_settings: {
                default_payment_method: paymentIntent.payment_method as string,
              },
            });
            console.log(`Set default payment method for customer ${stripeCustomerId}`);
          } catch (pmError) {
            console.error('Error setting default payment method:', pmError);
          }
        }

        // Update order if orderId is in metadata
        const orderId = paymentIntent.metadata?.orderId;
        if (orderId) {
          const orderRef = db.doc(`orders/${orderId}`);
          const orderSnap = await orderRef.get();

          if (orderSnap.exists) {
            const orderData = orderSnap.data();

            // CRITICAL: Create ledger entry FIRST (source of truth), then update order
            // This ensures we never have "paid" order with no ledger entry
            const { entryId, paymentNumber } = await createLedgerEntry({
              orderId,
              orderNumber: orderData?.orderNumber || '',
              transactionType: 'payment',
              amount: paymentIntent.amount / 100,
              method: 'stripe',
              category: 'initial_deposit',
              status: 'verified',
              stripePaymentId: paymentIntent.id,
              stripeVerified: true,
              stripeAmount: paymentIntent.amount,
              stripeAmountDollars: paymentIntent.amount / 100,
              description: 'Automatic payment via Stripe',
              createdBy: 'stripe_webhook',
              skipAudit: true, // We'll create custom audit entry with stripe event ID
            }, db);

            // Create audit entry with Stripe event ID
            try {
              await createAuditEntry({
                ledgerEntryId: entryId,
                paymentNumber,
                orderId,
                orderNumber: orderData?.orderNumber || '',
                action: 'verified',
                newStatus: 'verified',
                userId: 'stripe_webhook',
                details: `Verified via Stripe webhook (PaymentIntent: ${paymentIntent.id})`,
                stripeEventId: event.id,
              }, db);
            } catch (auditErr) {
              console.error('Failed to create audit entry:', auditErr);
            }

            // Now update order - single atomic update combining payment status + order status
            const updateData: Record<string, unknown> = {
              'payment.stripePaymentId': paymentIntent.id,
              'payment.status': 'paid',
              'payment.stripeVerification': {
                verified: true,
                verifiedAt: admin.firestore.FieldValue.serverTimestamp(),
                paymentAmount: paymentIntent.amount,
                paymentAmountDollars: paymentIntent.amount / 100,
                matchesDeposit: true,
                isUnique: true,
                stripeStatus: 'succeeded',
              },
              paidAt: admin.firestore.FieldValue.serverTimestamp(),
              needsPaymentApproval: false,
              updatedAt: admin.firestore.FieldValue.serverTimestamp(),
            };

            // Save customer ID for future card-on-file charges
            if (stripeCustomerId) {
              updateData['payment.stripeCustomerId'] = stripeCustomerId;
              console.log(`Saving Stripe customer ${stripeCustomerId} to order ${orderId}`);
            }

            // Check if order is now ready for manufacturer (signed + paid) - combine into single update
            if (orderData?.status === 'signed') {
              updateData.status = 'ready_for_manufacturer';
              updateData.readyForManufacturerAt = admin.firestore.FieldValue.serverTimestamp();
              console.log(`Order ${orderId} is now ready for manufacturer`);
            }

            await orderRef.update(updateData);

            // Update order's ledger summary
            await updateOrderLedgerSummary(orderId, db);
            console.log(`Ledger entry ${paymentNumber} created and verified for order ${orderId}`);
          }
        }
        break;
      }

      case 'checkout.session.completed': {
        const session = event.data.object as Stripe.Checkout.Session;
        console.log(`Checkout session ${session.id} completed`);

        // Get customer ID from session (created or existing)
        const sessionCustomerId = session.customer as string | null;
        const sessionOrderId = session.metadata?.orderId;

        // Update payment link status
        const paymentLinksQuery = await db
          .collection('payment_links')
          .where('paymentLinkId', '==', session.payment_link)
          .limit(1)
          .get();

        if (!paymentLinksQuery.empty) {
          const updateData: Record<string, unknown> = {
            status: 'completed',
            sessionId: session.id,
            completedAt: admin.firestore.FieldValue.serverTimestamp(),
          };
          if (sessionCustomerId) {
            updateData.stripeCustomerId = sessionCustomerId;
          }
          await paymentLinksQuery.docs[0].ref.update(updateData);

          // Get orderId from payment link if not in session metadata
          const paymentLinkData = paymentLinksQuery.docs[0].data();
          const orderIdToUpdate = sessionOrderId || paymentLinkData.orderId;

          // Save customer ID to order for future card-on-file charges
          if (sessionCustomerId && orderIdToUpdate) {
            try {
              await db.doc(`orders/${orderIdToUpdate}`).update({
                'payment.stripeCustomerId': sessionCustomerId,
                updatedAt: admin.firestore.FieldValue.serverTimestamp(),
              });
              console.log(`Saved Stripe customer ${sessionCustomerId} to order ${orderIdToUpdate} from checkout session`);
            } catch (updateError) {
              console.error('Error saving customer ID to order from session:', updateError);
            }
          }
        }

        // Also try to save customer to order directly from session metadata
        if (sessionCustomerId && sessionOrderId && paymentLinksQuery.empty) {
          try {
            await db.doc(`orders/${sessionOrderId}`).update({
              'payment.stripeCustomerId': sessionCustomerId,
              updatedAt: admin.firestore.FieldValue.serverTimestamp(),
            });
            console.log(`Saved Stripe customer ${sessionCustomerId} to order ${sessionOrderId} from checkout session (direct)`);
          } catch (updateError) {
            console.error('Error saving customer ID to order:', updateError);
          }
        }

        // If we have the payment intent, set the default payment method on the customer
        if (sessionCustomerId && session.payment_intent) {
          try {
            const paymentIntent = await stripe.paymentIntents.retrieve(session.payment_intent as string);
            if (paymentIntent.payment_method) {
              await stripe.customers.update(sessionCustomerId, {
                invoice_settings: {
                  default_payment_method: paymentIntent.payment_method as string,
                },
              });
              console.log(`Set default payment method for customer ${sessionCustomerId} from checkout session`);
            }

            // FALLBACK: If PaymentIntent doesn't have orderId in metadata but we know it from
            // the payment link or session, ensure the order gets updated and ledger entry created.
            // This handles the case where payment_intent.succeeded fires but can't find the orderId.
            const piOrderId = paymentIntent.metadata?.orderId;
            const fallbackOrderId = sessionOrderId || paymentLinksQuery.docs[0]?.data()?.orderId;

            if (!piOrderId && fallbackOrderId && paymentIntent.status === 'succeeded') {
              console.log(`Checkout session fallback: Creating ledger entry for order ${fallbackOrderId} from session`);

              // Check if ledger entry already exists for this PaymentIntent
              const existingLedger = await db.collection('payment_ledger')
                .where('stripePaymentId', '==', paymentIntent.id)
                .limit(1)
                .get();

              if (existingLedger.empty) {
                const fallbackOrderRef = db.doc(`orders/${fallbackOrderId}`);
                const fallbackOrderSnap = await fallbackOrderRef.get();
                const fallbackOrderData = fallbackOrderSnap.data();

                if (fallbackOrderSnap.exists && fallbackOrderData) {
                  // Create ledger entry
                  await createLedgerEntry({
                    orderId: fallbackOrderId,
                    orderNumber: fallbackOrderData.orderNumber || '',
                    transactionType: 'payment',
                    amount: paymentIntent.amount / 100,
                    method: 'stripe',
                    category: 'initial_deposit',
                    status: 'verified',
                    stripePaymentId: paymentIntent.id,
                    stripeVerified: true,
                    stripeAmount: paymentIntent.amount,
                    stripeAmountDollars: paymentIntent.amount / 100,
                    description: 'Payment via Payment Link (checkout session fallback)',
                    createdBy: 'stripe_webhook',
                  }, db);

                  // Update order payment status
                  const fallbackUpdate: Record<string, unknown> = {
                    'payment.stripePaymentId': paymentIntent.id,
                    'payment.status': 'paid',
                    paidAt: admin.firestore.FieldValue.serverTimestamp(),
                    needsPaymentApproval: false,
                    updatedAt: admin.firestore.FieldValue.serverTimestamp(),
                  };

                  if (fallbackOrderData.status === 'signed') {
                    fallbackUpdate.status = 'ready_for_manufacturer';
                    fallbackUpdate.readyForManufacturerAt = admin.firestore.FieldValue.serverTimestamp();
                  }

                  await fallbackOrderRef.update(fallbackUpdate);
                  await updateOrderLedgerSummary(fallbackOrderId, db);
                  console.log(`Checkout session fallback: Order ${fallbackOrderId} updated with payment`);
                }
              }
            }
          } catch (pmError) {
            console.error('Error in checkout session post-processing:', pmError);
            // Re-throw so the webhook returns 500 and Stripe retries
            // This prevents silently losing payments when the fallback ledger creation fails
            throw pmError;
          }
        }
        break;
      }

      case 'payment_intent.payment_failed': {
        const failedPaymentIntent = event.data.object as Stripe.PaymentIntent;
        console.log(`PaymentIntent ${failedPaymentIntent.id} failed`);

        const failedOrderId = failedPaymentIntent.metadata?.orderId;

        await logPaymentEvent({
          action: 'payment_intent_failed',
          orderId: failedOrderId,
          stripeId: failedPaymentIntent.id,
          stripeEventId: event.id,
          amount: failedPaymentIntent.amount / 100,
          status: 'error',
          error: failedPaymentIntent.last_payment_error?.message || 'Payment failed',
          metadata: {
            errorCode: failedPaymentIntent.last_payment_error?.code,
            errorType: failedPaymentIntent.last_payment_error?.type,
          },
        });

        // Update order if linked
        if (failedOrderId) {
          try {
            await db.doc(`orders/${failedOrderId}`).update({
              'payment.lastFailure': {
                timestamp: admin.firestore.FieldValue.serverTimestamp(),
                paymentIntentId: failedPaymentIntent.id,
                error: failedPaymentIntent.last_payment_error?.message || 'Payment failed',
                errorCode: failedPaymentIntent.last_payment_error?.code,
              },
            });
          } catch (updateError) {
            console.error('Error updating order with payment failure:', updateError);
          }
        }
        break;
      }

      case 'charge.refunded': {
        const refundedCharge = event.data.object as Stripe.Charge;
        console.log(`Charge ${refundedCharge.id} was refunded`);

        // Extract order info from metadata
        const refundOrderId = refundedCharge.metadata?.orderId;
        const refundAmount = refundedCharge.amount_refunded / 100;

        await logPaymentEvent({
          action: 'charge_refunded',
          orderId: refundOrderId,
          stripeId: refundedCharge.id,
          stripeEventId: event.id,
          amount: refundAmount,
          status: 'success',
          metadata: {
            totalRefunded: refundedCharge.amount_refunded,
            refundCount: refundedCharge.refunds?.data?.length || 0,
          },
        });

        // Note: Actual ledger entry creation for refunds should be done through
        // the verifyStripeRefund endpoint to ensure proper manual verification
        break;
      }

      case 'charge.dispute.created': {
        const dispute = event.data.object as Stripe.Dispute;
        console.log(`Dispute ${dispute.id} created for charge ${dispute.charge}`);

        await logPaymentEvent({
          action: 'dispute_created',
          stripeId: dispute.id,
          stripeEventId: event.id,
          amount: dispute.amount / 100,
          status: 'warning',
          metadata: {
            chargeId: dispute.charge,
            reason: dispute.reason,
            status: dispute.status,
          },
        });

        // Disputes require manual handling - just log for now
        // Could send email notification to managers here
        break;
      }

      default:
        console.log(`Unhandled event type: ${event.type}`);
    }

    // Mark event as processed successfully
    try {
      await eventRef.update({
        status: 'processed',
        processedAt: admin.firestore.FieldValue.serverTimestamp(),
        processingTimeMs: webhookTimer.stop(),
      });
    } catch (updateError) {
      console.warn('Failed to update event status:', updateError);
    }

    // Log successful processing
    await logPaymentEvent({
      action: 'webhook_processed',
      stripeEventId: event.id,
      status: 'success',
      duration: webhookTimer.stop(),
      metadata: { eventType: event.type },
    });

    res.status(200).json({ received: true });
  } catch (error) {
    console.error('Error processing webhook:', error);

    // Log failure
    await logPaymentEvent({
      action: 'webhook_failed',
      stripeEventId: event.id,
      status: 'error',
      error: error instanceof Error ? error.message : 'Unknown error',
      duration: webhookTimer.stop(),
      metadata: { eventType: event.type },
    });

    // Mark event as failed
    try {
      await eventRef.update({
        status: 'failed',
        failedAt: admin.firestore.FieldValue.serverTimestamp(),
        error: error instanceof Error ? error.message : 'Unknown error',
        processingTimeMs: webhookTimer.stop(),
      });
    } catch (updateError) {
      console.warn('Failed to update event status:', updateError);
    }

    res.status(500).json({ error: 'Webhook processing failed' });
  }
});

/**
 * Verify a Stripe refund and create a ledger entry
 *
 * Workflow:
 * 1. Manager processes refund in Stripe Dashboard
 * 2. Manager copies refund ID (re_xxxxx)
 * 3. Manager enters refund ID in the app
 * 4. This endpoint verifies refund exists in Stripe
 * 5. Creates ledger entry with verified status
 * 6. Order balance updates automatically
 */
export const verifyStripeRefund = functions.https.onRequest(async (req, res) => {
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

  const timer = createPaymentTimer();

  try {
    const db = admin.firestore();
    const { refundId, orderId, orderNumber, amount: overrideAmount, createdBy, notes } = req.body;

    // Validate required fields
    if (!refundId) {
      res.status(400).json({ error: 'refundId is required' });
      return;
    }

    if (!orderId && !orderNumber) {
      res.status(400).json({ error: 'orderId or orderNumber is required' });
      return;
    }

    // Validate refund ID format
    if (!refundId.startsWith('re_')) {
      res.status(400).json({ error: 'Invalid refund ID format. Expected re_xxxxx' });
      return;
    }

    // Find order by ID or number
    let targetOrderId = orderId;
    let targetOrderNumber = orderNumber;

    if (!targetOrderId && orderNumber) {
      const ordersQuery = await db
        .collection('orders')
        .where('orderNumber', '==', orderNumber)
        .limit(1)
        .get();

      if (ordersQuery.empty) {
        res.status(404).json({ error: `Order ${orderNumber} not found` });
        return;
      }

      targetOrderId = ordersQuery.docs[0].id;
      targetOrderNumber = ordersQuery.docs[0].data().orderNumber;
    } else if (targetOrderId && !targetOrderNumber) {
      const orderDoc = await db.collection('orders').doc(targetOrderId).get();
      if (!orderDoc.exists) {
        res.status(404).json({ error: `Order ${targetOrderId} not found` });
        return;
      }
      targetOrderNumber = orderDoc.data()?.orderNumber || targetOrderId;
    }

    // Verify refund exists in Stripe
    let refund: Stripe.Refund;
    try {
      refund = await stripe.refunds.retrieve(refundId);
    } catch (stripeError) {
      await logPaymentEvent({
        action: 'refund_failed',
        orderId: targetOrderId,
        orderNumber: targetOrderNumber,
        stripeId: refundId,
        status: 'error',
        error: 'Refund not found in Stripe',
        duration: timer.stop(),
      });

      res.status(400).json({ error: 'Refund not found in Stripe. Please verify the refund ID.' });
      return;
    }

    // Verify refund succeeded
    if (refund.status !== 'succeeded') {
      res.status(400).json({
        error: `Refund status is "${refund.status}", not "succeeded". Cannot record incomplete refund.`,
        refundStatus: refund.status,
      });
      return;
    }

    // Check if this refund has already been recorded
    const existingEntries = await db
      .collection('payment_ledger')
      .where('stripePaymentId', '==', refundId)
      .limit(1)
      .get();

    if (!existingEntries.empty) {
      const existingEntry = existingEntries.docs[0].data();
      res.status(400).json({
        error: 'This refund has already been recorded in the ledger',
        existingEntryId: existingEntries.docs[0].id,
        existingPaymentNumber: existingEntry.paymentNumber,
      });
      return;
    }

    // Get actual amount from Stripe (convert from cents to dollars)
    const refundAmount = overrideAmount || (refund.amount / 100);

    // Create ledger entry for the verified refund
    const { entryId, paymentNumber } = await createLedgerEntry({
      orderId: targetOrderId,
      orderNumber: targetOrderNumber,
      transactionType: 'refund',
      amount: refundAmount,
      method: 'stripe',
      category: 'refund',
      status: 'verified',
      stripePaymentId: refundId,
      stripeVerified: true,
      stripeAmount: refund.amount,
      stripeAmountDollars: refund.amount / 100,
      description: `Stripe refund verified (${refundId})`,
      notes: notes || undefined,
      createdBy: createdBy || 'manager',
    }, db);

    // Update order's ledger summary
    await updateOrderLedgerSummary(targetOrderId, db);

    // Log success
    await logPaymentEvent({
      action: 'refund_verified',
      orderId: targetOrderId,
      orderNumber: targetOrderNumber,
      stripeId: refundId,
      amount: refundAmount,
      status: 'success',
      duration: timer.stop(),
      metadata: {
        ledgerEntryId: entryId,
        paymentNumber,
        stripeRefundStatus: refund.status,
      },
    });

    res.status(200).json({
      success: true,
      refundId,
      ledgerEntryId: entryId,
      paymentNumber,
      amount: refundAmount,
      stripeAmount: refund.amount / 100,
      message: `Refund verified and recorded as ${paymentNumber}`,
    });
  } catch (error) {
    await logPaymentEvent({
      action: 'refund_failed',
      orderId: req.body?.orderId,
      stripeId: req.body?.refundId,
      status: 'error',
      error: error instanceof Error ? error.message : 'Unknown error',
      duration: timer.stop(),
    });

    console.error('Refund verification failed:', error);
    res.status(500).json({
      error: error instanceof Error ? error.message : 'Refund verification failed',
    });
  }
});
