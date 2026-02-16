import * as functions from 'firebase-functions/v1';
import * as admin from 'firebase-admin';
import Stripe from 'stripe';

// Initialize Stripe
const stripe = new Stripe(process.env.STRIPE_SECRET_KEY || 'sk_test_placeholder', {
  apiVersion: '2023-10-16',
});

// ============================================================
// STRIPE RECONCILIATION TOOL
// ============================================================

interface ReconciliationEntry {
  orderId: string;
  orderNumber: string;
  entryId: string;
  entryType: 'payment' | 'refund';
  ledgerAmount: number;
  stripePaymentId?: string;
  stripeAmount?: number;
  stripeStatus?: string;
  status: 'matched' | 'mismatch' | 'missing_stripe' | 'missing_ledger';
  discrepancyAmount?: number;
  details?: string;
}

interface ReconciliationResult {
  totalOrders: number;
  totalEntries: number;
  matched: number;
  mismatched: number;
  missingStripe: number;
  missingLedger: number;
  totalDiscrepancy: number;
  entries: ReconciliationEntry[];
}

/**
 * Reconcile ledger entries with Stripe records
 * Compares payment_ledger entries with Stripe payment intents/charges
 */
export const reconcileLedgerWithStripe = functions.https.onRequest(async (req, res) => {
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
    const { orderId, startDate: _startDate, endDate: _endDate, limit: queryLimit } = req.body;

    const result: ReconciliationResult = {
      totalOrders: 0,
      totalEntries: 0,
      matched: 0,
      mismatched: 0,
      missingStripe: 0,
      missingLedger: 0,
      totalDiscrepancy: 0,
      entries: [],
    };

    // Build query for ledger entries
    let ledgerQuery = db.collection('payment_ledger')
      .where('method', '==', 'stripe')
      .where('status', 'in', ['verified', 'approved']);

    if (orderId) {
      ledgerQuery = ledgerQuery.where('orderId', '==', orderId);
    }

    const ledgerSnap = await ledgerQuery.get();
    const orderIds = new Set<string>();

    // Process each ledger entry with a Stripe payment ID
    for (const doc of ledgerSnap.docs) {
      const entry = doc.data();
      orderIds.add(entry.orderId);
      result.totalEntries++;

      const reconciliationEntry: ReconciliationEntry = {
        orderId: entry.orderId,
        orderNumber: entry.orderNumber,
        entryId: doc.id,
        entryType: entry.transactionType === 'refund' ? 'refund' : 'payment',
        ledgerAmount: entry.amount,
        stripePaymentId: entry.stripePaymentId,
        status: 'matched',
      };

      // Skip if no Stripe payment ID
      if (!entry.stripePaymentId) {
        reconciliationEntry.status = 'missing_stripe';
        reconciliationEntry.details = 'No Stripe payment ID recorded';
        result.missingStripe++;
        result.entries.push(reconciliationEntry);
        continue;
      }

      // Verify with Stripe
      try {
        let stripeAmount = 0;
        let stripeStatus = '';

        if (entry.stripePaymentId.startsWith('pi_')) {
          const paymentIntent = await stripe.paymentIntents.retrieve(entry.stripePaymentId);
          stripeAmount = paymentIntent.amount / 100;
          stripeStatus = paymentIntent.status;
        } else if (entry.stripePaymentId.startsWith('ch_')) {
          const charge = await stripe.charges.retrieve(entry.stripePaymentId);
          stripeAmount = charge.amount / 100;
          stripeStatus = charge.status;
        } else if (entry.stripePaymentId.startsWith('re_')) {
          const refund = await stripe.refunds.retrieve(entry.stripePaymentId);
          stripeAmount = refund.amount / 100;
          stripeStatus = refund.status || 'unknown';
        }

        reconciliationEntry.stripeAmount = stripeAmount;
        reconciliationEntry.stripeStatus = stripeStatus;

        // Compare amounts
        const discrepancy = Math.abs(entry.amount - stripeAmount);
        if (discrepancy > 0.01) {
          reconciliationEntry.status = 'mismatch';
          reconciliationEntry.discrepancyAmount = discrepancy;
          reconciliationEntry.details = `Ledger: $${entry.amount}, Stripe: $${stripeAmount}`;
          result.mismatched++;
          result.totalDiscrepancy += discrepancy;
        } else {
          result.matched++;
        }
      } catch (stripeError: any) {
        if (stripeError.code === 'resource_missing') {
          reconciliationEntry.status = 'missing_stripe';
          reconciliationEntry.details = 'Stripe record not found';
          result.missingStripe++;
        } else {
          reconciliationEntry.status = 'mismatch';
          reconciliationEntry.details = `Stripe error: ${stripeError.message}`;
          result.mismatched++;
        }
      }

      result.entries.push(reconciliationEntry);
    }

    result.totalOrders = orderIds.size;

    // Sort entries by status (issues first)
    result.entries.sort((a, b) => {
      const statusOrder = {
        mismatch: 0,
        missing_stripe: 1,
        missing_ledger: 2,
        matched: 3,
      };
      return statusOrder[a.status] - statusOrder[b.status];
    });

    // Apply limit if specified
    if (queryLimit && result.entries.length > queryLimit) {
      result.entries = result.entries.slice(0, queryLimit);
    }

    res.status(200).json({
      success: true,
      result,
    });
  } catch (error) {
    console.error('Error in reconciliation:', error);
    res.status(500).json({
      error: error instanceof Error ? error.message : 'Reconciliation failed',
    });
  }
});

/**
 * Find Stripe transactions that don't have corresponding ledger entries
 * Useful for detecting missed webhook events
 */
export const findMissingLedgerEntries = functions.https.onRequest(async (req, res) => {
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
    const { startDate, endDate, limit: queryLimit } = req.body;

    // Default to last 30 days if no date range specified
    const endTimestamp = endDate ? new Date(endDate) : new Date();
    const startTimestamp = startDate
      ? new Date(startDate)
      : new Date(endTimestamp.getTime() - 30 * 24 * 60 * 60 * 1000);

    // Get all Stripe payment intents in the date range
    const paymentIntents = await stripe.paymentIntents.list({
      created: {
        gte: Math.floor(startTimestamp.getTime() / 1000),
        lte: Math.floor(endTimestamp.getTime() / 1000),
      },
      limit: queryLimit || 100,
    });

    const missingEntries: Array<{
      stripeId: string;
      type: 'payment_intent' | 'charge' | 'refund';
      amount: number;
      status: string;
      createdAt: Date;
      orderId?: string;
      orderNumber?: string;
    }> = [];

    // Check each payment intent
    for (const pi of paymentIntents.data) {
      // Only check succeeded payments
      if (pi.status !== 'succeeded') continue;

      // Look for ledger entry with this Stripe ID
      const ledgerQuery = await db
        .collection('payment_ledger')
        .where('stripePaymentId', '==', pi.id)
        .limit(1)
        .get();

      if (ledgerQuery.empty) {
        missingEntries.push({
          stripeId: pi.id,
          type: 'payment_intent',
          amount: pi.amount / 100,
          status: pi.status,
          createdAt: new Date(pi.created * 1000),
          orderId: pi.metadata?.orderId,
          orderNumber: pi.metadata?.orderNumber,
        });
      }
    }

    res.status(200).json({
      success: true,
      dateRange: {
        start: startTimestamp.toISOString(),
        end: endTimestamp.toISOString(),
      },
      totalChecked: paymentIntents.data.length,
      missingCount: missingEntries.length,
      missingEntries,
    });
  } catch (error) {
    console.error('Error finding missing entries:', error);
    res.status(500).json({
      error: error instanceof Error ? error.message : 'Failed to find missing entries',
    });
  }
});

/**
 * Fix a single discrepancy by updating the ledger entry amount
 * Use with caution - only for verified corrections
 */
export const fixLedgerEntryAmount = functions.https.onRequest(async (req, res) => {
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
    const { entryId, correctAmount, reason, correctedBy } = req.body;

    if (!entryId) {
      res.status(400).json({ error: 'entryId is required' });
      return;
    }

    if (correctAmount === undefined || correctAmount < 0) {
      res.status(400).json({ error: 'correctAmount is required and must be non-negative' });
      return;
    }

    if (!reason) {
      res.status(400).json({ error: 'reason is required' });
      return;
    }

    if (!correctedBy) {
      res.status(400).json({ error: 'correctedBy is required' });
      return;
    }

    // Get the entry
    const entryRef = db.collection('payment_ledger').doc(entryId);
    const entrySnap = await entryRef.get();

    if (!entrySnap.exists) {
      res.status(404).json({ error: 'Ledger entry not found' });
      return;
    }

    const entry = entrySnap.data()!;
    const originalAmount = entry.amount;

    // Update the entry with correction
    await entryRef.update({
      amount: correctAmount,
      correctedAt: admin.firestore.FieldValue.serverTimestamp(),
      correctedBy,
      correctionReason: reason,
      originalAmount,
    });

    // Recalculate order's ledger summary
    const { updateOrderLedgerSummary } = await import('./paymentLedgerFunctions');
    const summary = await updateOrderLedgerSummary(entry.orderId, db);

    console.log(`Ledger entry ${entryId} corrected: $${originalAmount} -> $${correctAmount} by ${correctedBy}`);

    res.status(200).json({
      success: true,
      entryId,
      originalAmount,
      correctAmount,
      summary,
    });
  } catch (error) {
    console.error('Error fixing ledger entry:', error);
    res.status(500).json({
      error: error instanceof Error ? error.message : 'Failed to fix ledger entry',
    });
  }
});
