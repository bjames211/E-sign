import * as dotenv from 'dotenv';
dotenv.config();

import * as functions from 'firebase-functions/v1';
import * as admin from 'firebase-admin';
import { sendForSignature, downloadSignedDocument, cancelSigningInvite, resendSigningInvite, sendSignatureReminder } from './signNowService';
import { extractDataFromPdf } from './pdfExtractor';
import { getSkuForManufacturer } from './manufacturerConfigService';
import { addDocumentToSheet, updateSheetOnSigned } from './googleSheetsService';
import { seedAdminOptions, seedMockQuotes, seedBulkQuotes, seedTestOrders, seedPartialPaymentOrders, seedOverpaidOrders, seedManufacturerConfig } from './seedData';
import {
  createPaymentIntent,
  verifyPayment,
  createPaymentLink,
  stripeWebhook,
  verifyPaymentForOrder,
  approveManualPayment,
  generatePaymentLinkForUnderpaid,
  verifyStripeRefund,
} from './stripeFunctions';
import {
  addPaymentRecord,
  approvePaymentRecord,
  verifyStripePaymentRecord,
  rejectPaymentRecord,
  getPaymentsForOrder,
  chargeCardOnFile,
} from './paymentFunctions';
import { sendOrderForSignature, updateOrderOnSigned, syncOrderStatusFromEsign, sendChangeOrderForSignature, testSignOrder, testSignChangeOrder } from './orderEsignBridge';
import {
  addLedgerEntry,
  voidLedgerEntry,
  approveLedgerEntry,
  approveLegacyPayment,
  getLedgerEntries,
  getPendingLedgerEntries,
  recalculateLedgerSummary,
  auditOrder,
  getAllLedgerEntries,
  migratePaymentNumbers,
  migrateBalanceAfter,
  fixDuplicateOrderNumber,
  syncOrderNumberCounter,
} from './paymentLedgerFunctions';
import {
  getAuditHistoryForPayment,
  getAuditHistoryForOrder,
  backfillAuditEntries,
} from './paymentAuditFunctions';
import { migrateToPaymentLedger, migrateOrderToLedger, clearAndRemigrateLedger, forceMigrateLegacyPayments } from './migrateToLedger';
import { reconcileLedgerWithStripe, findMissingLedgerEntries, fixLedgerEntryAmount } from './stripeReconciliation';
import {
  recordPrepaidPayment,
  applyPrepaidCreditToOrder,
  getUnappliedCredits,
  voidPrepaidCredit,
  findMatchingCredits,
} from './prepaidCreditFunctions';
import {
  processRefund,
  getRefundableAmount,
  findOverpaidOrders,
} from './refundFunctions';
import {
  dailyReconciliation,
  triggerReconciliation,
  getLatestReconciliationReport,
} from './scheduledFunctions';
import { getAccessToken } from './signNowService';
import axios from 'axios';

admin.initializeApp();

// Export Stripe functions
export {
  createPaymentIntent,
  verifyPayment,
  createPaymentLink,
  stripeWebhook,
  verifyPaymentForOrder,
  approveManualPayment,
  generatePaymentLinkForUnderpaid,
  verifyStripeRefund,
};

// Export Order-to-ESign bridge functions
export { sendOrderForSignature, sendChangeOrderForSignature, testSignOrder, testSignChangeOrder };
// migrateOrderPaymentStatus removed — migration is complete, endpoint was unprotected

// Export Payment functions
export {
  addPaymentRecord,
  approvePaymentRecord,
  verifyStripePaymentRecord,
  rejectPaymentRecord,
  getPaymentsForOrder,
  // recalculatePaymentSummary removed — use recalculateLedgerSummary instead
  chargeCardOnFile,
};

// Export Payment Ledger functions
export {
  addLedgerEntry,
  voidLedgerEntry,
  approveLedgerEntry,
  approveLegacyPayment,
  getLedgerEntries,
  getPendingLedgerEntries,
  recalculateLedgerSummary,
  auditOrder,
  getAllLedgerEntries,
  migratePaymentNumbers,
  migrateBalanceAfter,
  fixDuplicateOrderNumber,
  syncOrderNumberCounter,
};

// Export Payment Audit functions
export {
  getAuditHistoryForPayment,
  getAuditHistoryForOrder,
  backfillAuditEntries,
};

// Export Migration functions
export {
  migrateToPaymentLedger,
  migrateOrderToLedger,
  clearAndRemigrateLedger,
  forceMigrateLegacyPayments,
};

// Export Stripe Reconciliation functions
export {
  reconcileLedgerWithStripe,
  findMissingLedgerEntries,
  fixLedgerEntryAmount,
};

// Export Prepaid Credit functions
export {
  recordPrepaidPayment,
  applyPrepaidCreditToOrder,
  getUnappliedCredits,
  voidPrepaidCredit,
  findMatchingCredits,
};

// Export Refund functions
export {
  processRefund,
  getRefundableAmount,
  findOverpaidOrders,
};

// Export Scheduled functions
export {
  dailyReconciliation,
  triggerReconciliation,
  getLatestReconciliationReport,
};

// Get SignNow template field positions (for signature field preview)
export const getTemplateFields = functions.https.onRequest(async (req, res) => {
  res.set('Access-Control-Allow-Origin', '*');
  res.set('Access-Control-Allow-Methods', 'GET, OPTIONS');
  res.set('Access-Control-Allow-Headers', 'Content-Type');

  if (req.method === 'OPTIONS') {
    res.status(204).send('');
    return;
  }

  const templateId = req.query.templateId as string;
  if (!templateId) {
    res.status(400).json({ error: 'templateId query parameter is required' });
    return;
  }

  try {
    const accessToken = await getAccessToken();
    const response = await axios.get(
      `https://api.signnow.com/document/${templateId}`,
      { headers: { Authorization: `Bearer ${accessToken}` } }
    );

    const templateFields = (response.data.fields || []).map((field: any) => {
      const attrs = typeof field.json_attributes === 'string'
        ? JSON.parse(field.json_attributes)
        : (field.json_attributes || {});
      return {
        type: field.type,
        x: parseFloat(attrs.x) || 0,
        y: parseFloat(attrs.y) || 0,
        width: parseFloat(attrs.width) || 100,
        height: parseFloat(attrs.height) || 30,
        page_number: parseInt(attrs.page_number) || 0,
        role: field.role || 'Signer 1',
        required: attrs.required !== false,
        label: attrs.label || field.type,
      };
    });

    res.json({
      fields: templateFields,
      templateId,
      pageCount: response.data.page_count || response.data.pages?.length || 1,
    });
  } catch (error: any) {
    console.error('Error fetching template fields:', error.response?.data || error.message);
    res.status(500).json({
      error: error.response?.data?.message || error.message || 'Failed to fetch template fields',
    });
  }
});

// Preview PDF extraction — test what data Claude would extract from a PDF
export const previewPdfExtraction = functions.runWith({ timeoutSeconds: 120, memory: '512MB' }).https.onRequest(async (req, res) => {
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

  const { pdfBase64, manufacturer } = req.body;
  if (!pdfBase64) {
    res.status(400).json({ error: 'pdfBase64 is required' });
    return;
  }
  if (!manufacturer) {
    res.status(400).json({ error: 'manufacturer is required' });
    return;
  }

  try {
    const pdfBuffer = Buffer.from(pdfBase64, 'base64');
    const expectedSku = await getSkuForManufacturer(manufacturer);
    const extracted = await extractDataFromPdf(pdfBuffer, manufacturer, expectedSku);
    res.json({
      success: true,
      data: {
        customerName: extracted.customerName,
        address: extracted.address,
        city: extracted.city,
        state: extracted.state,
        zip: extracted.zip,
        email: extracted.email,
        phone: extracted.phone,
        subtotal: extracted.subtotal,
        downPayment: extracted.downPayment,
        balanceDue: extracted.balanceDue,
        manufacturerSku: extracted.manufacturerSku,
        expectedSku: extracted.expectedSku,
        skuMismatch: extracted.skuMismatch,
        expectedDepositPercent: extracted.expectedDepositPercent,
        expectedDepositAmount: extracted.expectedDepositAmount,
        actualDepositPercent: extracted.actualDepositPercent,
        depositDiscrepancy: extracted.depositDiscrepancy,
        depositDiscrepancyAmount: extracted.depositDiscrepancyAmount,
      },
    });
  } catch (error: any) {
    console.error('Error extracting PDF data:', error);
    res.status(500).json({ error: error.message || 'Failed to extract data from PDF' });
  }
});

/**
 * HTTP endpoint to sync order status from esign documents
 * Useful for fixing orders that weren't updated when signed
 */
export const syncOrderStatus = functions.https.onRequest(async (req, res) => {
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

  const { orderId, orderNumber, syncAll } = req.body;

  try {
    // Sync all orders with sent_for_signature status
    if (syncAll) {
      const ordersQuery = await admin.firestore()
        .collection('orders')
        .where('status', '==', 'sent_for_signature')
        .get();

      const results: any[] = [];
      for (const doc of ordersQuery.docs) {
        const result = await syncOrderStatusFromEsign(doc.id);
        results.push({ orderId: doc.id, orderNumber: doc.data().orderNumber, ...result });
      }
      res.json({ success: true, synced: results.length, results });
      return;
    }

    // Sync single order by orderNumber
    if (orderNumber) {
      const ordersQuery = await admin.firestore()
        .collection('orders')
        .where('orderNumber', '==', orderNumber)
        .limit(1)
        .get();

      if (ordersQuery.empty) {
        res.status(404).json({ error: `Order ${orderNumber} not found` });
        return;
      }

      const result = await syncOrderStatusFromEsign(ordersQuery.docs[0].id);
      res.json(result);
      return;
    }

    // Sync single order by orderId
    if (orderId) {
      const result = await syncOrderStatusFromEsign(orderId);
      res.json(result);
      return;
    }

    res.status(400).json({ error: 'orderId, orderNumber, or syncAll is required' });
  } catch (error: any) {
    console.error('Error syncing order status:', error);
    res.status(500).json({ error: error.message || 'Failed to sync order status' });
  }
});

/**
 * HTTP endpoint to cancel a signature request
 * Cancels the SignNow invite and reverts order to draft status
 */
export const cancelSignature = functions.https.onRequest(async (req, res) => {
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

  const { orderId, orderNumber } = req.body;

  if (!orderId && !orderNumber) {
    res.status(400).json({ error: 'orderId or orderNumber is required' });
    return;
  }

  try {
    const db = admin.firestore();

    // Find the order
    let orderRef: FirebaseFirestore.DocumentReference;
    let orderData: FirebaseFirestore.DocumentData;

    if (orderId) {
      orderRef = db.collection('orders').doc(orderId);
      const orderDoc = await orderRef.get();
      if (!orderDoc.exists) {
        res.status(404).json({ error: `Order ${orderId} not found` });
        return;
      }
      orderData = orderDoc.data()!;
    } else {
      const ordersQuery = await db
        .collection('orders')
        .where('orderNumber', '==', orderNumber)
        .limit(1)
        .get();

      if (ordersQuery.empty) {
        res.status(404).json({ error: `Order ${orderNumber} not found` });
        return;
      }
      orderRef = ordersQuery.docs[0].ref;
      orderData = ordersQuery.docs[0].data();
    }

    // Check if order is in a cancellable state
    if (orderData.status !== 'sent_for_signature') {
      res.status(400).json({
        error: `Order cannot be cancelled - current status is "${orderData.status}". Only orders awaiting signature can be cancelled.`
      });
      return;
    }

    // Find the esign document
    const esignDocId = orderData.esignDocumentId;
    if (!esignDocId) {
      // No esign document linked, just revert order to draft
      await orderRef.update({
        status: 'draft',
        sentForSignatureAt: admin.firestore.FieldValue.delete(),
      });
      res.json({ success: true, message: 'Order reverted to draft (no esign document found)' });
      return;
    }

    const esignDocRef = db.collection('esign_documents').doc(esignDocId);
    const esignDoc = await esignDocRef.get();

    if (!esignDoc.exists) {
      // Esign document not found, just revert order to draft
      await orderRef.update({
        status: 'draft',
        sentForSignatureAt: admin.firestore.FieldValue.delete(),
        esignDocumentId: admin.firestore.FieldValue.delete(),
      });
      res.json({ success: true, message: 'Order reverted to draft (esign document not found)' });
      return;
    }

    const esignData = esignDoc.data()!;
    const signNowDocumentId = esignData.signNowDocumentId;

    // Cancel the SignNow invite
    if (signNowDocumentId) {
      const cancelResult = await cancelSigningInvite(signNowDocumentId);
      console.log('SignNow cancel result:', cancelResult);

      if (!cancelResult.success) {
        console.warn('Failed to cancel SignNow invite:', cancelResult.message);
        // Continue anyway - we still want to update our records
      }
    }

    // Update esign document status
    await esignDocRef.update({
      status: 'cancelled',
      cancelledAt: admin.firestore.FieldValue.serverTimestamp(),
    });

    // Revert order to draft
    await orderRef.update({
      status: 'draft',
      sentForSignatureAt: admin.firestore.FieldValue.delete(),
    });

    res.json({
      success: true,
      message: `Signature cancelled for order ${orderData.orderNumber}. Order reverted to draft.`
    });
  } catch (error: any) {
    console.error('Error cancelling signature:', error);
    res.status(500).json({ error: error.message || 'Failed to cancel signature' });
  }
});

/**
 * Cancel an order entirely (not just its signature).
 * Cancels linked SignNow invites, active change orders, and marks order as cancelled.
 * Payment ledger entries are left intact (refunds tracked separately).
 */
export const cancelOrder = functions.https.onRequest(async (req, res) => {
  res.set('Access-Control-Allow-Origin', '*');
  res.set('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.set('Access-Control-Allow-Headers', 'Content-Type');

  if (req.method === 'OPTIONS') { res.status(204).send(''); return; }
  if (req.method !== 'POST') { res.status(405).json({ error: 'Method not allowed' }); return; }

  const { orderId, cancelReason, cancelledBy, cancelledByEmail } = req.body;

  if (!orderId) { res.status(400).json({ error: 'orderId is required' }); return; }
  if (!cancelReason) { res.status(400).json({ error: 'cancelReason is required' }); return; }

  try {
    const db = admin.firestore();
    const orderRef = db.collection('orders').doc(orderId);
    const orderDoc = await orderRef.get();

    if (!orderDoc.exists) {
      res.status(404).json({ error: `Order ${orderId} not found` });
      return;
    }

    const orderData = orderDoc.data()!;
    const currentStatus = orderData.status;

    // Only allow cancellation for draft, pending_payment, and sent_for_signature
    if (currentStatus === 'cancelled') {
      res.status(400).json({ error: 'Order is already cancelled.' });
      return;
    }
    if (currentStatus !== 'draft' && currentStatus !== 'pending_payment' && currentStatus !== 'sent_for_signature') {
      res.status(400).json({ error: `Cannot cancel order in "${currentStatus}" status. Only draft, pending payment, and awaiting-signature orders can be cancelled.` });
      return;
    }

    console.log(`Cancelling order ${orderId} (${orderData.orderNumber}), current status: ${currentStatus}`);

    // 1. Cancel SignNow invite if order is sent_for_signature and has an esign document
    if (currentStatus === 'sent_for_signature' && orderData.esignDocumentId) {
      const esignDocRef = db.collection('esign_documents').doc(orderData.esignDocumentId);
      const esignDoc = await esignDocRef.get();

      if (esignDoc.exists) {
        const esignData = esignDoc.data()!;
        if (esignData.signNowDocumentId) {
          try {
            const cancelResult = await cancelSigningInvite(esignData.signNowDocumentId);
            console.log('SignNow cancel result:', cancelResult);
          } catch (err) {
            console.warn('Failed to cancel SignNow invite (continuing):', err);
          }
        }
        await esignDocRef.update({
          status: 'cancelled',
          cancelledAt: admin.firestore.FieldValue.serverTimestamp(),
        });
      }
    }

    // 2. Cancel active change orders
    const changeOrdersQuery = await db
      .collection('change_orders')
      .where('orderId', '==', orderId)
      .where('status', 'in', ['draft', 'pending_signature'])
      .get();

    for (const coDoc of changeOrdersQuery.docs) {
      const coData = coDoc.data();
      console.log(`Cancelling change order ${coDoc.id} (${coData.changeOrderNumber}), status: ${coData.status}`);

      // Cancel SignNow invite if change order is pending_signature
      if (coData.status === 'pending_signature' && coData.esignDocumentId) {
        const coEsignRef = db.collection('esign_documents').doc(coData.esignDocumentId);
        const coEsignDoc = await coEsignRef.get();
        if (coEsignDoc.exists) {
          const coEsignData = coEsignDoc.data()!;
          if (coEsignData.signNowDocumentId) {
            try {
              await cancelSigningInvite(coEsignData.signNowDocumentId);
            } catch (err) {
              console.warn(`Failed to cancel SignNow invite for CO ${coDoc.id}:`, err);
            }
          }
          await coEsignRef.update({
            status: 'cancelled',
            cancelledAt: admin.firestore.FieldValue.serverTimestamp(),
          });
        }
      }

      await coDoc.ref.update({
        status: 'cancelled',
        cancelledAt: admin.firestore.FieldValue.serverTimestamp(),
      });
    }

    // 3. Update order — set cancelled status and metadata
    await orderRef.update({
      status: 'cancelled',
      previousStatus: currentStatus,
      cancelledAt: admin.firestore.FieldValue.serverTimestamp(),
      cancelledBy: cancelledBy || 'unknown',
      cancelledByEmail: cancelledByEmail || 'unknown',
      cancelReason,
      activeChangeOrderId: null,
      activeChangeOrderStatus: null,
    });

    // 4. Audit log
    await db.collection('order_audit_log').add({
      orderId,
      orderNumber: orderData.orderNumber,
      action: 'cancelled',
      changes: [
        { field: 'status', oldValue: currentStatus, newValue: 'cancelled' },
        { field: 'cancelReason', oldValue: null, newValue: cancelReason },
      ],
      userId: cancelledBy || 'unknown',
      userEmail: cancelledByEmail || 'unknown',
      timestamp: admin.firestore.FieldValue.serverTimestamp(),
    });

    // 5. Interaction log
    await db.collection('order_interactions').add({
      orderId,
      orderNumber: orderData.orderNumber,
      type: 'order_cancelled',
      description: `Order cancelled. Reason: ${cancelReason}`,
      createdAt: admin.firestore.FieldValue.serverTimestamp(),
      createdBy: cancelledByEmail || cancelledBy || 'system',
    });

    console.log(`Order ${orderData.orderNumber} cancelled successfully`);
    res.json({
      success: true,
      message: `Order ${orderData.orderNumber} has been cancelled.`,
    });
  } catch (error: any) {
    console.error('Error cancelling order:', error);
    res.status(500).json({ error: error.message || 'Failed to cancel order' });
  }
});

/**
 * Reset an order to draft and re-trigger sendOrderForSignature.
 * Used when a test mode order needs to be resent with real SignNow delivery.
 */
export const resendOrderForSignature = functions.https.onRequest(async (req, res) => {
  res.set('Access-Control-Allow-Origin', '*');
  res.set('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.set('Access-Control-Allow-Headers', 'Content-Type');

  if (req.method === 'OPTIONS') { res.status(204).send(''); return; }
  if (req.method !== 'POST') { res.status(405).json({ error: 'Method not allowed' }); return; }

  try {
    const db = admin.firestore();
    const { orderId } = req.body;
    if (!orderId) { res.status(400).json({ error: 'orderId is required' }); return; }

    const orderRef = db.doc(`orders/${orderId}`);
    const orderSnap = await orderRef.get();
    if (!orderSnap.exists) { res.status(404).json({ error: 'Order not found' }); return; }

    const orderData = orderSnap.data()!;
    console.log(`Resending order ${orderId} (${orderData.orderNumber}), current status: ${orderData.status}`);

    // Reset to draft so sendOrderForSignature accepts it
    await orderRef.update({ status: 'draft' });
    console.log('Order reset to draft');

    // Forward to sendOrderForSignature via internal HTTP call
    const axios = require('axios');
    const functionUrl = `https://us-central1-e-sign-27f9a.cloudfunctions.net/sendOrderForSignature`;
    const sendResult = await axios.post(functionUrl, { orderId }, {
      headers: { 'Content-Type': 'application/json' },
    });

    console.log('sendOrderForSignature result:', JSON.stringify(sendResult.data));
    res.status(200).json(sendResult.data);
  } catch (error: any) {
    console.error('Error resending order for signature:', error?.response?.data || error.message);
    res.status(500).json({ error: error?.response?.data?.error || error.message || 'Failed to resend' });
  }
});

/**
 * HTTP endpoint to resend a signature invite
 * Sends another email to the signer for an existing pending signature
 */
export const resendSignature = functions.https.onRequest(async (req, res) => {
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

  const { orderId, orderNumber } = req.body;

  if (!orderId && !orderNumber) {
    res.status(400).json({ error: 'orderId or orderNumber is required' });
    return;
  }

  try {
    const db = admin.firestore();

    // Find the order
    let orderData: FirebaseFirestore.DocumentData;

    if (orderId) {
      const orderDoc = await db.collection('orders').doc(orderId).get();
      if (!orderDoc.exists) {
        res.status(404).json({ error: `Order ${orderId} not found` });
        return;
      }
      orderData = orderDoc.data()!;
    } else {
      const ordersQuery = await db
        .collection('orders')
        .where('orderNumber', '==', orderNumber)
        .limit(1)
        .get();

      if (ordersQuery.empty) {
        res.status(404).json({ error: `Order ${orderNumber} not found` });
        return;
      }
      orderData = ordersQuery.docs[0].data();
    }

    // Check if order is awaiting signature
    if (orderData.status !== 'sent_for_signature') {
      res.status(400).json({
        error: `Order is not awaiting signature - current status is "${orderData.status}".`
      });
      return;
    }

    // Find the esign document
    const esignDocId = orderData.esignDocumentId;
    if (!esignDocId) {
      res.status(400).json({ error: 'No esign document linked to this order' });
      return;
    }

    const esignDocRef = db.collection('esign_documents').doc(esignDocId);
    const esignDoc = await esignDocRef.get();

    if (!esignDoc.exists) {
      res.status(404).json({ error: 'Esign document not found' });
      return;
    }

    const esignData = esignDoc.data()!;
    const signNowDocumentId = esignData.signNowDocumentId;

    if (!signNowDocumentId) {
      res.status(400).json({ error: 'No SignNow document ID found' });
      return;
    }

    // Resend the invite
    const result = await resendSigningInvite(signNowDocumentId);

    if (!result.success) {
      res.status(400).json({ error: result.message });
      return;
    }

    // Log the resend action
    await esignDocRef.update({
      lastReminderSentAt: admin.firestore.FieldValue.serverTimestamp(),
      reminderCount: admin.firestore.FieldValue.increment(1),
    });

    res.json({
      success: true,
      message: `Signature request resent for order ${orderData.orderNumber}`,
    });
  } catch (error: any) {
    console.error('Error resending signature:', error);
    res.status(500).json({ error: error.message || 'Failed to resend signature' });
  }
});

/**
 * HTTP endpoint to send a reminder email for signature
 * Sends a custom reminder email to the signer
 */
export const sendReminder = functions.https.onRequest(async (req, res) => {
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

  const { orderId, orderNumber, customMessage } = req.body;

  if (!orderId && !orderNumber) {
    res.status(400).json({ error: 'orderId or orderNumber is required' });
    return;
  }

  try {
    const db = admin.firestore();

    // Find the order
    let orderData: FirebaseFirestore.DocumentData;
    let resolvedOrderId: string;

    if (orderId) {
      resolvedOrderId = orderId;
      const orderDoc = await db.collection('orders').doc(orderId).get();
      if (!orderDoc.exists) {
        res.status(404).json({ error: `Order ${orderId} not found` });
        return;
      }
      orderData = orderDoc.data()!;
    } else {
      const ordersQuery = await db
        .collection('orders')
        .where('orderNumber', '==', orderNumber)
        .limit(1)
        .get();

      if (ordersQuery.empty) {
        res.status(404).json({ error: `Order ${orderNumber} not found` });
        return;
      }
      resolvedOrderId = ordersQuery.docs[0].id;
      orderData = ordersQuery.docs[0].data();
    }

    // Check if order is awaiting signature
    if (orderData.status !== 'sent_for_signature') {
      res.status(400).json({
        error: `Order is not awaiting signature - current status is "${orderData.status}".`
      });
      return;
    }

    // Find the esign document
    const esignDocId = orderData.esignDocumentId;
    if (!esignDocId) {
      res.status(400).json({ error: 'No esign document linked to this order' });
      return;
    }

    const esignDocRef = db.collection('esign_documents').doc(esignDocId);
    const esignDoc = await esignDocRef.get();

    if (!esignDoc.exists) {
      res.status(404).json({ error: 'Esign document not found' });
      return;
    }

    const esignData = esignDoc.data()!;
    const signNowDocumentId = esignData.signNowDocumentId;

    if (!signNowDocumentId) {
      res.status(400).json({ error: 'No SignNow document ID found' });
      return;
    }

    // Send the reminder
    const result = await sendSignatureReminder(signNowDocumentId, customMessage);

    if (!result.success) {
      res.status(400).json({ error: result.message });
      return;
    }

    // Log the reminder action
    await esignDocRef.update({
      lastReminderSentAt: admin.firestore.FieldValue.serverTimestamp(),
      reminderCount: admin.firestore.FieldValue.increment(1),
    });

    // Also log in order interaction history
    await db.collection('order_interactions').add({
      orderId: resolvedOrderId,
      orderNumber: orderData.orderNumber,
      type: 'reminder_sent',
      description: 'Signature reminder email sent',
      createdAt: admin.firestore.FieldValue.serverTimestamp(),
      createdBy: 'system',
    });

    res.json({
      success: true,
      message: `Reminder sent for order ${orderData.orderNumber}`,
    });
  } catch (error: any) {
    console.error('Error sending reminder:', error);
    res.status(500).json({ error: error.message || 'Failed to send reminder' });
  }
});

const db = admin.firestore();

/**
 * Triggered when a new document is added to esign_documents collection.
 * Downloads the PDF, extracts data with Claude AI, sends to SignNow.
 * Updated: 2026-01-20
 */
export const processEsignDocument = functions.firestore
  .document('esign_documents/{docId}')
  .onCreate(async (snapshot: FirebaseFirestore.DocumentSnapshot, context: functions.EventContext) => {
    const docId = context.params.docId;
    const data = snapshot.data();

    if (!data) {
      console.log('No data in snapshot');
      return;
    }

    // Skip test mode documents — they don't need SignNow processing
    if (data.isTestMode) {
      console.log(`Skipping test mode document: ${docId}`);
      return;
    }

    // Skip documents created by sendOrderForSignature / sendChangeOrderForSignature
    // — those flows handle SignNow sending themselves
    if (data.sourceType === 'order_form' || data.sourceType === 'change_order') {
      console.log(`Skipping ${data.sourceType} document: ${docId} (handled by order flow)`);
      return;
    }

    console.log(`Processing new document: ${docId}`);

    try {
      // Update status to processing
      await db.doc(`esign_documents/${docId}`).update({
        status: 'processing',
        processedAt: admin.firestore.FieldValue.serverTimestamp(),
      });

      // Download PDF from Firebase Storage
      const bucket = admin.storage().bucket();
      const file = bucket.file(data.storagePath);
      const [pdfBuffer] = await file.download();

      // Extract data from PDF using Claude Vision
      console.log('Extracting data from PDF...');
      let extractedData = null;
      try {
        extractedData = await extractDataFromPdf(pdfBuffer, data.installer || 'Unknown');

        // Store extracted data in Firestore for auditing
        await db.collection('extracted_pdf_data').add({
          documentId: docId,
          orderNumber: data.orderNumber,
          fileName: data.fileName,
          installer: data.installer,
          signer: data.signer,
          ...extractedData,
          createdAt: admin.firestore.FieldValue.serverTimestamp(),
        });
        console.log('Extracted data saved to Firestore');
      } catch (extractError) {
        console.error('PDF extraction failed (continuing with signature):', extractError);
      }

      // Use Firebase Storage URL for pre-signed PDF (already uploaded by client)
      const preSignedPdfLink = data.downloadUrl || '';
      console.log('Pre-signed PDF link (Firebase Storage):', preSignedPdfLink ? 'SET' : 'EMPTY');

      // Check for deposit discrepancy - require approval if off
      if (extractedData?.depositDiscrepancy) {
        console.log(`⚠️ DEPOSIT DISCREPANCY DETECTED - Pausing for approval`);
        console.log(`Expected: $${extractedData.expectedDepositAmount} (${extractedData.expectedDepositPercent}%)`);
        console.log(`Actual: $${extractedData.downPayment} (${extractedData.actualDepositPercent}%)`);
        console.log(`Difference: $${extractedData.depositDiscrepancyAmount}`);

        // Save extracted data and pause for approval
        await db.doc(`esign_documents/${docId}`).update({
          status: 'pending_approval',
          preSignedPdfLink: preSignedPdfLink || null,
          extractedData: {
            customerName: extractedData.customerName,
            subtotal: extractedData.subtotal,
            downPayment: extractedData.downPayment,
            balanceDue: extractedData.balanceDue,
            expectedDepositPercent: extractedData.expectedDepositPercent,
            expectedDepositAmount: extractedData.expectedDepositAmount,
            actualDepositPercent: extractedData.actualDepositPercent,
            depositDiscrepancy: extractedData.depositDiscrepancy,
            depositDiscrepancyAmount: extractedData.depositDiscrepancyAmount,
          },
          approvalRequired: true,
          approvalReason: `Deposit discrepancy: Expected $${extractedData.expectedDepositAmount} (${extractedData.expectedDepositPercent}%), got $${extractedData.downPayment} (${extractedData.actualDepositPercent}%). Difference: $${extractedData.depositDiscrepancyAmount}`,
          pendingApprovalAt: admin.firestore.FieldValue.serverTimestamp(),
        });

        console.log(`Document ${docId} paused - awaiting approval`);
        return; // Don't send to SignNow yet
      }

      // No discrepancy - send to SignNow automatically
      const result = await sendForSignature({
        pdfBuffer,
        fileName: data.fileName,
        signerEmail: data.signer.email,
        signerName: data.signer.name,
        installer: data.installer,
      });

      // Update with success
      await db.doc(`esign_documents/${docId}`).update({
        status: 'sent',
        signNowDocumentId: result.documentId,
        signNowInviteId: result.inviteId,
        preSignedPdfLink: preSignedPdfLink || null,
        extractedData: extractedData ? {
          customerName: extractedData.customerName,
          subtotal: extractedData.subtotal,
          downPayment: extractedData.downPayment,
          balanceDue: extractedData.balanceDue,
          expectedDepositPercent: extractedData.expectedDepositPercent,
          expectedDepositAmount: extractedData.expectedDepositAmount,
          actualDepositPercent: extractedData.actualDepositPercent,
          depositDiscrepancy: extractedData.depositDiscrepancy,
          depositDiscrepancyAmount: extractedData.depositDiscrepancyAmount,
        } : null,
        sentAt: admin.firestore.FieldValue.serverTimestamp(),
      });

      console.log(`Successfully sent document ${docId} for signature`);

      // Add to Google Sheets when sent
      await addDocumentToSheet({
        orderNumber: data.orderNumber || '',
        fileName: data.fileName || '',
        signerName: data.signer?.name || '',
        signerEmail: data.signer?.email || '',
        installer: data.installer || '',
        signNowDocumentId: result.documentId,
        createdAt: new Date(),
        signedAt: new Date(), // placeholder, will be updated
        customerName: extractedData?.customerName || '',
        subtotal: extractedData?.subtotal,
        downPayment: extractedData?.downPayment,
        balanceDue: extractedData?.balanceDue,
        preSignedPdfLink: preSignedPdfLink || '',
        signedPdfLink: '',
        expectedDepositPercent: extractedData?.expectedDepositPercent,
        expectedDepositAmount: extractedData?.expectedDepositAmount,
        actualDepositPercent: extractedData?.actualDepositPercent,
        depositDiscrepancy: extractedData?.depositDiscrepancy,
        depositDiscrepancyAmount: extractedData?.depositDiscrepancyAmount,
      });

    } catch (error) {
      console.error(`Error processing document ${docId}:`, error);

      // Update with error
      await db.doc(`esign_documents/${docId}`).update({
        status: 'error',
        error: error instanceof Error ? error.message : 'Unknown error',
        errorAt: admin.firestore.FieldValue.serverTimestamp(),
      });
    }
  }
);

/**
 * Webhook endpoint to receive SignNow status updates
 */
export const signNowWebhook = functions.https.onRequest(async (req, res) => {
  if (req.method !== 'POST') {
    res.status(405).send('Method not allowed');
    return;
  }

  try {
    const payload = req.body;
    console.log('SignNow webhook received:', JSON.stringify(payload, null, 2));

    // SignNow sends: { meta: { event: '...' }, content: { document_id: '...' } }
    const eventType = payload.meta?.event || payload.event;
    const documentId = payload.content?.document_id || payload.document_id;

    console.log('Event type:', eventType);
    console.log('Document ID:', documentId);

    if (!documentId) {
      console.log('No document ID in webhook payload');
      res.status(200).send('OK');
      return;
    }

    // Find document by SignNow document ID
    const querySnapshot = await db
      .collection('esign_documents')
      .where('signNowDocumentId', '==', documentId)
      .limit(1)
      .get();

    if (querySnapshot.empty) {
      console.log('Document not found for webhook event');
      res.status(200).send('OK');
      return;
    }

    const docRef = querySnapshot.docs[0].ref;
    const docData = querySnapshot.docs[0].data();

    // Update based on event type (document.complete or document_complete)
    if (eventType === 'document.complete' || eventType === 'document_complete') {
      const signedAt = new Date();

      // Download signed PDF from SignNow
      console.log('Downloading signed PDF from SignNow...');
      const signedPdfBuffer = await downloadSignedDocument(documentId);

      // Upload signed PDF to Firebase Storage
      let signedPdfLink = '';
      if (signedPdfBuffer) {
        console.log('Uploading signed PDF to Firebase Storage...');
        const bucket = admin.storage().bucket();
        const signedFileName = `signed/${docData.orderNumber || docRef.id}_${docData.fileName || 'document.pdf'}_SIGNED.pdf`;
        const signedFile = bucket.file(signedFileName);

        await signedFile.save(signedPdfBuffer, {
          metadata: { contentType: 'application/pdf' },
        });

        // Make file publicly accessible and get URL
        await signedFile.makePublic();
        signedPdfLink = `https://storage.googleapis.com/${bucket.name}/${signedFileName}`;
        console.log('Signed PDF uploaded to Firebase Storage:', signedPdfLink);
      }

      await docRef.update({
        status: 'signed',
        signedAt: admin.firestore.FieldValue.serverTimestamp(),
        signedPdfLink: signedPdfLink || null,
      });
      console.log('Document marked as signed');

      // Update order status if this esign document is linked to an order
      try {
        await updateOrderOnSigned(docRef.id);
      } catch (orderUpdateError) {
        console.error('Error updating order on signed:', orderUpdateError);
      }

      // Update Google Sheets with signed info
      await updateSheetOnSigned(
        docData.orderNumber || '',
        signedAt,
        signedPdfLink
      );
    }

    res.status(200).send('OK');
  } catch (error) {
    console.error('Webhook error:', error);
    res.status(500).send('Error processing webhook');
  }
});

/**
 * HTTP endpoint to approve and send a document with deposit discrepancy
 * Called when user clicks "Send Anyway" in the UI
 */
export const approveAndSend = functions.https.onRequest(async (req, res) => {
  // Enable CORS
  res.set('Access-Control-Allow-Origin', '*');
  res.set('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.set('Access-Control-Allow-Headers', 'Content-Type');

  if (req.method === 'OPTIONS') {
    res.status(204).send('');
    return;
  }

  if (req.method !== 'POST') {
    res.status(405).send('Method not allowed');
    return;
  }

  try {
    const { documentId, approvedBy } = req.body;

    if (!documentId) {
      res.status(400).json({ error: 'Missing documentId' });
      return;
    }

    console.log(`Approval request for document: ${documentId} by ${approvedBy || 'unknown'}`);

    // Get the document
    const docRef = db.doc(`esign_documents/${documentId}`);
    const docSnap = await docRef.get();

    if (!docSnap.exists) {
      res.status(404).json({ error: 'Document not found' });
      return;
    }

    const data = docSnap.data()!;

    // Verify status is pending_approval
    if (data.status !== 'pending_approval') {
      res.status(400).json({ error: `Document is not pending approval. Current status: ${data.status}` });
      return;
    }

    console.log(`Approving document ${documentId} - sending to SignNow...`);

    // Download PDF from Firebase Storage
    const bucket = admin.storage().bucket();
    const file = bucket.file(data.storagePath);
    const [pdfBuffer] = await file.download();

    // Send to SignNow
    const result = await sendForSignature({
      pdfBuffer,
      fileName: data.fileName,
      signerEmail: data.signer.email,
      signerName: data.signer.name,
      installer: data.installer,
    });

    // Update document with success
    await docRef.update({
      status: 'sent',
      signNowDocumentId: result.documentId,
      signNowInviteId: result.inviteId,
      approvedBy: approvedBy || 'unknown',
      approvedAt: admin.firestore.FieldValue.serverTimestamp(),
      sentAt: admin.firestore.FieldValue.serverTimestamp(),
    });

    console.log(`Document ${documentId} approved and sent to SignNow`);

    // Add to Google Sheets
    const extractedData = data.extractedData;
    await addDocumentToSheet({
      orderNumber: data.orderNumber || '',
      fileName: data.fileName || '',
      signerName: data.signer?.name || '',
      signerEmail: data.signer?.email || '',
      installer: data.installer || '',
      signNowDocumentId: result.documentId,
      createdAt: new Date(),
      signedAt: new Date(),
      customerName: extractedData?.customerName || '',
      subtotal: extractedData?.subtotal,
      downPayment: extractedData?.downPayment,
      balanceDue: extractedData?.balanceDue,
      preSignedPdfLink: data.preSignedPdfLink || '',
      signedPdfLink: '',
      expectedDepositPercent: extractedData?.expectedDepositPercent,
      expectedDepositAmount: extractedData?.expectedDepositAmount,
      actualDepositPercent: extractedData?.actualDepositPercent,
      depositDiscrepancy: extractedData?.depositDiscrepancy,
      depositDiscrepancyAmount: extractedData?.depositDiscrepancyAmount,
    });

    res.status(200).json({
      success: true,
      message: 'Document approved and sent for signature',
      signNowDocumentId: result.documentId,
    });
  } catch (error) {
    console.error('Approval error:', error);
    res.status(500).json({ error: error instanceof Error ? error.message : 'Unknown error' });
  }
});

/**
 * HTTP endpoint to seed initial data (admin options and mock quotes)
 * Call once to initialize the system
 */
export const seedInitialData = functions.https.onRequest(async (req, res) => {
  // Enable CORS
  res.set('Access-Control-Allow-Origin', '*');
  res.set('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.set('Access-Control-Allow-Headers', 'Content-Type');

  if (req.method === 'OPTIONS') {
    res.status(204).send('');
    return;
  }

  if (req.method !== 'POST') {
    res.status(405).send('Method not allowed');
    return;
  }

  try {
    const { seedType, count } = req.body;

    if (seedType === 'admin_options' || seedType === 'all') {
      await seedAdminOptions();
      console.log('Admin options seeded');
    }

    if (seedType === 'manufacturer_config' || seedType === 'all') {
      await seedManufacturerConfig();
      console.log('Manufacturer config seeded');
    }

    if (seedType === 'quotes' || seedType === 'all') {
      await seedMockQuotes();
      console.log('Mock quotes seeded');
    }

    if (seedType === 'bulk_quotes') {
      const numQuotes = count || 50;
      const created = await seedBulkQuotes(numQuotes);
      res.status(200).json({
        success: true,
        message: `Created ${created} test quotes`,
        count: created,
      });
      return;
    }

    if (seedType === 'test_orders') {
      const numOrders = count || 10;
      const result = await seedTestOrders(numOrders);
      res.status(200).json({
        success: true,
        message: `Created ${result.created} test orders with various payment scenarios`,
        count: result.created,
        orders: result.orders,
      });
      return;
    }

    if (seedType === 'partial_payment_orders') {
      const result = await seedPartialPaymentOrders();
      res.status(200).json({
        success: true,
        message: `Created ${result.created} partial payment test orders with different payment methods`,
        count: result.created,
        orders: result.orders,
      });
      return;
    }

    if (seedType === 'overpaid_orders') {
      const result = await seedOverpaidOrders();
      res.status(200).json({
        success: true,
        message: `Created ${result.created} OVERPAID orders (refund due) with different payment methods`,
        count: result.created,
        orders: result.orders,
      });
      return;
    }

    res.status(200).json({
      success: true,
      message: `Seed completed for: ${seedType || 'all'}`,
    });
  } catch (error) {
    console.error('Seed error:', error);
    res.status(500).json({ error: error instanceof Error ? error.message : 'Unknown error' });
  }
});

/**
 * Admin endpoint to delete test orders
 * Usage: POST /deleteTestOrders { orderNumbers: ['ORD-00028', 'ORD-00029', ...] }
 */
export const deleteTestOrders = functions.https.onRequest(async (req, res) => {
  res.set('Access-Control-Allow-Origin', '*');
  res.set('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.set('Access-Control-Allow-Headers', 'Content-Type');

  if (req.method === 'OPTIONS') {
    res.status(204).send('');
    return;
  }

  try {
    const { orderNumbers } = req.body;

    if (!orderNumbers || !Array.isArray(orderNumbers)) {
      res.status(400).json({ error: 'orderNumbers array is required' });
      return;
    }

    const db = admin.firestore();
    const deleted: string[] = [];
    const errors: string[] = [];

    for (const orderNumber of orderNumbers) {
      try {
        // Find order by orderNumber where createdBy is 'test-script'
        const ordersSnap = await db.collection('orders')
          .where('orderNumber', '==', orderNumber)
          .where('createdBy', '==', 'test-script')
          .get();

        if (ordersSnap.empty) {
          console.log(`No test order found for ${orderNumber}`);
          continue;
        }

        for (const orderDoc of ordersSnap.docs) {
          const orderId = orderDoc.id;
          console.log(`Deleting ${orderNumber} (${orderId})...`);

          // Delete ledger entries
          const ledgerSnap = await db.collection('payment_ledger')
            .where('orderId', '==', orderId)
            .get();

          for (const ledgerDoc of ledgerSnap.docs) {
            await ledgerDoc.ref.delete();
          }

          // Delete ledger summary
          const summaryRef = db.collection('ledger_summaries').doc(orderId);
          const summaryDoc = await summaryRef.get();
          if (summaryDoc.exists) {
            await summaryRef.delete();
          }

          // Delete the order
          await orderDoc.ref.delete();
          deleted.push(orderNumber);
        }
      } catch (err) {
        console.error(`Error deleting ${orderNumber}:`, err);
        errors.push(`${orderNumber}: ${err}`);
      }
    }

    res.status(200).json({
      success: true,
      deleted,
      errors,
      message: `Deleted ${deleted.length} test orders`,
    });
  } catch (error) {
    console.error('Delete error:', error);
    res.status(500).json({ error: error instanceof Error ? error.message : 'Unknown error' });
  }
});

/**
 * Admin endpoint to fix change order status
 * Usage: POST /fixChangeOrderStatus { changeOrderId, newStatus }
 */
export const fixChangeOrderStatus = functions.https.onRequest(async (req, res) => {
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
    const { changeOrderId, newStatus } = req.body;

    if (!changeOrderId || !newStatus) {
      res.status(400).json({ error: 'changeOrderId and newStatus are required' });
      return;
    }

    const validStatuses = ['draft', 'pending_signature', 'signed', 'cancelled', 'superseded'];
    if (!validStatuses.includes(newStatus)) {
      res.status(400).json({ error: `Invalid status. Valid statuses: ${validStatuses.join(', ')}` });
      return;
    }

    const db = admin.firestore();
    const coRef = db.collection('change_orders').doc(changeOrderId);
    const coDoc = await coRef.get();

    if (!coDoc.exists) {
      res.status(404).json({ error: 'Change order not found' });
      return;
    }

    const previousStatus = coDoc.data()?.status;
    await coRef.update({
      status: newStatus,
      updatedAt: admin.firestore.FieldValue.serverTimestamp(),
    });

    res.status(200).json({
      success: true,
      changeOrderId,
      previousStatus,
      newStatus,
      message: `Change order status updated from ${previousStatus} to ${newStatus}`,
    });
  } catch (error) {
    console.error('Fix CO status error:', error);
    res.status(500).json({ error: error instanceof Error ? error.message : 'Unknown error' });
  }
});

/**
 * Admin endpoint to set user role
 * Usage: POST /setUserRole { email, role }
 * Roles: 'admin', 'manager', 'sales_rep'
 */
export const setUserRole = functions.https.onRequest(async (req, res) => {
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
    const { email, role } = req.body;

    if (!email || !role) {
      res.status(400).json({ error: 'email and role are required' });
      return;
    }

    const validRoles = ['admin', 'manager', 'sales_rep'];
    if (!validRoles.includes(role)) {
      res.status(400).json({ error: `Invalid role. Valid roles: ${validRoles.join(', ')}` });
      return;
    }

    const db = admin.firestore();
    await db.collection('user_roles').doc(email).set({
      email,
      role,
      updatedAt: admin.firestore.FieldValue.serverTimestamp(),
    });

    res.status(200).json({
      success: true,
      email,
      role,
      message: `User ${email} set to ${role}`,
    });
  } catch (error) {
    console.error('Set user role error:', error);
    res.status(500).json({ error: error instanceof Error ? error.message : 'Unknown error' });
  }
});

/**
 * Get all user roles
 * Usage: GET /getUserRoles
 */
export const getUserRoles = functions.https.onRequest(async (req, res) => {
  res.set('Access-Control-Allow-Origin', '*');
  res.set('Access-Control-Allow-Methods', 'GET, OPTIONS');
  res.set('Access-Control-Allow-Headers', 'Content-Type');

  if (req.method === 'OPTIONS') {
    res.status(204).send('');
    return;
  }

  try {
    const db = admin.firestore();
    const snapshot = await db.collection('user_roles').get();

    const roles: any[] = [];
    snapshot.forEach((doc) => {
      roles.push({ id: doc.id, ...doc.data() });
    });

    res.status(200).json({
      success: true,
      roles,
    });
  } catch (error) {
    console.error('Get user roles error:', error);
    res.status(500).json({ error: error instanceof Error ? error.message : 'Unknown error' });
  }
});
