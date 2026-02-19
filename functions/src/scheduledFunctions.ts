import * as functions from 'firebase-functions/v1';
import * as admin from 'firebase-admin';
import { stripe } from './config/stripe';

// ============================================================
// DAILY RECONCILIATION REPORT
// ============================================================

interface DailyReportSummary {
  date: string;
  totalOrders: number;
  ordersWithBalanceIssues: number;
  underpaidOrders: number;
  overpaidOrders: number;
  totalReceivablesOutstanding: number;
  totalRefundsDue: number;
  stripeDiscrepancies: number;
  ledgerEntriesWithoutStripeVerification: number;
  stripePaymentsNotInLedger: number;
}

interface OrderWithIssue {
  id: string;
  orderNumber: string;
  customerName: string;
  customerEmail: string;
  balance: number;
  balanceStatus: string;
  depositRequired: number;
  totalReceived: number;
}

interface MissingLedgerEntry {
  stripePaymentId: string;
  amount: number;
  orderId?: string;
  customerEmail?: string;
  createdAt: string;
}

/**
 * Daily reconciliation scheduled function
 * Runs every day at 6 AM UTC (1 AM EST)
 * Generates a report and stores it in Firestore
 */
export const dailyReconciliation = functions.pubsub
  .schedule('0 6 * * *')  // Every day at 6:00 AM UTC
  .timeZone('America/New_York')
  .onRun(async (context) => {
    console.log('Starting daily reconciliation...');

    const db = admin.firestore();
    const today = new Date();
    const reportDate = today.toISOString().split('T')[0];

    try {
      const report: DailyReportSummary = {
        date: reportDate,
        totalOrders: 0,
        ordersWithBalanceIssues: 0,
        underpaidOrders: 0,
        overpaidOrders: 0,
        totalReceivablesOutstanding: 0,
        totalRefundsDue: 0,
        stripeDiscrepancies: 0,
        ledgerEntriesWithoutStripeVerification: 0,
        stripePaymentsNotInLedger: 0,
      };

      const underpaidOrdersList: OrderWithIssue[] = [];
      const overpaidOrdersList: OrderWithIssue[] = [];

      // 1. Get all orders with ledger summaries
      const ordersQuery = await db.collection('orders')
        .where('ledgerSummary', '!=', null)
        .get();

      report.totalOrders = ordersQuery.size;

      for (const doc of ordersQuery.docs) {
        const order = doc.data();
        const summary = order.ledgerSummary;

        if (!summary) continue;

        const balance = summary.balance || 0;
        const balanceStatus = summary.balanceStatus;

        if (balanceStatus === 'underpaid') {
          report.underpaidOrders++;
          report.totalReceivablesOutstanding += balance;
          underpaidOrdersList.push({
            id: doc.id,
            orderNumber: order.orderNumber,
            customerName: `${order.customer?.firstName || ''} ${order.customer?.lastName || ''}`.trim(),
            customerEmail: order.customer?.email || '',
            balance,
            balanceStatus,
            depositRequired: summary.depositRequired,
            totalReceived: summary.totalReceived,
          });
        } else if (balanceStatus === 'overpaid') {
          report.overpaidOrders++;
          report.totalRefundsDue += Math.abs(balance);
          overpaidOrdersList.push({
            id: doc.id,
            orderNumber: order.orderNumber,
            customerName: `${order.customer?.firstName || ''} ${order.customer?.lastName || ''}`.trim(),
            customerEmail: order.customer?.email || '',
            balance,
            balanceStatus,
            depositRequired: summary.depositRequired,
            totalReceived: summary.totalReceived,
          });
        }
      }

      report.ordersWithBalanceIssues = report.underpaidOrders + report.overpaidOrders;

      // 2. Check for ledger entries without Stripe verification
      const unverifiedQuery = await db.collection('payment_ledger')
        .where('method', '==', 'stripe')
        .where('stripeVerified', '==', false)
        .where('status', '!=', 'voided')
        .get();

      report.ledgerEntriesWithoutStripeVerification = unverifiedQuery.size;

      // 3. Check for recent Stripe payments not in ledger (last 24 hours)
      const yesterday = new Date(today.getTime() - 24 * 60 * 60 * 1000);
      const missingLedgerEntries: MissingLedgerEntry[] = [];

      try {
        const recentPayments = await stripe.paymentIntents.list({
          created: {
            gte: Math.floor(yesterday.getTime() / 1000),
          },
          limit: 100,
        });

        for (const pi of recentPayments.data) {
          if (pi.status !== 'succeeded') continue;

          const ledgerQuery = await db.collection('payment_ledger')
            .where('stripePaymentId', '==', pi.id)
            .limit(1)
            .get();

          if (ledgerQuery.empty) {
            report.stripePaymentsNotInLedger++;
            missingLedgerEntries.push({
              stripePaymentId: pi.id,
              amount: pi.amount / 100,
              orderId: pi.metadata?.orderId || undefined,
              customerEmail: pi.metadata?.customerEmail || pi.receipt_email || undefined,
              createdAt: new Date(pi.created * 1000).toISOString(),
            });
          }
        }
      } catch (stripeError) {
        console.error('Error checking Stripe payments:', stripeError);
        // Continue without Stripe check if it fails
      }

      // 4. Store the report in Firestore
      await db.collection('reconciliation_reports').add({
        ...report,
        underpaidOrders: underpaidOrdersList,
        overpaidOrders: overpaidOrdersList,
        missingLedgerEntries,
        generatedAt: admin.firestore.FieldValue.serverTimestamp(),
      });

      console.log(`Daily reconciliation complete:
        - Total orders: ${report.totalOrders}
        - Underpaid: ${report.underpaidOrders} ($${report.totalReceivablesOutstanding.toFixed(2)} outstanding)
        - Overpaid: ${report.overpaidOrders} ($${report.totalRefundsDue.toFixed(2)} refunds due)
        - Unverified Stripe entries: ${report.ledgerEntriesWithoutStripeVerification}
        - Missing ledger entries: ${report.stripePaymentsNotInLedger}
      `);

      // 5. Send email notification if there are issues
      const hasIssues = report.ordersWithBalanceIssues > 0 ||
        report.stripePaymentsNotInLedger > 0 ||
        report.ledgerEntriesWithoutStripeVerification > 0;

      if (hasIssues) {
        await sendReconciliationAlert(report, underpaidOrdersList, overpaidOrdersList, missingLedgerEntries);
      }

      return null;
    } catch (error) {
      console.error('Daily reconciliation failed:', error);
      throw error;
    }
  });

/**
 * Send email alert for reconciliation issues
 * Uses Firebase Extension or custom email service
 */
async function sendReconciliationAlert(
  report: DailyReportSummary,
  underpaidOrders: OrderWithIssue[],
  overpaidOrders: OrderWithIssue[],
  missingLedgerEntries: MissingLedgerEntry[] = []
): Promise<void> {
  const db = admin.firestore();

  try {
    const adminEmail = process.env.ADMIN_EMAIL || 'admin@example.com';

    const totalIssues = report.ordersWithBalanceIssues +
      report.stripePaymentsNotInLedger +
      report.ledgerEntriesWithoutStripeVerification;

    const emailBody = `
Daily Reconciliation Report - ${report.date}
=============================================

Summary:
- Total Orders: ${report.totalOrders}
- Orders with Balance Issues: ${report.ordersWithBalanceIssues}
- Total Receivables Outstanding: $${report.totalReceivablesOutstanding.toFixed(2)}
- Total Refunds Due: $${report.totalRefundsDue.toFixed(2)}
- Unverified Stripe Entries: ${report.ledgerEntriesWithoutStripeVerification}
- Stripe Payments Missing from Ledger: ${report.stripePaymentsNotInLedger}

${underpaidOrders.length > 0 ? `
Underpaid Orders (${underpaidOrders.length}):
${underpaidOrders.slice(0, 10).map(o =>
  `  - ${o.orderNumber}: ${o.customerName} - Balance Due: $${o.balance.toFixed(2)}`
).join('\n')}
${underpaidOrders.length > 10 ? `  ... and ${underpaidOrders.length - 10} more` : ''}
` : ''}
${overpaidOrders.length > 0 ? `
Overpaid Orders (${overpaidOrders.length}):
${overpaidOrders.slice(0, 10).map(o =>
  `  - ${o.orderNumber}: ${o.customerName} - Refund Due: $${Math.abs(o.balance).toFixed(2)}`
).join('\n')}
${overpaidOrders.length > 10 ? `  ... and ${overpaidOrders.length - 10} more` : ''}
` : ''}
${missingLedgerEntries.length > 0 ? `
Stripe Payments Missing from Ledger (${missingLedgerEntries.length}):
${missingLedgerEntries.slice(0, 10).map(e =>
  `  - ${e.stripePaymentId}: $${e.amount.toFixed(2)}${e.orderId ? ` (Order: ${e.orderId})` : ''}${e.customerEmail ? ` - ${e.customerEmail}` : ''} - ${e.createdAt}`
).join('\n')}
${missingLedgerEntries.length > 10 ? `  ... and ${missingLedgerEntries.length - 10} more` : ''}
` : ''}
${report.ledgerEntriesWithoutStripeVerification > 0 ? `
WARNING: ${report.ledgerEntriesWithoutStripeVerification} Stripe ledger entries have not been verified against Stripe.
These may indicate webhook failures or data integrity issues. Please run a manual reconciliation.
` : ''}
Please review these issues in the admin dashboard.
    `.trim();

    // Store email request (for Firebase Trigger Email extension)
    await db.collection('mail').add({
      to: adminEmail,
      message: {
        subject: `Payment Reconciliation Report - ${report.date} (${totalIssues} issue${totalIssues !== 1 ? 's' : ''})`,
        text: emailBody,
      },
      createdAt: admin.firestore.FieldValue.serverTimestamp(),
    });

    console.log(`Reconciliation alert email queued for ${adminEmail}`);
  } catch (emailError) {
    console.error('Failed to send reconciliation email:', emailError);
    // Don't throw - email failure shouldn't fail the reconciliation
  }
}

// ============================================================
// MANUAL TRIGGER FOR RECONCILIATION
// ============================================================

/**
 * Manually trigger daily reconciliation (for testing)
 */
export const triggerReconciliation = functions.https.onRequest(async (req, res) => {
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
    const today = new Date();
    const reportDate = today.toISOString().split('T')[0];

    const report: DailyReportSummary = {
      date: reportDate,
      totalOrders: 0,
      ordersWithBalanceIssues: 0,
      underpaidOrders: 0,
      overpaidOrders: 0,
      totalReceivablesOutstanding: 0,
      totalRefundsDue: 0,
      stripeDiscrepancies: 0,
      ledgerEntriesWithoutStripeVerification: 0,
      stripePaymentsNotInLedger: 0,
    };

    const underpaidOrdersList: OrderWithIssue[] = [];
    const overpaidOrdersList: OrderWithIssue[] = [];

    // Get all orders with ledger summaries
    const ordersQuery = await db.collection('orders')
      .where('ledgerSummary', '!=', null)
      .get();

    report.totalOrders = ordersQuery.size;

    for (const doc of ordersQuery.docs) {
      const order = doc.data();
      const summary = order.ledgerSummary;

      if (!summary) continue;

      const balance = summary.balance || 0;
      const balanceStatus = summary.balanceStatus;

      if (balanceStatus === 'underpaid') {
        report.underpaidOrders++;
        report.totalReceivablesOutstanding += balance;
        underpaidOrdersList.push({
          id: doc.id,
          orderNumber: order.orderNumber,
          customerName: `${order.customer?.firstName || ''} ${order.customer?.lastName || ''}`.trim(),
          customerEmail: order.customer?.email || '',
          balance,
          balanceStatus,
          depositRequired: summary.depositRequired,
          totalReceived: summary.totalReceived,
        });
      } else if (balanceStatus === 'overpaid') {
        report.overpaidOrders++;
        report.totalRefundsDue += Math.abs(balance);
        overpaidOrdersList.push({
          id: doc.id,
          orderNumber: order.orderNumber,
          customerName: `${order.customer?.firstName || ''} ${order.customer?.lastName || ''}`.trim(),
          customerEmail: order.customer?.email || '',
          balance,
          balanceStatus,
          depositRequired: summary.depositRequired,
          totalReceived: summary.totalReceived,
        });
      }
    }

    report.ordersWithBalanceIssues = report.underpaidOrders + report.overpaidOrders;

    // Check for ledger entries without Stripe verification
    const unverifiedQuery = await db.collection('payment_ledger')
      .where('method', '==', 'stripe')
      .where('stripeVerified', '==', false)
      .where('status', '!=', 'voided')
      .get();

    report.ledgerEntriesWithoutStripeVerification = unverifiedQuery.size;

    // Check for recent Stripe payments not in ledger (last 24 hours)
    const yesterday = new Date(today.getTime() - 24 * 60 * 60 * 1000);
    const missingLedgerEntries: MissingLedgerEntry[] = [];

    try {
      const recentPayments = await stripe.paymentIntents.list({
        created: {
          gte: Math.floor(yesterday.getTime() / 1000),
        },
        limit: 100,
      });

      for (const pi of recentPayments.data) {
        if (pi.status !== 'succeeded') continue;

        const ledgerQuery = await db.collection('payment_ledger')
          .where('stripePaymentId', '==', pi.id)
          .limit(1)
          .get();

        if (ledgerQuery.empty) {
          report.stripePaymentsNotInLedger++;
          missingLedgerEntries.push({
            stripePaymentId: pi.id,
            amount: pi.amount / 100,
            orderId: pi.metadata?.orderId || undefined,
            customerEmail: pi.metadata?.customerEmail || pi.receipt_email || undefined,
            createdAt: new Date(pi.created * 1000).toISOString(),
          });
        }
      }
    } catch (stripeError) {
      console.error('Error checking Stripe payments:', stripeError);
    }

    // Store the report
    const reportRef = await db.collection('reconciliation_reports').add({
      ...report,
      underpaidOrders: underpaidOrdersList,
      overpaidOrders: overpaidOrdersList,
      missingLedgerEntries,
      generatedAt: admin.firestore.FieldValue.serverTimestamp(),
      manual: true,
    });

    // Send email alert if there are issues
    const hasIssues = report.ordersWithBalanceIssues > 0 ||
      report.stripePaymentsNotInLedger > 0 ||
      report.ledgerEntriesWithoutStripeVerification > 0;

    if (hasIssues) {
      await sendReconciliationAlert(report, underpaidOrdersList, overpaidOrdersList, missingLedgerEntries);
    }

    res.status(200).json({
      success: true,
      reportId: reportRef.id,
      report,
      underpaidOrders: underpaidOrdersList.slice(0, 10),
      overpaidOrders: overpaidOrdersList.slice(0, 10),
      missingLedgerEntries: missingLedgerEntries.slice(0, 10),
      emailSent: hasIssues,
    });
  } catch (error) {
    console.error('Error running manual reconciliation:', error);
    res.status(500).json({
      error: error instanceof Error ? error.message : 'Reconciliation failed',
    });
  }
});

// ============================================================
// GET LATEST RECONCILIATION REPORT
// ============================================================

/**
 * Get the most recent reconciliation report
 */
export const getLatestReconciliationReport = functions.https.onRequest(async (req, res) => {
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

    const reportsQuery = await db.collection('reconciliation_reports')
      .orderBy('generatedAt', 'desc')
      .limit(1)
      .get();

    if (reportsQuery.empty) {
      res.status(404).json({ error: 'No reconciliation reports found' });
      return;
    }

    const report = reportsQuery.docs[0];

    res.status(200).json({
      success: true,
      reportId: report.id,
      ...report.data(),
    });
  } catch (error) {
    console.error('Error getting reconciliation report:', error);
    res.status(500).json({
      error: error instanceof Error ? error.message : 'Failed to get report',
    });
  }
});
