import * as functions from 'firebase-functions/v1';
import * as admin from 'firebase-admin';
import Stripe from 'stripe';
import { createLedgerEntry, updateOrderLedgerSummary } from './paymentLedgerFunctions';
import { stripe } from './config/stripe';

// ============================================================
// AUTOMATIC REFUND PROCESSING
// ============================================================

interface ProcessRefundRequest {
  orderId: string;
  amount?: number; // Optional partial refund, defaults to full overpayment
  reason?: string;
  createdBy: string;
}

interface RefundResult {
  success: boolean;
  refundId?: string;
  amount?: number;
  error?: string;
  ledgerEntryId?: string;
  paymentNumber?: string;
}

/**
 * Process a refund for an overpaid order
 * 1. Validates the order is overpaid
 * 2. Finds original Stripe payment(s)
 * 3. Issues Stripe refund
 * 4. Creates ledger entry
 * 5. Updates ledger summary
 */
export const processRefund = functions.https.onRequest(async (req, res) => {
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
    const { orderId, amount, reason, createdBy } = req.body as ProcessRefundRequest;

    // Validate required fields
    if (!orderId) {
      res.status(400).json({ error: 'orderId is required' });
      return;
    }

    if (!createdBy) {
      res.status(400).json({ error: 'createdBy is required' });
      return;
    }

    // 1. Get order and validate
    const orderDoc = await db.collection('orders').doc(orderId).get();
    if (!orderDoc.exists) {
      res.status(404).json({ success: false, error: 'Order not found' });
      return;
    }
    const order = orderDoc.data();

    // 2. Check balance (must be overpaid - balance < 0)
    const balance = order?.ledgerSummary?.balance || 0;
    if (balance >= 0) {
      res.status(400).json({
        success: false,
        error: `Order is not overpaid. Current balance: $${balance.toFixed(2)}`,
      });
      return;
    }

    // Calculate refund amount (default to full overpayment)
    const overpaidAmount = Math.abs(balance);
    const refundAmount = amount ? Math.min(amount, overpaidAmount) : overpaidAmount;

    if (refundAmount <= 0) {
      res.status(400).json({ success: false, error: 'Invalid refund amount' });
      return;
    }

    // 3. Find Stripe payment(s) to refund
    const paymentsQuery = await db
      .collection('payment_ledger')
      .where('orderId', '==', orderId)
      .where('transactionType', '==', 'payment')
      .where('method', '==', 'stripe')
      .get();

    // Get verified/approved payments with Stripe IDs
    interface PaymentLedgerData {
      id: string;
      stripePaymentId?: string;
      stripeAmount?: number;
      amount: number;
      status: string;
      [key: string]: unknown;
    }

    const stripePayments: PaymentLedgerData[] = paymentsQuery.docs
      .filter((doc) => {
        const data = doc.data();
        return (
          data.stripePaymentId &&
          (data.status === 'verified' || data.status === 'approved') &&
          !data.stripePaymentId.startsWith('test_')
        );
      })
      .map((doc) => ({
        id: doc.id,
        ...doc.data(),
      } as PaymentLedgerData));

    if (stripePayments.length === 0) {
      // No Stripe payments found - create manual refund entry
      console.log(`No Stripe payments found for order ${orderId}, creating manual refund entry`);

      const { entryId, paymentNumber } = await createLedgerEntry({
        orderId,
        orderNumber: order?.orderNumber || '',
        transactionType: 'refund',
        amount: refundAmount,
        method: 'other',
        category: 'refund',
        status: 'pending', // Manual refunds start as pending
        description: reason || 'Overpayment refund (manual processing required)',
        notes: 'No Stripe payment found - requires manual refund processing',
        createdBy,
      }, db);

      await updateOrderLedgerSummary(orderId, db);

      res.status(200).json({
        success: true,
        ledgerEntryId: entryId,
        paymentNumber,
        amount: refundAmount,
        message: 'Manual refund entry created (no Stripe payment to refund)',
        requiresManualProcessing: true,
      });
      return;
    }

    // 4. Process Stripe refund
    // Find the best payment to refund (prefer the one with enough balance)
    let refundResult: RefundResult = { success: false };
    let remainingRefund = Math.round(refundAmount * 100); // Convert to cents

    for (const payment of stripePayments) {
      if (remainingRefund <= 0) break;

      const paymentAmount = payment.stripeAmount || (payment.amount * 100);

      // Skip if no Stripe payment ID (shouldn't happen due to filter, but TypeScript needs this)
      const stripePaymentId = payment.stripePaymentId;
      if (!stripePaymentId) {
        console.log(`Skipping payment ${payment.id} - no Stripe payment ID`);
        continue;
      }

      // Check if payment has been partially refunded already
      // For simplicity, attempt to refund and let Stripe handle the validation
      const refundAmountCents = Math.min(remainingRefund, paymentAmount);

      try {
        // Determine refund type based on payment ID format
        let refund: Stripe.Refund;

        if (stripePaymentId.startsWith('pi_')) {
          refund = await stripe.refunds.create({
            payment_intent: stripePaymentId,
            amount: refundAmountCents,
            reason: 'requested_by_customer',
            metadata: {
              orderId,
              orderNumber: order?.orderNumber || '',
              originalPaymentLedgerEntryId: payment.id,
            },
          });
        } else if (stripePaymentId.startsWith('ch_')) {
          refund = await stripe.refunds.create({
            charge: stripePaymentId,
            amount: refundAmountCents,
            reason: 'requested_by_customer',
            metadata: {
              orderId,
              orderNumber: order?.orderNumber || '',
              originalPaymentLedgerEntryId: payment.id,
            },
          });
        } else {
          console.log(`Skipping payment ${stripePaymentId} - unknown ID format`);
          continue;
        }

        // 5. Create ledger entry for the refund
        const { entryId, paymentNumber } = await createLedgerEntry({
          orderId,
          orderNumber: order?.orderNumber || '',
          transactionType: 'refund',
          amount: refundAmountCents / 100,
          method: 'stripe',
          category: 'refund',
          status: refund.status === 'succeeded' ? 'verified' : 'pending',
          stripePaymentId: refund.id,
          stripeVerified: refund.status === 'succeeded',
          stripeAmount: refundAmountCents,
          stripeAmountDollars: refundAmountCents / 100,
          description: reason || 'Overpayment refund',
          notes: `Refunded from payment ${stripePaymentId}`,
          createdBy,
        }, db);

        remainingRefund -= refundAmountCents;

        refundResult = {
          success: true,
          refundId: refund.id,
          amount: refundAmountCents / 100,
          ledgerEntryId: entryId,
          paymentNumber,
        };

        console.log(`Refund ${refund.id} created: $${refundAmountCents / 100} for order ${orderId}`);
      } catch (stripeError) {
        console.error(`Failed to refund payment ${stripePaymentId}:`, stripeError);

        // Check for specific Stripe errors
        if (stripeError instanceof Error) {
          const stripeErr = stripeError as any;
          if (stripeErr.code === 'charge_already_refunded') {
            console.log(`Payment ${stripePaymentId} already fully refunded`);
            continue;
          }
          if (stripeErr.code === 'amount_too_large') {
            console.log(`Refund amount too large for payment ${stripePaymentId}`);
            continue;
          }
        }

        refundResult.error = stripeError instanceof Error ? stripeError.message : 'Stripe refund failed';
      }
    }

    // 6. Update ledger summary
    const summary = await updateOrderLedgerSummary(orderId, db);

    if (refundResult.success) {
      res.status(200).json({
        success: true,
        refundId: refundResult.refundId,
        amount: refundResult.amount,
        ledgerEntryId: refundResult.ledgerEntryId,
        summary,
      });
    } else {
      res.status(400).json({
        success: false,
        error: refundResult.error || 'Failed to process refund',
      });
    }
  } catch (error) {
    console.error('Error processing refund:', error);
    res.status(500).json({
      success: false,
      error: error instanceof Error ? error.message : 'Failed to process refund',
    });
  }
});

// ============================================================
// GET REFUNDABLE AMOUNT
// ============================================================

/**
 * Get the refundable amount for an order
 * Checks both the balance and available Stripe payments
 */
export const getRefundableAmount = functions.https.onRequest(async (req, res) => {
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

    // Get order
    const orderDoc = await db.collection('orders').doc(orderId).get();
    if (!orderDoc.exists) {
      res.status(404).json({ error: 'Order not found' });
      return;
    }

    const order = orderDoc.data();
    const balance = order?.ledgerSummary?.balance || 0;

    // If not overpaid, no refund possible
    if (balance >= 0) {
      res.status(200).json({
        isOverpaid: false,
        balance,
        refundableAmount: 0,
        stripeRefundable: 0,
        manualRefundRequired: 0,
        stripePayments: [],
      });
      return;
    }

    const overpaidAmount = Math.abs(balance);

    // Get Stripe payments
    const paymentsQuery = await db
      .collection('payment_ledger')
      .where('orderId', '==', orderId)
      .where('transactionType', '==', 'payment')
      .where('method', '==', 'stripe')
      .get();

    const stripePayments = paymentsQuery.docs
      .filter((doc) => {
        const data = doc.data();
        return (
          data.stripePaymentId &&
          (data.status === 'verified' || data.status === 'approved')
        );
      })
      .map((doc) => ({
        id: doc.id,
        stripePaymentId: doc.data().stripePaymentId,
        amount: doc.data().amount,
        stripeAmount: doc.data().stripeAmount,
      }));

    // Calculate total Stripe refundable
    const totalStripeAmount = stripePayments.reduce(
      (sum, p) => sum + (p.stripeAmount ? p.stripeAmount / 100 : p.amount),
      0
    );

    // Calculate how much can be refunded via Stripe vs manual
    const stripeRefundable = Math.min(overpaidAmount, totalStripeAmount);
    const manualRefundRequired = overpaidAmount - stripeRefundable;

    res.status(200).json({
      isOverpaid: true,
      balance,
      refundableAmount: overpaidAmount,
      stripeRefundable,
      manualRefundRequired,
      stripePayments,
    });
  } catch (error) {
    console.error('Error getting refundable amount:', error);
    res.status(500).json({
      error: error instanceof Error ? error.message : 'Failed to get refundable amount',
    });
  }
});

// ============================================================
// AUTO-REFUND OVERPAID ORDERS (Batch)
// ============================================================

/**
 * Find all overpaid orders and optionally process refunds
 * Use dryRun=true to just get a list without processing
 */
export const findOverpaidOrders = functions.https.onRequest(async (req, res) => {
  res.set('Access-Control-Allow-Origin', '*');
  res.set('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  res.set('Access-Control-Allow-Headers', 'Content-Type');

  if (req.method === 'OPTIONS') {
    res.status(204).send('');
    return;
  }

  try {
    const db = admin.firestore();
    const dryRun = req.query.dryRun !== 'false' && req.method === 'GET';

    // Query orders with negative balance (overpaid)
    // Note: Firestore can't query nested fields directly, so we'll fetch and filter
    const ordersQuery = await db
      .collection('orders')
      .where('ledgerSummary.balanceStatus', '==', 'overpaid')
      .get();

    const overpaidOrders = ordersQuery.docs.map((doc) => {
      const data = doc.data();
      return {
        id: doc.id,
        orderNumber: data.orderNumber,
        customerName: `${data.customer?.firstName || ''} ${data.customer?.lastName || ''}`.trim(),
        customerEmail: data.customer?.email,
        balance: data.ledgerSummary?.balance || 0,
        overpaidAmount: Math.abs(data.ledgerSummary?.balance || 0),
      };
    });

    if (dryRun) {
      res.status(200).json({
        dryRun: true,
        count: overpaidOrders.length,
        totalOverpaid: overpaidOrders.reduce((sum, o) => sum + o.overpaidAmount, 0),
        orders: overpaidOrders,
      });
      return;
    }

    // If not dry run, this would process refunds (POST only)
    if (req.method !== 'POST') {
      res.status(400).json({
        error: 'Use POST to process refunds, or GET with dryRun=true to preview',
      });
      return;
    }

    res.status(200).json({
      message: 'Batch refund processing not yet implemented for safety',
      count: overpaidOrders.length,
      orders: overpaidOrders,
    });
  } catch (error) {
    console.error('Error finding overpaid orders:', error);
    res.status(500).json({
      error: error instanceof Error ? error.message : 'Failed to find overpaid orders',
    });
  }
});
