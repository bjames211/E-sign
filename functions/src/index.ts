import * as dotenv from 'dotenv';
dotenv.config();

import * as functions from 'firebase-functions/v1';
import * as admin from 'firebase-admin';
import { sendForSignature, downloadSignedDocument, cancelSigningInvite } from './signNowService';
import { extractDataFromPdf } from './pdfExtractor';
import { addDocumentToSheet, updateSheetOnSigned } from './googleSheetsService';
import { seedAdminOptions, seedMockQuotes, seedBulkQuotes } from './seedData';
import {
  createPaymentIntent,
  verifyPayment,
  createPaymentLink,
  stripeWebhook,
  verifyPaymentForOrder,
  approveManualPayment,
} from './stripeFunctions';
import {
  addPaymentRecord,
  approvePaymentRecord,
  verifyStripePaymentRecord,
  rejectPaymentRecord,
  getPaymentsForOrder,
  recalculatePaymentSummary,
  chargeCardOnFile,
} from './paymentFunctions';
import { sendOrderForSignature, updateOrderOnSigned, migrateOrderPaymentStatus, syncOrderStatusFromEsign, sendChangeOrderForSignature, testSignOrder, testSignChangeOrder } from './orderEsignBridge';

admin.initializeApp();

// Export Stripe functions
export {
  createPaymentIntent,
  verifyPayment,
  createPaymentLink,
  stripeWebhook,
  verifyPaymentForOrder,
  approveManualPayment,
};

// Export Order-to-ESign bridge functions
export { sendOrderForSignature, migrateOrderPaymentStatus, sendChangeOrderForSignature, testSignOrder, testSignChangeOrder };

// Export Payment functions
export {
  addPaymentRecord,
  approvePaymentRecord,
  verifyStripePaymentRecord,
  rejectPaymentRecord,
  getPaymentsForOrder,
  recalculatePaymentSummary,
  chargeCardOnFile,
};

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

    res.status(200).json({
      success: true,
      message: `Seed completed for: ${seedType || 'all'}`,
    });
  } catch (error) {
    console.error('Seed error:', error);
    res.status(500).json({ error: error instanceof Error ? error.message : 'Unknown error' });
  }
});
