import * as dotenv from 'dotenv';
dotenv.config();

import * as functions from 'firebase-functions/v1';
import * as admin from 'firebase-admin';
import { sendForSignature } from './signNowService';

admin.initializeApp();

const db = admin.firestore();

/**
 * Triggered when a new document is added to esign_documents collection.
 * Downloads the PDF, sends it to SignNow with text anchoring, and updates status.
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
    const event = req.body;
    console.log('SignNow webhook received:', event);

    // Find document by SignNow document ID
    const querySnapshot = await db
      .collection('esign_documents')
      .where('signNowDocumentId', '==', event.document_id)
      .limit(1)
      .get();

    if (querySnapshot.empty) {
      console.log('Document not found for webhook event');
      res.status(200).send('OK');
      return;
    }

    const docRef = querySnapshot.docs[0].ref;

    // Update based on event type
    if (event.event === 'document_complete') {
      await docRef.update({
        status: 'signed',
        signedAt: admin.firestore.FieldValue.serverTimestamp(),
      });
      console.log('Document marked as signed');
    }

    res.status(200).send('OK');
  } catch (error) {
    console.error('Webhook error:', error);
    res.status(500).send('Error processing webhook');
  }
});
