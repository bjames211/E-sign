import * as functions from 'firebase-functions/v1';
import * as admin from 'firebase-admin';
import Stripe from 'stripe';

// Initialize Stripe with test secret key
// In production, use environment variables
const stripe = new Stripe(process.env.STRIPE_SECRET_KEY || 'sk_test_placeholder', {
  apiVersion: '2023-10-16',
});

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
      }
    }

    // Create PaymentIntent
    const paymentIntent = await stripe.paymentIntents.create({
      amount,
      currency: 'usd',
      customer: customer?.id,
      metadata: {
        orderId: orderId || '',
        customerName: customerName || '',
      },
      automatic_payment_methods: {
        enabled: true,
      },
    });

    console.log(`Created PaymentIntent: ${paymentIntent.id} for $${amount / 100}`);

    res.status(200).json({
      clientSecret: paymentIntent.client_secret,
      paymentIntentId: paymentIntent.id,
    });
  } catch (error) {
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
      // Save the payment method for future charges
      payment_intent_data: {
        setup_future_usage: 'off_session',
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
    // Also accept "test" for testing
    const validCode = process.env.MANAGER_APPROVAL_CODE || 'BBD2024!';
    if (approvalCode !== validCode && approvalCode.toLowerCase() !== 'test') {
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

    // Update order with manual approval including proof file
    await orderRef.update({
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
    });

    // Check if order is now ready for manufacturer (signed + paid)
    if (orderData?.status === 'signed') {
      await orderRef.update({
        status: 'ready_for_manufacturer',
        readyForManufacturerAt: admin.firestore.FieldValue.serverTimestamp(),
      });
    }

    // Create PaymentRecord for the new payment system
    try {
      const depositRequired = orderData?.pricing?.deposit || 0;
      const paymentRecord = {
        orderId,
        orderNumber: orderData?.orderNumber || '',
        amount: amount,  // Use the provided payment amount
        method: paymentType,
        category: 'initial_deposit',
        status: 'approved',
        proofFile: {
          name: proofFile.name,
          storagePath: proofFile.storagePath,
          downloadUrl: proofFile.downloadUrl,
          size: proofFile.size || 0,
          type: proofFile.type || 'image/jpeg',
        },
        approvedBy: approvedBy || 'Manager',
        approvedAt: admin.firestore.FieldValue.serverTimestamp(),
        description: `Manual payment via ${paymentType}`,
        notes: notes || '',
        createdBy: approvedBy || 'Manager',
        createdAt: admin.firestore.FieldValue.serverTimestamp(),
        updatedAt: admin.firestore.FieldValue.serverTimestamp(),
      };
      await db.collection('payments').add(paymentRecord);
      console.log(`PaymentRecord created for order ${orderId} with amount $${amount}`);

      // Update order payment summary
      const paymentsQuery = await db
        .collection('payments')
        .where('orderId', '==', orderId)
        .get();

      let totalPaid = 0;
      let totalPending = 0;
      paymentsQuery.docs.forEach((doc) => {
        const payment = doc.data();
        if (payment.status === 'verified' || payment.status === 'approved') {
          totalPaid += payment.amount;
        } else if (payment.status === 'pending') {
          totalPending += payment.amount;
        }
      });

      await orderRef.update({
        paymentSummary: {
          totalPaid,
          totalPending,
          balance: depositRequired - totalPaid,
          paymentCount: paymentsQuery.docs.length,
          lastPaymentAt: admin.firestore.FieldValue.serverTimestamp(),
        },
      });
    } catch (paymentRecordError) {
      console.error('Error creating PaymentRecord:', paymentRecordError);
      // Don't fail if PaymentRecord creation fails
    }

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
 */
export const stripeWebhook = functions.https.onRequest(async (req, res) => {
  const sig = req.headers['stripe-signature'];
  const webhookSecret = process.env.STRIPE_WEBHOOK_SECRET;

  if (!sig) {
    res.status(400).send('Missing stripe-signature header');
    return;
  }

  let event: Stripe.Event;

  try {
    if (webhookSecret) {
      event = stripe.webhooks.constructEvent(req.rawBody, sig, webhookSecret);
    } else {
      // For testing without webhook signature verification
      event = req.body as Stripe.Event;
    }
  } catch (err) {
    console.error('Webhook signature verification failed:', err);
    res.status(400).send(`Webhook Error: ${err instanceof Error ? err.message : 'Unknown error'}`);
    return;
  }

  console.log(`Received Stripe webhook: ${event.type}`);

  try {
    const db = admin.firestore();
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

            // Build update object - include customer ID if available
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

            // Update payment status
            await orderRef.update(updateData);

            // Check if order is now ready for manufacturer (signed + paid)
            if (orderData?.status === 'signed') {
              await orderRef.update({
                status: 'ready_for_manufacturer',
                readyForManufacturerAt: admin.firestore.FieldValue.serverTimestamp(),
              });
              console.log(`Order ${orderId} is now ready for manufacturer`);
            }

            // Create PaymentRecord for the new payment system
            try {
              const paymentRecord = {
                orderId,
                orderNumber: orderData?.orderNumber || '',
                amount: paymentIntent.amount / 100,
                method: 'stripe',
                category: 'initial_deposit',
                status: 'verified',
                stripePaymentId: paymentIntent.id,
                stripeVerified: true,
                stripeAmount: paymentIntent.amount,
                stripeAmountDollars: paymentIntent.amount / 100,
                stripeStatus: 'succeeded',
                description: 'Automatic payment via Stripe',
                createdBy: 'stripe_webhook',
                createdAt: admin.firestore.FieldValue.serverTimestamp(),
                updatedAt: admin.firestore.FieldValue.serverTimestamp(),
              };
              await db.collection('payments').add(paymentRecord);
              console.log(`PaymentRecord created for order ${orderId}`);

              // Update order payment summary
              const paymentsQuery = await db
                .collection('payments')
                .where('orderId', '==', orderId)
                .get();

              let totalPaid = 0;
              let totalPending = 0;
              paymentsQuery.docs.forEach((doc) => {
                const payment = doc.data();
                if (payment.status === 'verified' || payment.status === 'approved') {
                  totalPaid += payment.amount;
                } else if (payment.status === 'pending') {
                  totalPending += payment.amount;
                }
              });

              const depositRequired = orderData?.pricing?.deposit || 0;
              await orderRef.update({
                paymentSummary: {
                  totalPaid,
                  totalPending,
                  balance: depositRequired - totalPaid,
                  paymentCount: paymentsQuery.docs.length,
                  lastPaymentAt: admin.firestore.FieldValue.serverTimestamp(),
                },
              });
            } catch (paymentRecordError) {
              console.error('Error creating PaymentRecord:', paymentRecordError);
              // Don't fail the webhook if PaymentRecord creation fails
            }
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
          } catch (pmError) {
            console.error('Error setting default payment method from session:', pmError);
          }
        }
        break;
      }

      default:
        console.log(`Unhandled event type: ${event.type}`);
    }

    res.status(200).json({ received: true });
  } catch (error) {
    console.error('Error processing webhook:', error);
    res.status(500).json({ error: 'Webhook processing failed' });
  }
});
