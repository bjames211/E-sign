import * as functions from 'firebase-functions/v1';
import * as admin from 'firebase-admin';
import axios from 'axios';
import { addDocumentToSheet } from './googleSheetsService';
import { sendForSignature } from './signNowService';
import { extractDataFromPdf, ExtractedPdfData } from './pdfExtractor';
import { createLedgerEntry, updateOrderLedgerSummary } from './paymentLedgerFunctions';
import { getDepositPercent, getSkuForManufacturer } from './manufacturerConfigService';
import { isValidApprovalCode } from './config/approvalCode';
import { stripe } from './config/stripe';

// Manual payment types that require manager approval
const MANUAL_PAYMENT_TYPES = ['check', 'wire', 'credit_on_file', 'other'];

interface ValidationResult {
  valid: boolean;
  requiresManagerApproval: boolean;
  errors: string[];
  warnings: string[];
  pdfData: ExtractedPdfData | null;
}

interface OrderFile {
  name: string;
  storagePath: string;
  downloadUrl: string;
  size: number;
  type: string;
}

interface OrderFiles {
  orderFormPdf?: OrderFile;
  renderings: OrderFile[];
  extraFiles: OrderFile[];
  installerFiles: OrderFile[];
}

interface OrderData {
  id: string;
  orderNumber: string;
  status: string;
  customer: {
    firstName: string;
    lastName: string;
    deliveryAddress: string;
    state: string;
    zip: string;
    phone: string;
    email: string;
  };
  building: {
    manufacturer: string;
    buildingType: string;
    overallWidth: string;
    buildingLength: string;
    baseRailLength: string;
    buildingHeight: string;
    lullLiftRequired: boolean;
    foundationType: string;
    permittingStructure: string;
    drawingType: string;
    customerLandIsReady: boolean;
  };
  pricing: {
    subtotalBeforeTax: number;
    extraMoneyFluff: number;
    deposit: number;
  };
  payment: {
    type: string;
    status?: string;
    stripePaymentId?: string;
    stripeVerification?: {
      verified: boolean;
      paymentAmount?: number;
      paymentAmountDollars?: number;
      matchesDeposit: boolean;
      amountDifference?: number;
      isUnique: boolean;
      duplicateOrderId?: string;
      stripeStatus?: string;
      errorMessage?: string;
    };
    notes?: string;
  };
  files: OrderFiles;
  salesPerson: string;
  orderFormName: string;
  paymentNotes: string;
  referredBy: string;
  specialNotes: string;
}

/**
 * Validate PDF data against order form data
 */
async function validateOrderWithPdf(
  orderData: OrderData,
  pdfBuffer: Buffer
): Promise<ValidationResult> {
  const errors: string[] = [];
  const warnings: string[] = [];
  let requiresManagerApproval = false;

  // Extract data from PDF using Claude AI
  console.log('Extracting PDF data for validation...');
  let pdfData: ExtractedPdfData | null = null;

  try {
    const expectedSku = await getSkuForManufacturer(orderData.building.manufacturer);
    pdfData = await extractDataFromPdf(pdfBuffer, orderData.building.manufacturer, expectedSku);
  } catch (extractError) {
    console.error('Failed to extract PDF data:', extractError);
    errors.push('Failed to extract data from PDF for validation');
    return { valid: false, requiresManagerApproval: false, errors, warnings, pdfData: null };
  }

  const customerName = `${orderData.customer.firstName} ${orderData.customer.lastName}`.trim().toLowerCase();

  // 1. Validate customer name matches
  if (pdfData.customerName) {
    const pdfCustomerName = pdfData.customerName.toLowerCase();
    if (!pdfCustomerName.includes(orderData.customer.firstName.toLowerCase()) &&
        !pdfCustomerName.includes(orderData.customer.lastName.toLowerCase())) {
      warnings.push(`Customer name mismatch: Form has "${customerName}", PDF has "${pdfData.customerName}"`);
    }
  }

  // 2. Validate email matches
  if (pdfData.email && orderData.customer.email) {
    if (pdfData.email.toLowerCase() !== orderData.customer.email.toLowerCase()) {
      warnings.push(`Email mismatch: Form has "${orderData.customer.email}", PDF has "${pdfData.email}"`);
    }
  }

  // 3. Validate subtotal matches (within $10 tolerance)
  if (pdfData.subtotal !== null && orderData.pricing.subtotalBeforeTax) {
    const subtotalDiff = Math.abs(pdfData.subtotal - orderData.pricing.subtotalBeforeTax);
    if (subtotalDiff > 10) {
      warnings.push(`Subtotal mismatch: Form has $${orderData.pricing.subtotalBeforeTax}, PDF has $${pdfData.subtotal}`);
    }
  }

  // 4. Validate deposit matches (within $10 tolerance)
  if (pdfData.downPayment !== null && orderData.pricing.deposit) {
    const depositDiff = Math.abs(pdfData.downPayment - orderData.pricing.deposit);
    if (depositDiff > 10) {
      warnings.push(`Deposit mismatch: Form has $${orderData.pricing.deposit}, PDF has $${pdfData.downPayment}`);
    }
  }

  // 5. Check SKU/form ID mismatch (warning only, not a blocker)
  if (pdfData.skuMismatch) {
    warnings.push(`Form SKU mismatch: expected "${pdfData.expectedSku}", found "${pdfData.manufacturerSku}"`);
  }

  // 6. CRITICAL: Check deposit percentage - requires manager approval if off
  // Skip validation if no deposit percent is configured (variable/tiered pricing)
  const expectedPercent = await getDepositPercent(orderData.building.manufacturer, orderData.pricing.subtotalBeforeTax);
  const actualPercent = orderData.pricing.subtotalBeforeTax > 0
    ? (orderData.pricing.deposit / orderData.pricing.subtotalBeforeTax) * 100
    : 0;

  if (expectedPercent != null) {
    const percentDiff = Math.abs(actualPercent - expectedPercent);

    // Very small tolerance (0.5%) for rounding - any significant difference requires manager approval
    if (percentDiff > 0.5) {
      requiresManagerApproval = true;
      const expectedDeposit = (orderData.pricing.subtotalBeforeTax * expectedPercent / 100).toFixed(2);
      errors.push(
        `Deposit percentage is ${actualPercent.toFixed(1)}% (expected ${expectedPercent}% for ${orderData.building.manufacturer}). ` +
        `Expected deposit: $${expectedDeposit}, Actual: $${orderData.pricing.deposit}. ` +
        `Manager approval required.`
      );
    }
  }

  // Also note PDF deposit discrepancy if detected (warning only, not blocking)
  if (pdfData.depositDiscrepancy) {
    warnings.push(
      `PDF shows deposit discrepancy: Expected $${pdfData.expectedDepositAmount} (${pdfData.expectedDepositPercent}%), ` +
      `Actual $${pdfData.downPayment} (${pdfData.actualDepositPercent}%)`
    );
  }

  console.log('Validation result:', {
    valid: errors.length === 0,
    requiresManagerApproval,
    errors,
    warnings
  });

  return {
    valid: errors.length === 0,
    requiresManagerApproval,
    errors,
    warnings,
    pdfData,
  };
}

interface StripeVerificationResult {
  verified: boolean;
  paymentAmount: number;        // Cents (negative for refunds)
  paymentAmountDollars: number; // Dollars (negative for refunds)
  matchesDeposit: boolean;
  amountDifference: number;
  isUnique: boolean;
  duplicateOrderId?: string;
  stripeStatus: string;
  errorMessage?: string;
  stripeCustomerId?: string;  // Customer ID for future charges
  isRefund?: boolean;         // True if this is a refund
}

/**
 * Verify Stripe payment for an order
 * Checks: payment exists, amount matches deposit, payment ID is unique
 */
async function verifyStripePayment(
  db: admin.firestore.Firestore,
  paymentId: string,
  expectedDeposit: number,
  currentOrderId: string
): Promise<StripeVerificationResult> {
  const result: StripeVerificationResult = {
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

  try {
    // 1. Verify payment/refund exists in Stripe
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
      return result;
    }

    // Convert to dollars
    result.paymentAmountDollars = result.paymentAmount / 100;

    // 2. Check if amount matches deposit (allow $1 tolerance)
    result.amountDifference = Math.abs(result.paymentAmountDollars - expectedDeposit);
    result.matchesDeposit = result.amountDifference <= 1;

    if (!result.matchesDeposit) {
      result.errorMessage = `Payment amount ($${result.paymentAmountDollars}) does not match deposit ($${expectedDeposit})`;
    }

    // 3. Check if payment ID is unique (not used by another order)
    const existingOrdersQuery = await db
      .collection('orders')
      .where('payment.stripePaymentId', '==', paymentId)
      .limit(2)
      .get();

    const otherOrders = existingOrdersQuery.docs.filter(doc => doc.id !== currentOrderId);
    if (otherOrders.length > 0) {
      result.isUnique = false;
      result.duplicateOrderId = otherOrders[0].id;
      const duplicateOrder = otherOrders[0].data();
      result.errorMessage = `Payment ID already used by order ${duplicateOrder.orderNumber || otherOrders[0].id}`;
    }

    console.log(`Stripe verification for ${paymentId}: verified=${result.verified}, amount=$${result.paymentAmountDollars}, matches=${result.matchesDeposit}, unique=${result.isUnique}`);
  } catch (stripeError) {
    if (stripeError instanceof Error && (stripeError as { code?: string }).code === 'resource_missing') {
      result.errorMessage = 'Payment not found in Stripe';
    } else {
      result.errorMessage = stripeError instanceof Error ? stripeError.message : 'Stripe verification failed';
    }
    console.error('Stripe verification error:', stripeError);
  }

  return result;
}

/**
 * Send an order for signature
 * Creates an esign_documents record and triggers the existing e-sign flow
 */
export const sendOrderForSignature = functions.https.onRequest(async (req, res) => {
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
    const db = admin.firestore();
    const { orderId } = req.body;

    if (!orderId) {
      res.status(400).json({ error: 'Order ID is required' });
      return;
    }

    console.log(`Processing order for signature: ${orderId}`);

    // Get order data
    const orderRef = db.doc(`orders/${orderId}`);
    const orderSnap = await orderRef.get();

    if (!orderSnap.exists) {
      res.status(404).json({ error: 'Order not found' });
      return;
    }

    const orderData = { id: orderSnap.id, ...orderSnap.data() } as OrderData;

    // Check if manager approval bypass is requested
    const { managerApprovalCode, paymentApprovalCode, testMode, approvedByEmail, approvedByRole } = req.body;
    // Check approval via code or manager role
    let hasPaymentApproval = paymentApprovalCode ? isValidApprovalCode(paymentApprovalCode) : false;
    if (!hasPaymentApproval && approvedByEmail && (approvedByRole === 'manager' || approvedByRole === 'admin')) {
      const roleDoc = await admin.firestore().collection('user_roles').doc(approvedByEmail).get();
      if (roleDoc.exists && ['manager', 'admin'].includes(roleDoc.data()!.role)) {
        hasPaymentApproval = true;
      }
    }
    // Use test mode if explicitly requested OR if order was created in test mode
    const isTestMode = testMode === true || (orderData as any).isTestMode === true;

    // Validate order status
    if (orderData.status !== 'draft') {
      res.status(400).json({
        error: `Order cannot be sent for signature. Current status: ${orderData.status}`,
      });
      return;
    }

    // Validate order has uploaded PDF (skip in test mode)
    if (!isTestMode && !orderData.files?.orderFormPdf?.downloadUrl) {
      res.status(400).json({
        error: 'Order must have an uploaded Order Form PDF to send for signature',
      });
      return;
    }

    // TEST MODE: Skip validations but still send via SignNow if PDF exists
    if (isTestMode) {
      console.log(`TEST MODE: Skipping validations for order ${orderId}`);

      // Create esign document record for test mode
      const customerName = `${orderData.customer.firstName} ${orderData.customer.lastName}`.trim();

      // Try to send via SignNow if PDF is available (so customer gets the email)
      let signNowDocId = `test_doc_${Date.now()}`;
      let signNowInvId = `test_invite_${Date.now()}`;
      let sentViaSignNow = false;

      if (orderData.files?.orderFormPdf?.downloadUrl) {
        try {
          console.log('TEST MODE: PDF found, sending via SignNow for real email delivery...');
          const pdfResponse = await axios.get(orderData.files.orderFormPdf.downloadUrl, {
            responseType: 'arraybuffer',
          });
          const pdfBuffer = Buffer.from(pdfResponse.data);

          const signNowResult = await sendForSignature({
            pdfBuffer,
            fileName: orderData.files.orderFormPdf.name || `${orderData.orderNumber}_order.pdf`,
            signerEmail: orderData.customer.email,
            signerName: customerName,
            installer: orderData.building.manufacturer,
          });

          signNowDocId = signNowResult.documentId;
          signNowInvId = signNowResult.inviteId;
          sentViaSignNow = true;
          console.log(`TEST MODE: SignNow document created: ${signNowDocId}, email sent to ${orderData.customer.email}`);
        } catch (signNowError) {
          console.warn('TEST MODE: Failed to send via SignNow, using mock IDs:', signNowError);
          // Continue with mock IDs - don't block the test flow
        }
      } else {
        console.log('TEST MODE: No PDF uploaded, using mock SignNow IDs (no email sent)');
      }

      const esignDocData = {
        orderNumber: orderData.orderNumber,
        fileName: orderData.files?.orderFormPdf?.name || `${orderData.orderNumber}_test_order.pdf`,
        sourceType: 'order_form',
        orderId: orderId,
        signer: {
          email: orderData.customer.email,
          name: customerName,
        },
        installer: orderData.building.manufacturer,
        status: 'sent',
        isTestMode: true,
        sentViaSignNow,
        createdAt: admin.firestore.FieldValue.serverTimestamp(),
        sentAt: admin.firestore.FieldValue.serverTimestamp(),
        signNowDocumentId: signNowDocId,
        signNowInviteId: signNowInvId,
        formData: {
          customerName,
          customerEmail: orderData.customer.email,
          subtotal: orderData.pricing.subtotalBeforeTax,
          downPayment: orderData.pricing.deposit,
        },
      };

      const esignDocRef = await db.collection('esign_documents').add(esignDocData);
      console.log(`TEST MODE: Created esign_documents record: ${esignDocRef.id}`);

      // CRITICAL: Create ledger entry FIRST (source of truth), then update order
      const isStripePayment = orderData.payment?.type?.startsWith('stripe');
      if (isStripePayment) {
        const depositAmount = orderData.pricing?.deposit || 0;
        if (depositAmount > 0) {
          await createLedgerEntry({
            orderId,
            orderNumber: orderData.orderNumber,
            transactionType: 'payment',
            amount: depositAmount,
            method: 'stripe',
            category: 'initial_deposit',
            status: 'verified',
            stripePaymentId: orderData.payment?.stripePaymentId || undefined,
            stripeVerified: true,
            description: `Test mode Stripe payment`,
            createdBy: 'system',
          }, db);
          await updateOrderLedgerSummary(orderId, db);
          console.log(`TEST MODE: Ledger entry created for order ${orderId}`);
        }
      }

      // Now update order status
      await orderRef.update({
        status: 'sent_for_signature',
        esignDocumentId: esignDocRef.id,
        sentForSignatureAt: admin.firestore.FieldValue.serverTimestamp(),
        isTestMode: true,
        'payment.status': isStripePayment ? 'paid' : orderData.payment?.status,
      });

      console.log(`TEST MODE: Order ${orderId} marked as sent_for_signature`);

      res.status(200).json({
        success: true,
        testMode: true,
        sentViaSignNow,
        message: sentViaSignNow
          ? 'TEST MODE: Order sent for signature via SignNow (email sent to customer)'
          : 'TEST MODE: Order marked as sent for signature (no PDF, no email sent)',
        orderId,
        esignDocumentId: esignDocRef.id,
      });
      return;
    }

    // ========== PAYMENT VERIFICATION ==========
    // Note: Payment proof is NOT required before sending for signature.
    // Payment approval with proof is required AFTER signing, before "Ready for Manufacturer"
    const paymentType = orderData.payment?.type;

    // For manual payment types, mark as needing payment approval (but don't block signature)
    if (MANUAL_PAYMENT_TYPES.includes(paymentType)) {
      const paymentStatus = orderData.payment?.status;
      const isPaymentApproved = paymentStatus === 'paid' || paymentStatus === 'manually_approved';

      if (!isPaymentApproved) {
        // Mark that payment approval will be needed after signing
        await orderRef.update({
          needsPaymentApproval: true,
        });
        console.log(`Order ${orderId} has manual payment type (${paymentType}) - will need payment approval after signing`);
      }
    }

    // Verify Stripe payment if "already paid"
    if (paymentType === 'stripe_already_paid') {
      const stripePaymentId = orderData.payment?.stripePaymentId;

      if (!stripePaymentId) {
        res.status(400).json({
          error: 'Stripe payment ID is required for "Already Paid" payment type',
        });
        return;
      }

      const stripeVerification = await verifyStripePayment(
        db,
        stripePaymentId,
        orderData.pricing.deposit,
        orderId
      );

      // Save verification results
      await orderRef.update({
        'payment.stripeVerification': {
          verified: stripeVerification.verified,
          verifiedAt: admin.firestore.FieldValue.serverTimestamp(),
          paymentAmount: stripeVerification.paymentAmount,
          paymentAmountDollars: stripeVerification.paymentAmountDollars,
          matchesDeposit: stripeVerification.matchesDeposit,
          amountDifference: stripeVerification.amountDifference,
          isUnique: stripeVerification.isUnique,
          duplicateOrderId: stripeVerification.duplicateOrderId || null,
          stripeStatus: stripeVerification.stripeStatus,
          errorMessage: stripeVerification.errorMessage || null,
        },
      });

      // Block if verification failed
      if (!stripeVerification.verified) {
        res.status(200).json({
          success: false,
          stripeVerificationFailed: true,
          error: stripeVerification.errorMessage || 'Payment not verified in Stripe',
          stripeVerification,
          orderId,
        });
        return;
      }

      // Block if payment ID is not unique
      if (!stripeVerification.isUnique) {
        res.status(200).json({
          success: false,
          stripeVerificationFailed: true,
          error: stripeVerification.errorMessage,
          duplicateOrderId: stripeVerification.duplicateOrderId,
          stripeVerification,
          orderId,
        });
        return;
      }

      // Block if amount doesn't match (but allow with manager approval)
      if (!stripeVerification.matchesDeposit && !hasPaymentApproval) {
        res.status(200).json({
          success: false,
          requiresPaymentApproval: true,
          stripeAmountMismatch: true,
          message: `Stripe payment amount ($${stripeVerification.paymentAmountDollars}) does not match deposit ($${orderData.pricing.deposit}). Manager approval required.`,
          stripeVerification,
          orderId,
        });
        return;
      }

      // CRITICAL: Create ledger entry FIRST (source of truth), then update order
      const paymentAmountDollars = stripeVerification.paymentAmountDollars || orderData.pricing.deposit;
      await createLedgerEntry({
        orderId,
        orderNumber: orderData.orderNumber,
        transactionType: 'payment',
        amount: paymentAmountDollars,
        method: 'stripe',
        category: 'initial_deposit',
        status: 'verified',
        stripePaymentId: orderData.payment?.stripePaymentId || undefined,
        stripeVerified: true,
        stripeAmount: stripeVerification.paymentAmount,
        stripeAmountDollars: stripeVerification.paymentAmountDollars,
        description: `Stripe payment verified`,
        createdBy: 'system',
      }, db);
      await updateOrderLedgerSummary(orderId, db);
      console.log(`Ledger entry created for Stripe payment on order ${orderId}`);

      // Now update order status
      const paymentUpdateData: Record<string, unknown> = {
        'payment.status': 'paid',
        paidAt: admin.firestore.FieldValue.serverTimestamp(),
        needsPaymentApproval: false,
      };
      // Save customer ID for future card-on-file charges
      if (stripeVerification.stripeCustomerId) {
        paymentUpdateData['payment.stripeCustomerId'] = stripeVerification.stripeCustomerId;
        console.log(`Saving Stripe customer ${stripeVerification.stripeCustomerId} to order ${orderId}`);
      }
      await orderRef.update(paymentUpdateData);
      console.log(`Stripe payment verified for order ${orderId}`);
    }
    let hasManagerApproval = managerApprovalCode ? isValidApprovalCode(managerApprovalCode) : false;
    if (!hasManagerApproval && approvedByEmail && (approvedByRole === 'manager' || approvedByRole === 'admin')) {
      // Already verified role above via hasPaymentApproval check, reuse
      hasManagerApproval = hasPaymentApproval;
    }

    // Download the PDF from Firebase Storage (we've validated it exists above for non-test mode)
    console.log('Downloading PDF from:', orderData.files.orderFormPdf!.downloadUrl);
    let pdfBuffer: Buffer;
    try {
      const pdfResponse = await axios.get(orderData.files.orderFormPdf!.downloadUrl, {
        responseType: 'arraybuffer',
      });
      pdfBuffer = Buffer.from(pdfResponse.data);
      console.log(`Downloaded PDF: ${pdfBuffer.length} bytes`);
    } catch (downloadError) {
      console.error('Failed to download PDF:', downloadError);
      res.status(500).json({ error: 'Failed to download order form PDF' });
      return;
    }

    // Validate PDF against form data using AI
    const validation = await validateOrderWithPdf(orderData, pdfBuffer);

    const expectedDepositPercent = await getDepositPercent(orderData.building.manufacturer, orderData.pricing.subtotalBeforeTax);
    const actualDepositPercent = orderData.pricing.subtotalBeforeTax > 0
      ? Math.round((orderData.pricing.deposit / orderData.pricing.subtotalBeforeTax) * 100)
      : 0;
    const hasConfiguredPercent = expectedDepositPercent != null;

    // If validation fails and requires manager approval - save as draft with validation data
    if (validation.requiresManagerApproval && !hasManagerApproval) {
      // Save validation results to the order (stays as draft)
      await orderRef.update({
        validation: {
          validatedAt: admin.firestore.FieldValue.serverTimestamp(),
          pdfExtractedData: validation.pdfData ? {
            customerName: validation.pdfData.customerName,
            email: validation.pdfData.email,
            subtotal: validation.pdfData.subtotal,
            deposit: validation.pdfData.downPayment,
            depositPercent: validation.pdfData.actualDepositPercent,
            manufacturerSku: validation.pdfData.manufacturerSku,
            expectedSku: validation.pdfData.expectedSku,
            skuMismatch: validation.pdfData.skuMismatch,
          } : null,
          warnings: validation.warnings,
          errors: validation.errors,
          depositCheck: {
            expectedPercent: expectedDepositPercent ?? 0,
            actualPercent: actualDepositPercent,
            isDiscrepancy: hasConfiguredPercent ? Math.abs(actualDepositPercent - (expectedDepositPercent as number)) > 1 : false,
          },
          managerApprovalRequired: true,
          managerApprovalGiven: false,
          managerApprovedAt: null,
        },
        needsManagerApproval: true,
      });

      console.log(`Order ${orderId} saved with validation - needs manager approval`);

      res.status(200).json({
        success: false,
        savedAsDraft: true,
        requiresManagerApproval: true,
        validationErrors: validation.errors,
        validationWarnings: validation.warnings,
        message: 'Order saved. Deposit percentage does not match expected value. Manager approval is required to send for signature.',
        orderId,
      });
      return;
    }

    // Log warnings but continue if no critical errors
    if (validation.warnings.length > 0) {
      console.log('Validation warnings:', validation.warnings);
    }

    // Create esign_documents record with pre-filled data from order
    const customerName = `${orderData.customer.firstName} ${orderData.customer.lastName}`.trim();

    const esignDocData = {
      orderNumber: orderData.orderNumber,
      fileName: `${orderData.orderNumber}_order.pdf`,
      sourceType: 'order_form', // Indicates this came from order form, not PDF upload
      orderId: orderId,
      signer: {
        email: orderData.customer.email,
        name: customerName,
      },
      installer: orderData.building.manufacturer,
      status: 'processing',
      createdAt: admin.firestore.FieldValue.serverTimestamp(),
      // Form data
      formData: {
        customerName,
        customerAddress: orderData.customer.deliveryAddress,
        customerState: orderData.customer.state,
        customerZip: orderData.customer.zip,
        customerPhone: orderData.customer.phone,
        customerEmail: orderData.customer.email,
        subtotal: orderData.pricing.subtotalBeforeTax,
        downPayment: orderData.pricing.deposit,
        balanceDue: orderData.pricing.subtotalBeforeTax - orderData.pricing.deposit,
        buildingType: orderData.building.buildingType,
        buildingSize: `${orderData.building.overallWidth} x ${orderData.building.buildingLength}`,
        expectedDepositPercent,
        actualDepositPercent,
      },
      // AI-extracted data from PDF
      extractedData: validation.pdfData ? {
        customerName: validation.pdfData.customerName,
        customerAddress: validation.pdfData.address,
        customerState: validation.pdfData.state,
        customerZip: validation.pdfData.zip,
        customerPhone: validation.pdfData.phone,
        customerEmail: validation.pdfData.email,
        subtotal: validation.pdfData.subtotal,
        downPayment: validation.pdfData.downPayment,
        balanceDue: validation.pdfData.balanceDue,
        manufacturerSku: validation.pdfData.manufacturerSku,
        expectedSku: validation.pdfData.expectedSku,
        skuMismatch: validation.pdfData.skuMismatch,
        expectedDepositPercent: validation.pdfData.expectedDepositPercent,
        actualDepositPercent: validation.pdfData.actualDepositPercent,
        depositDiscrepancy: validation.pdfData.depositDiscrepancy,
      } : null,
      // Validation results
      validation: {
        passed: validation.valid,
        managerApprovalRequired: validation.requiresManagerApproval,
        managerApprovalGiven: hasManagerApproval,
        errors: validation.errors,
        warnings: validation.warnings,
        validatedAt: admin.firestore.FieldValue.serverTimestamp(),
      },
      // Order-specific fields
      orderData: {
        building: orderData.building,
        pricing: orderData.pricing,
        payment: orderData.payment,
        salesPerson: orderData.salesPerson,
        referredBy: orderData.referredBy,
        specialNotes: orderData.specialNotes,
      },
    };

    // Create the esign document record
    const esignDocRef = await db.collection('esign_documents').add(esignDocData);
    console.log(`Created esign_documents record: ${esignDocRef.id}`);

    // Send PDF to SignNow for signature
    let signNowResult: { documentId: string; inviteId: string } | null = null;
    try {
      console.log('Sending PDF to SignNow...');
      signNowResult = await sendForSignature({
        pdfBuffer,
        fileName: orderData.files.orderFormPdf!.name || `${orderData.orderNumber}_order.pdf`,
        signerEmail: orderData.customer.email,
        signerName: customerName,
        installer: orderData.building.manufacturer,
      });
      console.log('SignNow document created:', signNowResult.documentId);

      // Update esign document with SignNow document ID
      await esignDocRef.update({
        signNowDocumentId: signNowResult.documentId,
        signNowInviteId: signNowResult.inviteId,
        status: 'sent',
        sentAt: admin.firestore.FieldValue.serverTimestamp(),
      });
    } catch (signNowError) {
      console.error('Failed to send to SignNow:', signNowError);
      // Update status to reflect the error
      await esignDocRef.update({
        status: 'error',
        error: signNowError instanceof Error ? signNowError.message : 'Failed to send to SignNow',
      });
      res.status(500).json({ error: 'Failed to send document to SignNow for signature' });
      return;
    }

    // Update order status and link to esign document, including validation data
    await orderRef.update({
      status: 'sent_for_signature',
      esignDocumentId: esignDocRef.id,
      sentForSignatureAt: admin.firestore.FieldValue.serverTimestamp(),
      // Save validation results on the order
      validation: {
        validatedAt: admin.firestore.FieldValue.serverTimestamp(),
        pdfExtractedData: validation.pdfData ? {
          customerName: validation.pdfData.customerName,
          email: validation.pdfData.email,
          subtotal: validation.pdfData.subtotal,
          deposit: validation.pdfData.downPayment,
          depositPercent: validation.pdfData.actualDepositPercent,
        } : null,
        warnings: validation.warnings,
        errors: validation.errors,
        depositCheck: {
          expectedPercent: expectedDepositPercent ?? 0,
          actualPercent: actualDepositPercent,
          isDiscrepancy: hasConfiguredPercent ? Math.abs(actualDepositPercent - (expectedDepositPercent as number)) > 1 : false,
        },
        managerApprovalRequired: validation.requiresManagerApproval,
        managerApprovalGiven: hasManagerApproval,
        managerApprovedAt: hasManagerApproval ? admin.firestore.FieldValue.serverTimestamp() : null,
      },
    });

    console.log(`Order ${orderId} sent to SignNow for signature`);

    // Add to Google Sheets for tracking
    try {
      const balanceDue = orderData.pricing.subtotalBeforeTax - orderData.pricing.deposit;
      const sheetExpectedPercent = await getDepositPercent(orderData.building.manufacturer, orderData.pricing.subtotalBeforeTax);
      const sheetExpectedAmount = sheetExpectedPercent != null
        ? orderData.pricing.subtotalBeforeTax * (sheetExpectedPercent / 100)
        : null;
      const sheetActualPercent = orderData.pricing.subtotalBeforeTax > 0
        ? Math.round((orderData.pricing.deposit / orderData.pricing.subtotalBeforeTax) * 100)
        : 0;

      await addDocumentToSheet({
        orderNumber: orderData.orderNumber,
        fileName: orderData.files.orderFormPdf!.name || `${orderData.orderNumber}_order.pdf`,
        signerName: customerName,
        signerEmail: orderData.customer.email,
        installer: orderData.building.manufacturer,
        signNowDocumentId: signNowResult?.documentId || '',
        createdAt: new Date(),
        signedAt: new Date(),
        customerName,
        subtotal: orderData.pricing.subtotalBeforeTax,
        downPayment: orderData.pricing.deposit,
        balanceDue,
        preSignedPdfLink: orderData.files.orderFormPdf!.downloadUrl,
        signedPdfLink: '',
        expectedDepositPercent: sheetExpectedPercent ?? 0,
        expectedDepositAmount: sheetExpectedAmount ?? 0,
        actualDepositPercent: sheetActualPercent,
        depositDiscrepancy: sheetExpectedPercent != null ? Math.abs(sheetActualPercent - sheetExpectedPercent) > 1 : false,
        depositDiscrepancyAmount: sheetExpectedAmount != null ? Math.abs(orderData.pricing.deposit - sheetExpectedAmount) : 0,
      });
      console.log('Added order to Google Sheets for tracking');
    } catch (sheetError) {
      console.error('Failed to add to Google Sheets:', sheetError);
      // Don't fail the entire operation for Sheets error
    }

    res.status(200).json({
      success: true,
      message: 'Order sent for signature',
      esignDocumentId: esignDocRef.id,
      signNowDocumentId: signNowResult?.documentId,
      orderId,
    });
  } catch (error) {
    console.error('Error sending order for signature:', error);
    res.status(500).json({
      error: error instanceof Error ? error.message : 'Failed to send order for signature',
    });
  }
});

/**
 * Migrate old orders to add payment.status field
 * Call this once to update existing orders
 */
export const migrateOrderPaymentStatus = functions.https.onRequest(async (req, res) => {
  res.set('Access-Control-Allow-Origin', '*');
  res.set('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.set('Access-Control-Allow-Headers', 'Content-Type');

  if (req.method === 'OPTIONS') {
    res.status(204).send('');
    return;
  }

  try {
    const db = admin.firestore();
    const ordersSnapshot = await db.collection('orders').get();

    let updated = 0;
    let skipped = 0;

    for (const doc of ordersSnapshot.docs) {
      const order = doc.data();

      // Skip if already has payment status
      if (order.payment?.status) {
        skipped++;
        continue;
      }

      const paymentType = order.payment?.type;
      let newStatus = 'pending';

      // Determine status based on payment type and order status
      if (paymentType?.startsWith('stripe_')) {
        // Stripe orders that were sent for signature are considered paid
        if (order.status !== 'draft') {
          newStatus = 'paid';
        }
      } else if (MANUAL_PAYMENT_TYPES.includes(paymentType)) {
        // Manual payment types that were sent for signature are considered approved
        if (order.status !== 'draft') {
          newStatus = 'manually_approved';
        }
      }

      // Update the order
      await doc.ref.update({
        'payment.status': newStatus,
        ...(newStatus !== 'pending' && { paidAt: order.sentForSignatureAt || admin.firestore.FieldValue.serverTimestamp() }),
      });

      // Check if order should be ready_for_manufacturer
      if (order.status === 'signed' && newStatus !== 'pending') {
        await doc.ref.update({
          status: 'ready_for_manufacturer',
          readyForManufacturerAt: admin.firestore.FieldValue.serverTimestamp(),
        });
      }

      updated++;
      console.log(`Migrated order ${doc.id}: payment.status = ${newStatus}`);
    }

    res.status(200).json({
      success: true,
      message: `Migration complete. Updated: ${updated}, Skipped: ${skipped}`,
    });
  } catch (error) {
    console.error('Migration error:', error);
    res.status(500).json({
      error: error instanceof Error ? error.message : 'Migration failed',
    });
  }
});

/**
 * Update order status when e-sign document is signed
 * This can be called from the SignNow webhook handler
 * If payment is already complete, marks order as ready_for_manufacturer
 */
export async function updateOrderOnSigned(esignDocumentId: string): Promise<void> {
  console.log(`updateOrderOnSigned called with esignDocumentId: ${esignDocumentId}`);
  const db = admin.firestore();

  // First, check if this esign document is for a change order
  const esignDocRef = db.collection('esign_documents').doc(esignDocumentId);
  const esignDocSnap = await esignDocRef.get();
  const esignData = esignDocSnap.exists ? esignDocSnap.data() : null;
  const changeOrderId = esignData?.changeOrderId;

  // Find the order linked to this esign document
  const ordersQuery = await db
    .collection('orders')
    .where('esignDocumentId', '==', esignDocumentId)
    .limit(1)
    .get();

  console.log(`Found ${ordersQuery.size} orders matching esignDocumentId`);

  if (ordersQuery.empty) {
    console.log(`No order found linked to esign document: ${esignDocumentId}`);
    return;
  }

  const orderRef = ordersQuery.docs[0].ref;
  const orderData = ordersQuery.docs[0].data();

  // Guard: skip if order has been cancelled (race condition protection)
  if (orderData.status === 'cancelled') {
    console.log(`Order ${ordersQuery.docs[0].id} is cancelled — skipping signed update`);
    return;
  }

  // If this is a change order signature, update the change order status
  if (changeOrderId) {
    console.log(`This is a change order signature. Updating change order: ${changeOrderId}`);
    const changeOrderRef = db.collection('change_orders').doc(changeOrderId);
    const changeOrderSnap = await changeOrderRef.get();

    // Guard: skip if change order has been cancelled
    if (changeOrderSnap.exists && changeOrderSnap.data()?.status === 'cancelled') {
      console.log(`Change order ${changeOrderId} is cancelled — skipping signed update`);
      return;
    }

    await changeOrderRef.update({
      status: 'signed',
      signedAt: admin.firestore.FieldValue.serverTimestamp(),
    });
    console.log(`Change order ${changeOrderId} marked as signed`);

    // Note: deposit_increase/decrease ledger entries are informational only —
    // depositRequired is calculated from order.pricing.deposit (updated by sendChangeOrderForSignature).
    // Payment/refund entries for the deposit difference are created at send time in sendChangeOrderForSignature.
    // Recalculate ledger summary to reflect updated pricing.
    try {
      await updateOrderLedgerSummary(orderRef.id, db);
      console.log(`Ledger summary recalculated for change order ${changeOrderId} signing`);
    } catch (ledgerError) {
      console.error('Error recalculating ledger summary for change order:', ledgerError);
    }
  }

  // Check if payment is complete - handle old orders without payment.status
  const paymentStatus = orderData.payment?.status;
  const paymentType = orderData.payment?.type;

  // For old orders: assume Stripe payments are paid if order got this far
  // Manual payment types without status are considered pending
  const isPaid = paymentStatus === 'paid' ||
                 paymentStatus === 'manually_approved' ||
                 // Backwards compatibility: old Stripe orders without status are considered paid
                 (!paymentStatus && paymentType?.startsWith('stripe_'));

  // Build the order update object
  const orderUpdate: Record<string, unknown> = {
    signedAt: admin.firestore.FieldValue.serverTimestamp(),
  };

  // Clear active change order tracking (applies to both regular orders and change orders)
  if (changeOrderId) {
    orderUpdate.activeChangeOrderId = null;
    orderUpdate.activeChangeOrderStatus = null;
  }

  if (isPaid) {
    // Both signed and paid - ready for manufacturer
    orderUpdate.status = 'ready_for_manufacturer';
    orderUpdate.readyForManufacturerAt = admin.firestore.FieldValue.serverTimestamp();
    await orderRef.update(orderUpdate);
    console.log(`Order ${ordersQuery.docs[0].id} is signed AND paid - ready for manufacturer`);
  } else {
    // Signed but not paid yet
    orderUpdate.status = 'signed';
    await orderRef.update(orderUpdate);
    console.log(`Order ${ordersQuery.docs[0].id} is signed but awaiting payment`);
  }
}

/**
 * Sync order status from esign_documents - useful for fixing orders that weren't updated
 * when the document was signed
 */
export async function syncOrderStatusFromEsign(orderId: string): Promise<{ success: boolean; message: string }> {
  const db = admin.firestore();

  // Get the order
  const orderRef = db.collection('orders').doc(orderId);
  const orderDoc = await orderRef.get();

  if (!orderDoc.exists) {
    return { success: false, message: `Order ${orderId} not found` };
  }

  const orderData = orderDoc.data()!;
  const esignDocId = orderData.esignDocumentId;

  if (!esignDocId) {
    // Try to find esign document by order number
    const esignQuery = await db
      .collection('esign_documents')
      .where('orderNumber', '==', orderData.orderNumber)
      .limit(1)
      .get();

    if (esignQuery.empty) {
      return { success: false, message: `No esign document found for order ${orderData.orderNumber}` };
    }

    const esignDoc = esignQuery.docs[0];
    const esignData = esignDoc.data();

    // Link the order to the esign document
    await orderRef.update({ esignDocumentId: esignDoc.id });
    console.log(`Linked order ${orderId} to esign document ${esignDoc.id}`);

    // Check if document is signed
    if (esignData.status === 'signed') {
      // Update order based on payment status
      const paymentStatus = orderData.payment?.status;
      const isPaid = paymentStatus === 'paid' || paymentStatus === 'manually_approved';

      if (isPaid) {
        await orderRef.update({
          status: 'ready_for_manufacturer',
          signedAt: esignData.signedAt || admin.firestore.FieldValue.serverTimestamp(),
          readyForManufacturerAt: admin.firestore.FieldValue.serverTimestamp(),
        });
        return { success: true, message: `Order ${orderId} updated to ready_for_manufacturer (signed & paid)` };
      } else {
        await orderRef.update({
          status: 'signed',
          signedAt: esignData.signedAt || admin.firestore.FieldValue.serverTimestamp(),
        });
        return { success: true, message: `Order ${orderId} updated to signed (awaiting payment)` };
      }
    }

    return { success: true, message: `Order ${orderId} linked to esign document, status: ${esignData.status}` };
  }

  // Order already has esignDocId, check esign document status
  const esignDocRef = db.collection('esign_documents').doc(esignDocId);
  const esignDoc = await esignDocRef.get();

  if (!esignDoc.exists) {
    return { success: false, message: `Esign document ${esignDocId} not found` };
  }

  const esignData = esignDoc.data()!;

  if (esignData.status === 'signed' && orderData.status !== 'ready_for_manufacturer') {
    const paymentStatus = orderData.payment?.status;
    const isPaid = paymentStatus === 'paid' || paymentStatus === 'manually_approved';

    if (isPaid) {
      await orderRef.update({
        status: 'ready_for_manufacturer',
        signedAt: esignData.signedAt || admin.firestore.FieldValue.serverTimestamp(),
        readyForManufacturerAt: admin.firestore.FieldValue.serverTimestamp(),
      });
      return { success: true, message: `Order ${orderId} updated to ready_for_manufacturer (signed & paid)` };
    } else {
      await orderRef.update({
        status: 'signed',
        signedAt: esignData.signedAt || admin.firestore.FieldValue.serverTimestamp(),
      });
      return { success: true, message: `Order ${orderId} updated to signed (awaiting payment)` };
    }
  }

  return { success: true, message: `Order ${orderId} status is already correct: ${orderData.status}` };
}

/**
 * Send a change order for signature
 * 1. Validates the change order
 * 2. Cancels any existing signature on the parent order
 * 3. Applies the change order pricing to the order
 * 4. Sends the order for signature with updated values
 * 5. Updates the change order status
 */
export const sendChangeOrderForSignature = functions.https.onRequest(async (req, res) => {
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
    const db = admin.firestore();
    const { changeOrderId, testMode, paymentInfo } = req.body;

    if (!changeOrderId) {
      res.status(400).json({ error: 'Change order ID is required' });
      return;
    }

    console.log(`Processing change order for signature: ${changeOrderId}${testMode ? ' (TEST MODE)' : ''}`);
    if (paymentInfo) {
      console.log('Payment info received:', JSON.stringify(paymentInfo));
    }

    // Get change order data
    const changeOrderRef = db.doc(`change_orders/${changeOrderId}`);
    const changeOrderSnap = await changeOrderRef.get();

    if (!changeOrderSnap.exists) {
      res.status(404).json({ error: 'Change order not found' });
      return;
    }

    const changeOrderData = changeOrderSnap.data()!;

    // Validate change order status
    if (changeOrderData.status !== 'draft') {
      res.status(400).json({
        error: `Change order cannot be sent for signature. Current status: ${changeOrderData.status}`,
      });
      return;
    }

    // Get parent order
    const orderId = changeOrderData.orderId;
    const orderRef = db.doc(`orders/${orderId}`);
    const orderSnap = await orderRef.get();

    if (!orderSnap.exists) {
      res.status(404).json({ error: 'Parent order not found' });
      return;
    }

    const orderData = { id: orderSnap.id, ...orderSnap.data() } as OrderData & {
      esignDocumentId?: string;
      isTestMode?: boolean;
      originalPricing?: {
        subtotalBeforeTax: number;
        extraMoneyFluff: number;
        deposit: number;
      };
    };

    // Check if order can have a change order sent
    if (orderData.status === 'ready_for_manufacturer') {
      res.status(400).json({
        error: 'Cannot send change order for an order that is already ready for manufacturer',
      });
      return;
    }

    // Determine which PDF to use - change order PDF takes priority over order PDF
    const changeOrderPdfUrl = changeOrderData.files?.orderFormPdf?.downloadUrl;
    const orderPdfUrl = orderData.files?.orderFormPdf?.downloadUrl;
    const pdfToUse = changeOrderPdfUrl || orderPdfUrl;
    const pdfFileName = changeOrderData.files?.orderFormPdf?.name || orderData.files?.orderFormPdf?.name || `${orderData.orderNumber}_change_order.pdf`;

    // Check if test mode (from param or inherited from order/change order)
    const isTestMode = testMode === true || changeOrderData.isTestMode === true || orderData.isTestMode === true;

    if (!isTestMode && !pdfToUse) {
      res.status(400).json({
        error: 'Change order or order must have an uploaded Order Form PDF to send for signature',
      });
      return;
    }

    // Apply change order pricing to order FIRST (before payment handling)
    // so that updateOrderLedgerSummary reads the correct deposit amount.
    const newPricing = {
      subtotalBeforeTax: changeOrderData.newValues.subtotalBeforeTax,
      extraMoneyFluff: changeOrderData.newValues.extraMoneyFluff,
      deposit: changeOrderData.newValues.deposit,
    };
    const originalPricing = orderData.originalPricing || orderData.pricing;
    const totalDepositDifference = newPricing.deposit - originalPricing.deposit;

    const pricingUpdate: Record<string, unknown> = {
      pricing: newPricing,
      originalPricing: originalPricing,
      totalDepositDifference,
    };
    // Apply customer changes if present
    if (changeOrderData.newCustomer) {
      pricingUpdate.customer = changeOrderData.newCustomer;
      console.log('Applying customer changes from change order');
    }
    // Apply building changes if present
    if (changeOrderData.newBuilding) {
      pricingUpdate.building = changeOrderData.newBuilding;
      console.log('Applying building changes from change order');
    }
    await orderRef.update(pricingUpdate);
    console.log(`Applied change order pricing: subtotal=${newPricing.subtotalBeforeTax}, deposit=${newPricing.deposit}`);

    // Handle payment record creation for deposit differences
    let paymentRecordId: string | undefined;
    let paymentStatus: 'not_required' | 'pending' | 'collected' | 'refund_pending' = 'not_required';
    let additionalDepositDue = 0;
    let refundDue = 0;

    if (paymentInfo && paymentInfo.depositDifference > 0) {
      const depositDiff = paymentInfo.depositDifference;

      if (paymentInfo.isRefund) {
        // Deposit decreased - create pending refund ledger entry
        console.log(`Creating refund ledger entry for -$${depositDiff}`);
        const { entryId } = await createLedgerEntry({
          orderId: changeOrderData.orderId,
          orderNumber: orderData.orderNumber,
          changeOrderId: changeOrderId,
          changeOrderNumber: changeOrderData.changeOrderNumber,
          transactionType: 'refund',
          amount: depositDiff,
          method: 'other',
          category: 'refund',
          status: 'pending',
          description: `Refund due from ${changeOrderData.changeOrderNumber} - deposit decrease`,
          createdBy: changeOrderData.createdBy || 'system',
        }, db);
        paymentRecordId = entryId;
        paymentStatus = 'refund_pending';
        refundDue = depositDiff;
        await updateOrderLedgerSummary(changeOrderData.orderId, db);
        console.log(`Created refund ledger entry: ${paymentRecordId}`);
      } else if (paymentInfo.collectNow) {
        // Deposit increased and collecting now
        console.log(`Creating collected payment ledger entry for $${depositDiff}`);

        const paymentTypeToMethod: Record<string, string> = {
          'stripe_charge_card': 'stripe',
          'stripe_pay_now': 'stripe',
          'stripe_already_paid': 'stripe',
          'check': 'check',
          'wire': 'wire',
          'credit_on_file': 'credit_on_file',
          'other': 'other',
        };
        const method = paymentTypeToMethod[paymentInfo.paymentType || 'stripe'] || 'stripe';
        const isStripePayment = paymentInfo.paymentType === 'stripe_already_paid' || paymentInfo.paymentType === 'stripe_pay_now' || paymentInfo.paymentType === 'stripe_charge_card';

        const { entryId } = await createLedgerEntry({
          orderId: changeOrderData.orderId,
          orderNumber: orderData.orderNumber,
          changeOrderId: changeOrderId,
          changeOrderNumber: changeOrderData.changeOrderNumber,
          transactionType: 'payment',
          amount: depositDiff,
          method: method as any,
          category: 'change_order_adjustment',
          status: isStripePayment ? 'verified' : 'approved',
          stripePaymentId: isStripePayment && paymentInfo.stripePaymentId ? paymentInfo.stripePaymentId : undefined,
          stripeVerified: isStripePayment && paymentInfo.stripePaymentId ? true : undefined,
          description: `Additional deposit for ${changeOrderData.changeOrderNumber}`,
          approvedBy: !isStripePayment ? 'Manager' : undefined,
          createdBy: changeOrderData.createdBy || 'system',
        }, db);
        paymentRecordId = entryId;
        paymentStatus = 'collected';
        await updateOrderLedgerSummary(changeOrderData.orderId, db);
        console.log(`Created collected ledger entry: ${paymentRecordId}`);
      } else {
        // Deposit increased but collecting later - create pending record
        console.log(`Creating pending payment ledger entry for $${depositDiff}`);
        const { entryId } = await createLedgerEntry({
          orderId: changeOrderData.orderId,
          orderNumber: orderData.orderNumber,
          changeOrderId: changeOrderId,
          changeOrderNumber: changeOrderData.changeOrderNumber,
          transactionType: 'payment',
          amount: depositDiff,
          method: 'other',
          category: 'change_order_adjustment',
          status: 'pending',
          description: `Additional deposit pending for ${changeOrderData.changeOrderNumber}`,
          createdBy: changeOrderData.createdBy || 'system',
        }, db);
        paymentRecordId = entryId;
        paymentStatus = 'pending';
        additionalDepositDue = depositDiff;
        await updateOrderLedgerSummary(changeOrderData.orderId, db);
        console.log(`Created pending ledger entry: ${paymentRecordId}`);
      }
    }

    // TEST MODE: Skip SignNow, just update statuses
    if (isTestMode) {
      console.log(`TEST MODE: Skipping SignNow for change order ${changeOrderId}`);

      // Create mock esign document
      const customerName = `${orderData.customer.firstName} ${orderData.customer.lastName}`.trim();
      const esignDocData = {
        orderNumber: orderData.orderNumber,
        changeOrderId: changeOrderId,
        changeOrderNumber: changeOrderData.changeOrderNumber,
        fileName: `${changeOrderData.changeOrderNumber}_test.pdf`,
        sourceType: 'change_order',
        orderId: changeOrderData.orderId,
        signer: {
          email: orderData.customer.email,
          name: customerName,
        },
        installer: orderData.building.manufacturer,
        status: 'sent',
        isTestMode: true,
        createdAt: admin.firestore.FieldValue.serverTimestamp(),
        sentAt: admin.firestore.FieldValue.serverTimestamp(),
        signNowDocumentId: `test_co_doc_${Date.now()}`,
        signNowInviteId: `test_co_invite_${Date.now()}`,
      };

      const esignDocRef = await db.collection('esign_documents').add(esignDocData);

      // Update change order status with payment info
      const changeOrderUpdate: any = {
        status: 'pending_signature',
        sentForSignatureAt: admin.firestore.FieldValue.serverTimestamp(),
        esignDocumentId: esignDocRef.id,
        isTestMode: true,
        updatedAt: admin.firestore.FieldValue.serverTimestamp(),
      };
      if (paymentRecordId) {
        changeOrderUpdate.paymentRecordId = paymentRecordId;
        changeOrderUpdate.paymentStatus = paymentStatus;
      }
      await changeOrderRef.update(changeOrderUpdate);

      // Update parent order with payment flags
      const testModeOrderUpdate: any = {
        activeChangeOrderId: changeOrderId,
        activeChangeOrderStatus: 'pending_signature',
        updatedAt: admin.firestore.FieldValue.serverTimestamp(),
      };
      if (additionalDepositDue > 0) {
        testModeOrderUpdate.additionalDepositDue = admin.firestore.FieldValue.increment(additionalDepositDue);
      }
      if (refundDue > 0) {
        testModeOrderUpdate.refundDue = admin.firestore.FieldValue.increment(refundDue);
      }
      await orderRef.update(testModeOrderUpdate);

      res.status(200).json({
        success: true,
        testMode: true,
        message: 'TEST MODE: Change order marked as sent for signature (no actual email sent)',
        esignDocumentId: esignDocRef.id,
        paymentRecordId,
        paymentStatus,
      });
      return;
    }

    console.log(`Using PDF from ${changeOrderPdfUrl ? 'change order' : 'order'}: ${pdfFileName}`);

    // If order is currently sent_for_signature, cancel the existing signature
    if (orderData.status === 'sent_for_signature' && orderData.esignDocumentId) {
      console.log('========================================');
      console.log('CANCELLING EXISTING SIGNATURE FOR CHANGE ORDER');
      console.log('========================================');
      console.log('Order ID:', orderId);
      console.log('Order Status:', orderData.status);
      console.log('Existing esignDocumentId:', orderData.esignDocumentId);

      const esignDocRef = db.doc(`esign_documents/${orderData.esignDocumentId}`);
      const esignDoc = await esignDocRef.get();

      if (esignDoc.exists) {
        const esignData = esignDoc.data()!;
        const signNowDocumentId = esignData.signNowDocumentId;
        console.log('Found esign document. SignNow Document ID:', signNowDocumentId);

        // Cancel in SignNow if we have a document ID
        if (signNowDocumentId) {
          try {
            console.log('Attempting to cancel SignNow invite...');
            const { cancelSigningInvite } = await import('./signNowService');
            const cancelResult = await cancelSigningInvite(signNowDocumentId);
            console.log('SignNow cancel result:', JSON.stringify(cancelResult));

            if (cancelResult.success) {
              console.log('SUCCESS: SignNow invite cancelled');
            } else {
              console.log('WARNING: SignNow cancel returned:', cancelResult.message);
            }
          } catch (cancelErr) {
            console.error('ERROR: Failed to cancel SignNow invite:', cancelErr);
            // Continue anyway
          }
        } else {
          console.log('WARNING: No SignNow document ID found on esign document');
        }

        // Update esign document status
        await esignDocRef.update({
          status: 'cancelled',
          cancelledAt: admin.firestore.FieldValue.serverTimestamp(),
          cancelledReason: `Replaced by change order ${changeOrderData.changeOrderNumber}`,
        });
        console.log('Esign document marked as cancelled in Firestore');
        console.log('========================================');
      } else {
        console.log('WARNING: Esign document not found:', orderData.esignDocumentId);
      }
    } else {
      console.log('Order not in sent_for_signature status or no esignDocumentId - no cancellation needed');
      console.log('Current status:', orderData.status, '| esignDocumentId:', orderData.esignDocumentId || 'none');
    }

    // Cancel any previous pending change orders for this order
    const previousChangeOrdersQuery = await db
      .collection('change_orders')
      .where('orderId', '==', orderId)
      .where('status', '==', 'pending_signature')
      .get();

    if (!previousChangeOrdersQuery.empty) {
      console.log(`Found ${previousChangeOrdersQuery.size} pending change order(s) to cancel`);
      for (const prevCODoc of previousChangeOrdersQuery.docs) {
        if (prevCODoc.id !== changeOrderId) {
          const prevCOData = prevCODoc.data();
          console.log(`Cancelling previous change order: ${prevCOData.changeOrderNumber}`);

          // Cancel the SignNow signature if it exists
          if (prevCOData.esignDocumentId) {
            const prevEsignRef = db.doc(`esign_documents/${prevCOData.esignDocumentId}`);
            const prevEsignDoc = await prevEsignRef.get();
            if (prevEsignDoc.exists) {
              const prevEsignData = prevEsignDoc.data()!;
              if (prevEsignData.signNowDocumentId) {
                try {
                  const { cancelSigningInvite } = await import('./signNowService');
                  await cancelSigningInvite(prevEsignData.signNowDocumentId);
                  console.log(`Cancelled SignNow invite for ${prevCOData.changeOrderNumber}`);
                } catch (err) {
                  console.warn(`Failed to cancel SignNow for ${prevCOData.changeOrderNumber}:`, err);
                }
              }
              // Mark esign document as cancelled
              await prevEsignRef.update({
                status: 'cancelled',
                cancelledAt: admin.firestore.FieldValue.serverTimestamp(),
                cancelledReason: `Replaced by ${changeOrderData.changeOrderNumber}`,
              });
            }
          }

          // Mark the change order as cancelled
          await prevCODoc.ref.update({
            status: 'cancelled',
            cancelledAt: admin.firestore.FieldValue.serverTimestamp(),
            cancelledReason: `Replaced by ${changeOrderData.changeOrderNumber}`,
          });
          console.log(`Change order ${prevCOData.changeOrderNumber} cancelled`);
        }
      }
    }

    // Pricing and customer/building changes already applied above (before payment handling).
    // Just update order status for the SignNow flow.
    await orderRef.update({
      status: 'draft', // Reset to draft before re-sending
      activeChangeOrderId: changeOrderId,
    });

    // Use updated customer/building data for the rest of the function
    const finalCustomerData = changeOrderData.newCustomer || orderData.customer;
    const finalBuildingData = changeOrderData.newBuilding || orderData.building;

    // Download the PDF (using change order PDF if available, otherwise order PDF)
    console.log('Downloading PDF from:', pdfToUse);
    let pdfBuffer: Buffer;
    try {
      const pdfResponse = await axios.get(pdfToUse, {
        responseType: 'arraybuffer',
      });
      pdfBuffer = Buffer.from(pdfResponse.data);
      console.log(`Downloaded PDF: ${pdfBuffer.length} bytes`);
    } catch (downloadError) {
      console.error('Failed to download PDF:', downloadError);
      res.status(500).json({ error: 'Failed to download order form PDF' });
      return;
    }

    // Create new esign_documents record with updated data
    const customerName = `${finalCustomerData.firstName} ${finalCustomerData.lastName}`.trim();
    const expectedDepositPercent = await getDepositPercent(finalBuildingData.manufacturer, newPricing.subtotalBeforeTax);
    const actualDepositPercent = newPricing.subtotalBeforeTax > 0
      ? Math.round((newPricing.deposit / newPricing.subtotalBeforeTax) * 100)
      : 0;

    const esignDocData = {
      orderNumber: orderData.orderNumber,
      fileName: pdfFileName,
      sourceType: 'change_order',
      orderId: orderId,
      changeOrderId: changeOrderId,
      changeOrderNumber: changeOrderData.changeOrderNumber,
      usedChangeOrderPdf: !!changeOrderPdfUrl, // Track which PDF was used
      signer: {
        email: finalCustomerData.email,
        name: customerName,
      },
      installer: finalBuildingData.manufacturer,
      status: 'processing',
      createdAt: admin.firestore.FieldValue.serverTimestamp(),
      formData: {
        customerName,
        customerEmail: finalCustomerData.email,
        customerAddress: finalCustomerData.deliveryAddress,
        customerState: finalCustomerData.state,
        customerZip: finalCustomerData.zip,
        customerPhone: finalCustomerData.phone,
        subtotal: newPricing.subtotalBeforeTax,
        downPayment: newPricing.deposit,
        balanceDue: newPricing.subtotalBeforeTax - newPricing.deposit,
        expectedDepositPercent,
        actualDepositPercent,
        // Change order specific data
        changeOrderNumber: changeOrderData.changeOrderNumber,
        changeOrderReason: changeOrderData.reason,
        previousSubtotal: changeOrderData.previousValues.subtotalBeforeTax,
        previousDeposit: changeOrderData.previousValues.deposit,
        subtotalDiff: changeOrderData.differences.subtotalDiff,
        depositDiff: changeOrderData.differences.depositDiff,
        // Track customer/building changes
        hasCustomerChanges: !!changeOrderData.newCustomer,
        hasBuildingChanges: !!changeOrderData.newBuilding,
        customerChanges: changeOrderData.customerChanges || [],
        buildingChanges: changeOrderData.buildingChanges || [],
      },
      orderData: {
        customer: finalCustomerData,
        building: finalBuildingData,
        pricing: newPricing,
        payment: orderData.payment,
        salesPerson: orderData.salesPerson,
        referredBy: orderData.referredBy,
        specialNotes: orderData.specialNotes,
      },
    };

    // Create the esign document record
    const esignDocRef = await db.collection('esign_documents').add(esignDocData);
    console.log(`Created esign_documents record for change order: ${esignDocRef.id}`);

    // Send PDF to SignNow for signature
    let signNowResult: { documentId: string; inviteId: string } | null = null;
    try {
      console.log('Sending PDF to SignNow for change order...');
      const { sendForSignature } = await import('./signNowService');
      signNowResult = await sendForSignature({
        pdfBuffer,
        fileName: pdfFileName,
        signerEmail: finalCustomerData.email,
        signerName: customerName,
        installer: finalBuildingData.manufacturer,
      });
      console.log('SignNow document created:', signNowResult.documentId);

      // Update esign document with SignNow document ID
      await esignDocRef.update({
        signNowDocumentId: signNowResult.documentId,
        signNowInviteId: signNowResult.inviteId,
        status: 'sent',
        sentAt: admin.firestore.FieldValue.serverTimestamp(),
      });
    } catch (signNowError) {
      console.error('Failed to send to SignNow:', signNowError);
      await esignDocRef.update({
        status: 'error',
        error: signNowError instanceof Error ? signNowError.message : 'Failed to send to SignNow',
      });
      res.status(500).json({ error: 'Failed to send document to SignNow for signature' });
      return;
    }

    // Update order status and set active change order status to pending_signature
    const finalOrderUpdate: any = {
      status: 'sent_for_signature',
      esignDocumentId: esignDocRef.id,
      sentForSignatureAt: admin.firestore.FieldValue.serverTimestamp(),
      activeChangeOrderStatus: 'pending_signature',
    };
    if (additionalDepositDue > 0) {
      finalOrderUpdate.additionalDepositDue = admin.firestore.FieldValue.increment(additionalDepositDue);
    }
    if (refundDue > 0) {
      finalOrderUpdate.refundDue = admin.firestore.FieldValue.increment(refundDue);
    }
    await orderRef.update(finalOrderUpdate);

    // Update change order status with payment info
    const finalChangeOrderUpdate: any = {
      status: 'pending_signature',
      esignDocumentId: esignDocRef.id,
      sentForSignatureAt: admin.firestore.FieldValue.serverTimestamp(),
    };
    if (paymentRecordId) {
      finalChangeOrderUpdate.paymentRecordId = paymentRecordId;
      finalChangeOrderUpdate.paymentStatus = paymentStatus;
    }
    await changeOrderRef.update(finalChangeOrderUpdate);

    console.log(`Change order ${changeOrderId} sent for signature successfully`);

    res.status(200).json({
      success: true,
      message: `Change order ${changeOrderData.changeOrderNumber} sent for signature`,
      orderId,
      changeOrderId,
      esignDocumentId: esignDocRef.id,
      paymentRecordId,
      paymentStatus,
    });
  } catch (error) {
    console.error('Error sending change order for signature:', error);
    res.status(500).json({
      error: error instanceof Error ? error.message : 'Failed to send change order for signature',
    });
  }
});

/**
 * Test Sign Order - Simulates signing for test mode orders
 * Only works for orders with isTestMode: true
 */
export const testSignOrder = functions.https.onRequest(async (req, res) => {
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
    const { orderId } = req.body;

    if (!orderId) {
      res.status(400).json({ error: 'Order ID is required' });
      return;
    }

    // Get order
    const orderRef = db.collection('orders').doc(orderId);
    const orderSnap = await orderRef.get();

    if (!orderSnap.exists) {
      res.status(404).json({ error: 'Order not found' });
      return;
    }

    const orderData = orderSnap.data();

    // Verify test mode
    if (!orderData?.isTestMode) {
      res.status(400).json({ error: 'Test sign is only available for test mode orders' });
      return;
    }

    // Verify status
    if (orderData.status !== 'sent_for_signature') {
      res.status(400).json({ error: 'Order must be in sent_for_signature status to test sign' });
      return;
    }

    // Check if payment is already complete to determine final status
    const paymentStatus = orderData.payment?.status;
    const paymentType = orderData.payment?.type;
    const isPaid = paymentStatus === 'paid' ||
                   paymentStatus === 'manually_approved' ||
                   (!paymentStatus && paymentType?.startsWith('stripe_'));

    const finalStatus = isPaid ? 'ready_for_manufacturer' : 'signed';

    // Update order status
    const orderUpdate: Record<string, unknown> = {
      status: finalStatus,
      signedAt: admin.firestore.FieldValue.serverTimestamp(),
      testSignedAt: admin.firestore.FieldValue.serverTimestamp(),
      updatedAt: admin.firestore.FieldValue.serverTimestamp(),
    };
    if (finalStatus === 'ready_for_manufacturer') {
      orderUpdate.readyForManufacturerAt = admin.firestore.FieldValue.serverTimestamp();
    }
    await orderRef.update(orderUpdate);

    // Update esign document if exists
    if (orderData.esignDocumentId) {
      const esignDocRef = db.collection('esign_documents').doc(orderData.esignDocumentId);
      await esignDocRef.update({
        status: 'signed',
        signedAt: admin.firestore.FieldValue.serverTimestamp(),
        testSigned: true,
      });
    }

    console.log(`TEST MODE: Order ${orderId} marked as ${finalStatus}`);

    res.status(200).json({
      success: true,
      message: `TEST MODE: Order marked as ${finalStatus}`,
      orderId,
      status: finalStatus,
    });
  } catch (error) {
    console.error('Error test signing order:', error);
    res.status(500).json({
      error: error instanceof Error ? error.message : 'Failed to test sign order',
    });
  }
});

/**
 * Test Sign Change Order - Simulates signing for test mode change orders
 * Only works for change orders with isTestMode: true
 */
export const testSignChangeOrder = functions.https.onRequest(async (req, res) => {
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
    const { changeOrderId } = req.body;

    if (!changeOrderId) {
      res.status(400).json({ error: 'Change order ID is required' });
      return;
    }

    // Get change order
    const changeOrderRef = db.collection('change_orders').doc(changeOrderId);
    const changeOrderSnap = await changeOrderRef.get();

    if (!changeOrderSnap.exists) {
      res.status(404).json({ error: 'Change order not found' });
      return;
    }

    const changeOrderData = changeOrderSnap.data()!;

    // Verify test mode (either on change order or parent order)
    const orderRef = db.collection('orders').doc(changeOrderData.orderId);
    const orderSnap = await orderRef.get();
    const orderData = orderSnap.data();

    if (!changeOrderData.isTestMode && !orderData?.isTestMode) {
      res.status(400).json({ error: 'Test sign is only available for test mode change orders' });
      return;
    }

    // Verify status
    if (changeOrderData.status !== 'pending_signature') {
      res.status(400).json({ error: 'Change order must be in pending_signature status to test sign' });
      return;
    }

    // Update change order to signed status
    await changeOrderRef.update({
      status: 'signed',
      signedAt: admin.firestore.FieldValue.serverTimestamp(),
      testSignedAt: admin.firestore.FieldValue.serverTimestamp(),
      updatedAt: admin.firestore.FieldValue.serverTimestamp(),
    });

    // Update parent order
    await orderRef.update({
      activeChangeOrderId: null,
      activeChangeOrderStatus: null,
      // Apply the new pricing from change order
      pricing: {
        subtotalBeforeTax: changeOrderData.newValues?.subtotalBeforeTax ?? orderData?.pricing?.subtotalBeforeTax,
        extraMoneyFluff: changeOrderData.newValues?.extraMoneyFluff ?? orderData?.pricing?.extraMoneyFluff,
        deposit: changeOrderData.newValues?.deposit ?? orderData?.pricing?.deposit,
      },
      updatedAt: admin.firestore.FieldValue.serverTimestamp(),
    });

    // Recalculate ledger summary to reflect updated pricing from change order
    try {
      await updateOrderLedgerSummary(changeOrderData.orderId, db);
      console.log(`TEST MODE: Ledger summary recalculated for change order ${changeOrderId}`);
    } catch (ledgerError) {
      console.error('Error recalculating ledger summary for test change order:', ledgerError);
    }

    // Update esign document if exists
    if (changeOrderData.esignDocumentId) {
      const esignDocRef = db.collection('esign_documents').doc(changeOrderData.esignDocumentId);
      await esignDocRef.update({
        status: 'signed',
        signedAt: admin.firestore.FieldValue.serverTimestamp(),
        testSigned: true,
      });
    }

    console.log(`TEST MODE: Change order ${changeOrderId} marked as signed`);

    res.status(200).json({
      success: true,
      message: 'TEST MODE: Change order marked as signed',
      changeOrderId,
    });
  } catch (error) {
    console.error('Error test signing change order:', error);
    res.status(500).json({
      error: error instanceof Error ? error.message : 'Failed to test sign change order',
    });
  }
});
