import * as functions from 'firebase-functions/v1';
import * as admin from 'firebase-admin';

// ============================================================
// PAYMENT AUDIT LOG TYPES
// ============================================================

type PaymentAuditAction = 'created' | 'approved' | 'verified' | 'voided' | 'status_changed';

interface PaymentAuditEntry {
  id?: string;
  ledgerEntryId: string;
  paymentNumber?: string;
  orderId: string;
  orderNumber: string;
  action: PaymentAuditAction;
  previousStatus?: string;
  newStatus: string;
  userId: string;
  userEmail?: string;
  details?: string;
  stripeEventId?: string;
  timestamp: FirebaseFirestore.Timestamp;
}

interface CreateAuditEntryParams {
  ledgerEntryId: string;
  paymentNumber?: string;
  orderId: string;
  orderNumber: string;
  action: PaymentAuditAction;
  previousStatus?: string;
  newStatus: string;
  userId: string;
  userEmail?: string;
  details?: string;
  stripeEventId?: string;
}

// ============================================================
// AUDIT LOG FUNCTIONS
// ============================================================

/**
 * Create an audit log entry for a payment action
 * This is called internally by other functions when payments are created, approved, etc.
 */
export async function createAuditEntry(
  params: CreateAuditEntryParams,
  db: FirebaseFirestore.Firestore
): Promise<string> {
  const auditEntry: Omit<PaymentAuditEntry, 'id'> = {
    ledgerEntryId: params.ledgerEntryId,
    orderId: params.orderId,
    orderNumber: params.orderNumber,
    action: params.action,
    newStatus: params.newStatus,
    userId: params.userId,
    timestamp: admin.firestore.Timestamp.now(),
  };

  // Add optional fields
  if (params.paymentNumber) {
    auditEntry.paymentNumber = params.paymentNumber;
  }
  if (params.previousStatus) {
    auditEntry.previousStatus = params.previousStatus;
  }
  if (params.userEmail) {
    auditEntry.userEmail = params.userEmail;
  }
  if (params.details) {
    auditEntry.details = params.details;
  }
  if (params.stripeEventId) {
    auditEntry.stripeEventId = params.stripeEventId;
  }

  const docRef = await db.collection('payment_audit_log').add(auditEntry);

  console.log(`Audit entry created: ${docRef.id} - ${params.action} for payment ${params.paymentNumber || params.ledgerEntryId}`);

  return docRef.id;
}

/**
 * Get audit history for a specific payment (ledger entry)
 */
export const getAuditHistoryForPayment = functions.https.onRequest(async (req, res) => {
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
    const ledgerEntryId = req.query.ledgerEntryId as string;
    const paymentNumber = req.query.paymentNumber as string;

    if (!ledgerEntryId && !paymentNumber) {
      res.status(400).json({ error: 'ledgerEntryId or paymentNumber is required' });
      return;
    }

    let query: FirebaseFirestore.Query = db.collection('payment_audit_log');

    if (ledgerEntryId) {
      query = query.where('ledgerEntryId', '==', ledgerEntryId);
    } else if (paymentNumber) {
      query = query.where('paymentNumber', '==', paymentNumber);
    }

    query = query.orderBy('timestamp', 'desc');

    const snapshot = await query.get();

    const entries = snapshot.docs.map((doc) => ({
      id: doc.id,
      ...doc.data(),
    }));

    res.status(200).json({ entries, count: entries.length });
  } catch (error) {
    console.error('Error getting audit history:', error);
    res.status(500).json({
      error: error instanceof Error ? error.message : 'Failed to get audit history',
    });
  }
});

/**
 * Get all audit entries for an order
 */
export const getAuditHistoryForOrder = functions.https.onRequest(async (req, res) => {
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

    // Allow querying by orderNumber
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

    const snapshot = await db
      .collection('payment_audit_log')
      .where('orderId', '==', orderId)
      .orderBy('timestamp', 'desc')
      .get();

    const entries = snapshot.docs.map((doc) => ({
      id: doc.id,
      ...doc.data(),
    }));

    res.status(200).json({ entries, count: entries.length });
  } catch (error) {
    console.error('Error getting audit history for order:', error);
    res.status(500).json({
      error: error instanceof Error ? error.message : 'Failed to get audit history',
    });
  }
});

/**
 * Backfill audit entries for existing payments
 * Creates 'created' audit entries based on createdAt timestamps
 * Run this once for migration
 */
export const backfillAuditEntries = functions.https.onRequest(async (req, res) => {
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

    // Get all ledger entries
    const ledgerSnapshot = await db.collection('payment_ledger').get();

    let created = 0;
    let skipped = 0;

    for (const doc of ledgerSnapshot.docs) {
      const entry = doc.data();

      // Check if audit entry already exists for this ledger entry
      const existingAudit = await db
        .collection('payment_audit_log')
        .where('ledgerEntryId', '==', doc.id)
        .where('action', '==', 'created')
        .limit(1)
        .get();

      if (!existingAudit.empty) {
        skipped++;
        continue;
      }

      if (!dryRun) {
        // Create backfill audit entry
        const auditEntry = {
          ledgerEntryId: doc.id,
          paymentNumber: entry.paymentNumber || null,
          orderId: entry.orderId,
          orderNumber: entry.orderNumber,
          action: 'created' as PaymentAuditAction,
          newStatus: entry.status || 'pending',
          userId: entry.createdBy || 'system',
          userEmail: null,
          details: 'Backfilled from existing ledger entry',
          timestamp: entry.createdAt || admin.firestore.Timestamp.now(),
        };

        await db.collection('payment_audit_log').add(auditEntry);
      }

      created++;
    }

    res.status(200).json({
      success: true,
      dryRun,
      created,
      skipped,
      total: ledgerSnapshot.size,
      message: dryRun
        ? `Dry run complete. Would create ${created} audit entries, skip ${skipped}.`
        : `Backfill complete. Created ${created} audit entries, skipped ${skipped}.`,
    });
  } catch (error) {
    console.error('Error backfilling audit entries:', error);
    res.status(500).json({
      error: error instanceof Error ? error.message : 'Failed to backfill audit entries',
    });
  }
});
