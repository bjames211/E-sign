import * as functions from 'firebase-functions/v1';
import * as admin from 'firebase-admin';
import { createLedgerEntry, updateOrderLedgerSummary } from './paymentLedgerFunctions';

// ============================================================
// MIGRATION SCRIPT: Legacy Payments to Payment Ledger
// ============================================================

type LedgerTransactionType = 'payment' | 'refund' | 'deposit_increase' | 'deposit_decrease';
type LedgerEntryStatus = 'pending' | 'verified' | 'approved' | 'voided';
type LedgerCategory = 'initial_deposit' | 'additional_deposit' | 'refund' | 'change_order_adjustment';
type PaymentMethod = 'stripe' | 'check' | 'wire' | 'credit_on_file' | 'cash' | 'other';

interface MigrationResult {
  orderId: string;
  orderNumber: string;
  entriesCreated: number;
  errors: string[];
  skipped: boolean;
  skipReason?: string;
}

/**
 * Migrate a single order's payment data to the ledger system
 */
async function migrateOrderPayments(
  orderId: string,
  db: FirebaseFirestore.Firestore
): Promise<MigrationResult> {
  const result: MigrationResult = {
    orderId,
    orderNumber: '',
    entriesCreated: 0,
    errors: [],
    skipped: false,
  };

  try {
    // Get the order
    const orderSnap = await db.collection('orders').doc(orderId).get();
    if (!orderSnap.exists) {
      result.skipped = true;
      result.skipReason = 'Order not found';
      return result;
    }

    const orderData = orderSnap.data()!;
    result.orderNumber = orderData.orderNumber || orderId;

    // Check if already migrated (has ledger entries)
    const existingEntries = await db
      .collection('payment_ledger')
      .where('orderId', '==', orderId)
      .limit(1)
      .get();

    if (!existingEntries.empty) {
      result.skipped = true;
      result.skipReason = 'Already has ledger entries';
      return result;
    }

    const orderNumber = orderData.orderNumber || orderId;
    const originalDeposit = orderData.originalPricing?.deposit || orderData.pricing?.deposit || 0;

    // 1. Migrate legacy order.payment record
    if (orderData.payment) {
      const paymentStatus = orderData.payment.status;
      const paymentType = orderData.payment.type;
      const stripePaymentId = orderData.payment.stripePaymentId;

      // Check if payment was made (paid or manually_approved)
      if (paymentStatus === 'paid' || paymentStatus === 'manually_approved') {
        // Determine the payment method
        let method: PaymentMethod = 'other';
        if (paymentType?.includes('stripe')) {
          method = 'stripe';
        } else if (paymentType === 'check') {
          method = 'check';
        } else if (paymentType === 'wire') {
          method = 'wire';
        } else if (paymentType === 'credit_on_file') {
          method = 'credit_on_file';
        } else if (paymentType === 'cash') {
          method = 'cash';
        }

        // Determine amount - priority: stripe verification > current deposit > original deposit
        let amount = 0;
        if (orderData.payment.stripeVerification?.paymentAmountDollars) {
          // Use verified Stripe amount
          amount = orderData.payment.stripeVerification.paymentAmountDollars;
        } else if (orderData.pricing?.deposit) {
          // Use current deposit (may have been updated by change orders)
          amount = orderData.pricing.deposit;
        } else {
          // Fallback to original deposit
          amount = originalDeposit;
        }

        // Skip if no amount
        if (amount <= 0) {
          result.errors.push('Legacy payment has no amount');
        } else {
          try {
            await createLedgerEntry({
              orderId,
              orderNumber,
              transactionType: 'payment',
              amount,
              method,
              category: 'initial_deposit',
              status: paymentStatus === 'paid' ? 'verified' : 'approved',
              stripePaymentId: stripePaymentId || undefined,
              stripeVerified: method === 'stripe' && paymentStatus === 'paid',
              description: `Migrated from legacy payment (${paymentType || 'unknown'})`,
              createdBy: 'migration_script',
            }, db);
            result.entriesCreated++;
          } catch (entryError) {
            result.errors.push(`Failed to create legacy payment entry: ${entryError}`);
          }
        }
      }
    }

    // 2. Migrate test payment amount (if in test mode)
    if (orderData.isTestMode && orderData.testPaymentAmount && orderData.testPaymentAmount > 0) {
      // Check if already covered by the order.payment migration
      const hasLegacyPayment = orderData.payment?.status === 'paid' || orderData.payment?.status === 'manually_approved';

      if (!hasLegacyPayment) {
        try {
          await createLedgerEntry({
            orderId,
            orderNumber,
            transactionType: 'payment',
            amount: orderData.testPaymentAmount,
            method: 'stripe',
            category: 'initial_deposit',
            status: 'approved',
            description: 'Migrated test mode payment',
            createdBy: 'migration_script',
          }, db);
          result.entriesCreated++;
        } catch (entryError) {
          result.errors.push(`Failed to create test payment entry: ${entryError}`);
        }
      }
    }

    // 3. Migrate existing payments collection records
    const paymentsQuery = await db
      .collection('payments')
      .where('orderId', '==', orderId)
      .get();

    for (const paymentDoc of paymentsQuery.docs) {
      const payment = paymentDoc.data();

      // Skip if no amount or cancelled/failed
      if (!payment.amount || payment.status === 'cancelled' || payment.status === 'failed') {
        continue;
      }

      // Determine transaction type
      let transactionType: LedgerTransactionType = 'payment';
      if (payment.category === 'refund' || payment.amount < 0) {
        transactionType = 'refund';
      }

      // Determine status
      let status: LedgerEntryStatus = 'pending';
      if (payment.status === 'verified') {
        status = 'verified';
      } else if (payment.status === 'approved') {
        status = 'approved';
      }

      // Map category
      let category: LedgerCategory = 'additional_deposit';
      if (payment.category === 'initial_deposit') {
        category = 'initial_deposit';
      } else if (payment.category === 'refund') {
        category = 'refund';
      } else if (payment.category === 'change_order_deposit') {
        category = 'change_order_adjustment';
      }

      try {
        await createLedgerEntry({
          orderId,
          orderNumber,
          changeOrderId: payment.changeOrderId,
          changeOrderNumber: payment.changeOrderNumber,
          transactionType,
          amount: Math.abs(payment.amount),
          method: payment.method || 'other',
          category,
          status,
          stripePaymentId: payment.stripePaymentId,
          stripeVerified: payment.stripeVerified,
          stripeAmount: payment.stripeAmount,
          stripeAmountDollars: payment.stripeAmountDollars,
          description: payment.description || `Migrated from payments collection`,
          notes: payment.notes,
          proofFile: payment.proofFile,
          approvedBy: payment.approvedBy,
          createdBy: 'migration_script',
        }, db);
        result.entriesCreated++;
      } catch (entryError) {
        result.errors.push(`Failed to migrate payment ${paymentDoc.id}: ${entryError}`);
      }
    }

    // 4. Migrate change order deposit differences
    // Note: deposit_increase/decrease entries are ALWAYS created for signed change orders
    // These represent the change to what's OWED, separate from any refund payments
    const changeOrdersQuery = await db
      .collection('change_orders')
      .where('orderId', '==', orderId)
      .where('status', '==', 'signed')
      .get();

    for (const coDoc of changeOrdersQuery.docs) {
      const changeOrder = coDoc.data();

      // Check for deposit difference
      const depositDiff = changeOrder.differences?.depositDiff || 0;

      if (depositDiff !== 0) {
        const transactionType: LedgerTransactionType =
          depositDiff > 0 ? 'deposit_increase' : 'deposit_decrease';

        try {
          await createLedgerEntry({
            orderId,
            orderNumber,
            changeOrderId: coDoc.id,
            changeOrderNumber: changeOrder.changeOrderNumber,
            transactionType,
            amount: Math.abs(depositDiff),
            method: 'other',
            category: 'change_order_adjustment',
            status: 'approved',
            description: `Deposit adjustment from ${changeOrder.changeOrderNumber}: ${depositDiff > 0 ? '+' : ''}$${depositDiff}`,
            createdBy: 'migration_script',
          }, db);
          result.entriesCreated++;
        } catch (entryError) {
          result.errors.push(`Failed to create CO deposit entry: ${entryError}`);
        }
      }
    }

    // 5. Calculate and save ledger summary
    if (result.entriesCreated > 0 || result.errors.length === 0) {
      await updateOrderLedgerSummary(orderId, db);
    }

    console.log(`Migrated order ${orderNumber}: ${result.entriesCreated} entries created`);

  } catch (error) {
    result.errors.push(`Migration failed: ${error}`);
  }

  return result;
}

/**
 * HTTP endpoint to clear and re-migrate a single order to the ledger system
 * Use this to fix incorrect ledger data
 */
export const clearAndRemigrateLedger = functions.https.onRequest(async (req, res) => {
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
    const { orderId, orderNumber } = req.body;

    let targetOrderId = orderId;

    // Find by order number if provided
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
    }

    if (!targetOrderId) {
      res.status(400).json({ error: 'orderId or orderNumber is required' });
      return;
    }

    // 1. Delete existing ledger entries for this order
    const existingEntries = await db
      .collection('payment_ledger')
      .where('orderId', '==', targetOrderId)
      .get();

    const deletePromises = existingEntries.docs.map(doc => doc.ref.delete());
    await Promise.all(deletePromises);

    const deletedCount = existingEntries.size;

    // 2. Clear ledger summary from order
    await db.collection('orders').doc(targetOrderId).update({
      ledgerSummary: admin.firestore.FieldValue.delete()
    });

    // 3. Re-run migration
    const result = await migrateOrderPayments(targetOrderId, db);

    res.status(200).json({
      success: result.errors.length === 0,
      deletedEntries: deletedCount,
      result,
    });
  } catch (error) {
    console.error('Error clearing and re-migrating:', error);
    res.status(500).json({
      error: error instanceof Error ? error.message : 'Clear and re-migrate failed',
    });
  }
});

/**
 * HTTP endpoint to migrate a single order to the ledger system
 */
export const migrateOrderToLedger = functions.https.onRequest(async (req, res) => {
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
    const { orderId, orderNumber } = req.body;

    let targetOrderId = orderId;

    // Find by order number if provided
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
    }

    if (!targetOrderId) {
      res.status(400).json({ error: 'orderId or orderNumber is required' });
      return;
    }

    const result = await migrateOrderPayments(targetOrderId, db);

    if (result.skipped) {
      res.status(200).json({
        success: true,
        skipped: true,
        message: result.skipReason,
        result,
      });
      return;
    }

    res.status(200).json({
      success: result.errors.length === 0,
      result,
    });
  } catch (error) {
    console.error('Error migrating order:', error);
    res.status(500).json({
      error: error instanceof Error ? error.message : 'Migration failed',
    });
  }
});

/**
 * HTTP endpoint to migrate all orders to the ledger system
 */
/**
 * Force migrate legacy payments that weren't picked up by the standard migration
 * This handles edge cases where:
 * - order.payment exists but status isn't exactly 'paid' or 'manually_approved'
 * - Order shows as paid but ledger is empty
 * - Payment amount needs to be derived from pricing.deposit
 */
export const forceMigrateLegacyPayments = functions.https.onRequest(async (req, res) => {
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
    const { dryRun, orderNumber: specificOrder } = req.body;

    // Get orders - either specific one or all
    let ordersQuery: FirebaseFirestore.Query = db.collection('orders');

    if (specificOrder) {
      ordersQuery = ordersQuery.where('orderNumber', '==', specificOrder);
    }

    const ordersSnap = await ordersQuery.get();

    const results: Array<{
      orderId: string;
      orderNumber: string;
      action: string;
      amount?: number;
      method?: string;
      error?: string;
    }> = [];

    let migratedCount = 0;
    let skippedCount = 0;
    let errorCount = 0;

    for (const orderDoc of ordersSnap.docs) {
      const orderData = orderDoc.data();
      const orderId = orderDoc.id;
      const orderNum = orderData.orderNumber || orderId;

      // Check if order already has ledger entries
      const existingEntries = await db
        .collection('payment_ledger')
        .where('orderId', '==', orderId)
        .limit(1)
        .get();

      if (!existingEntries.empty) {
        results.push({
          orderId,
          orderNumber: orderNum,
          action: 'skipped',
          error: 'Already has ledger entries',
        });
        skippedCount++;
        continue;
      }

      // Check if order has any payment indication
      const hasPaymentData = orderData.payment && (
        orderData.payment.status ||
        orderData.payment.type ||
        orderData.payment.stripePaymentId ||
        orderData.paidAt
      );

      // Check if order has deposit info
      const depositAmount = orderData.pricing?.deposit || orderData.originalPricing?.deposit || 0;

      if (!hasPaymentData || depositAmount <= 0) {
        results.push({
          orderId,
          orderNumber: orderNum,
          action: 'skipped',
          error: 'No payment data or zero deposit',
        });
        skippedCount++;
        continue;
      }

      // Determine payment method
      const paymentType = orderData.payment?.type || '';
      let method: PaymentMethod = 'other';
      if (paymentType.includes('stripe') || orderData.payment?.stripePaymentId?.startsWith('pi_')) {
        method = 'stripe';
      } else if (paymentType === 'check') {
        method = 'check';
      } else if (paymentType === 'wire') {
        method = 'wire';
      } else if (paymentType === 'credit_on_file') {
        method = 'credit_on_file';
      } else if (paymentType === 'cash') {
        method = 'cash';
      }

      // Determine status - be lenient, treat most statuses as valid
      const paymentStatus = orderData.payment?.status || '';
      let ledgerStatus: LedgerEntryStatus = 'approved';
      if (paymentStatus === 'paid' || paymentStatus === 'verified' || method === 'stripe') {
        ledgerStatus = 'verified';
      }

      // Determine amount - use stripe verification if available, otherwise deposit
      let amount = depositAmount;
      if (orderData.payment?.stripeVerification?.paymentAmountDollars) {
        amount = orderData.payment.stripeVerification.paymentAmountDollars;
      }

      if (dryRun) {
        results.push({
          orderId,
          orderNumber: orderNum,
          action: 'would_migrate',
          amount,
          method,
        });
        migratedCount++;
        continue;
      }

      // Create the ledger entry
      try {
        await createLedgerEntry({
          orderId,
          orderNumber: orderNum,
          transactionType: 'payment',
          amount,
          method,
          category: 'initial_deposit',
          status: ledgerStatus,
          stripePaymentId: orderData.payment?.stripePaymentId || undefined,
          stripeVerified: method === 'stripe',
          description: `Force migrated from legacy payment (${paymentType || 'unknown type'})`,
          createdBy: 'force_migration_script',
        }, db);

        // Update order's ledger summary
        await updateOrderLedgerSummary(orderId, db);

        results.push({
          orderId,
          orderNumber: orderNum,
          action: 'migrated',
          amount,
          method,
        });
        migratedCount++;
      } catch (entryError) {
        results.push({
          orderId,
          orderNumber: orderNum,
          action: 'error',
          error: entryError instanceof Error ? entryError.message : 'Unknown error',
        });
        errorCount++;
      }
    }

    res.status(200).json({
      success: true,
      dryRun: dryRun || false,
      summary: {
        total: ordersSnap.size,
        migrated: migratedCount,
        skipped: skippedCount,
        errors: errorCount,
      },
      results,
    });
  } catch (error) {
    console.error('Error in force migration:', error);
    res.status(500).json({
      error: error instanceof Error ? error.message : 'Force migration failed',
    });
  }
});

export const migrateToPaymentLedger = functions.https.onRequest(async (req, res) => {
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
    const { dryRun, limit: batchLimit } = req.body;

    // Get all orders
    let ordersQuery = db.collection('orders').orderBy('createdAt', 'desc');

    if (batchLimit) {
      ordersQuery = ordersQuery.limit(batchLimit) as any;
    }

    const ordersSnap = await ordersQuery.get();

    const results: MigrationResult[] = [];
    let totalMigrated = 0;
    let totalSkipped = 0;
    let totalErrors = 0;

    for (const orderDoc of ordersSnap.docs) {
      if (dryRun) {
        // In dry run, just check if migration is needed
        const existingEntries = await db
          .collection('payment_ledger')
          .where('orderId', '==', orderDoc.id)
          .limit(1)
          .get();

        if (existingEntries.empty) {
          results.push({
            orderId: orderDoc.id,
            orderNumber: orderDoc.data().orderNumber,
            entriesCreated: 0,
            errors: [],
            skipped: false,
          });
          totalMigrated++;
        } else {
          results.push({
            orderId: orderDoc.id,
            orderNumber: orderDoc.data().orderNumber,
            entriesCreated: 0,
            errors: [],
            skipped: true,
            skipReason: 'Already has ledger entries',
          });
          totalSkipped++;
        }
      } else {
        const result = await migrateOrderPayments(orderDoc.id, db);
        results.push(result);

        if (result.skipped) {
          totalSkipped++;
        } else if (result.errors.length > 0) {
          totalErrors++;
        } else {
          totalMigrated++;
        }
      }
    }

    res.status(200).json({
      success: true,
      dryRun: dryRun || false,
      summary: {
        total: ordersSnap.size,
        migrated: totalMigrated,
        skipped: totalSkipped,
        errors: totalErrors,
      },
      results,
    });
  } catch (error) {
    console.error('Error in bulk migration:', error);
    res.status(500).json({
      error: error instanceof Error ? error.message : 'Bulk migration failed',
    });
  }
});
