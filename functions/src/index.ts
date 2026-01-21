import * as dotenv from 'dotenv';
dotenv.config();

import * as functions from 'firebase-functions/v1';
import * as admin from 'firebase-admin';
import { sendForSignature } from './signNowService';
import { extractDataFromPdf } from './pdfExtractor';
import { appendToSheet } from './googleSheetsService';

admin.initializeApp();

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

      // Send to SignNow
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
        extractedData: extractedData ? {
          customerName: extractedData.customerName,
          subtotal: extractedData.subtotal,
          downPayment: extractedData.downPayment,
          balanceDue: extractedData.balanceDue,
        } : null,
        sentAt: admin.firestore.FieldValue.serverTimestamp(),
      });

      console.log(`Successfully sent document ${docId} for signature`);

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

      await docRef.update({
        status: 'signed',
        signedAt: admin.firestore.FieldValue.serverTimestamp(),
      });
      console.log('Document marked as signed');

      // Backup to Google Sheets
      await appendToSheet({
        orderNumber: docData.orderNumber || '',
        fileName: docData.fileName || '',
        signerName: docData.signer?.name || '',
        signerEmail: docData.signer?.email || '',
        installer: docData.installer || '',
        signNowDocumentId: documentId,
        createdAt: docData.createdAt?.toDate() || new Date(),
        signedAt: signedAt,
        customerName: docData.extractedData?.customerName,
        subtotal: docData.extractedData?.subtotal,
        downPayment: docData.extractedData?.downPayment,
        balanceDue: docData.extractedData?.balanceDue,
      });
    }

    res.status(200).send('OK');
  } catch (error) {
    console.error('Webhook error:', error);
    res.status(500).send('Error processing webhook');
  }
});
