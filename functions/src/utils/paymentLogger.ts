/**
 * Payment Logger Utility
 * Structured logging for payment operations with Firestore persistence
 *
 * All payment events are:
 * 1. Logged to console (appears in Cloud Functions logs)
 * 2. Saved to Firestore payment_logs collection for querying
 */

import * as admin from 'firebase-admin';
import { IS_LIVE_MODE } from '../config/stripe';

export type PaymentLogAction =
  | 'payment_intent_created'
  | 'payment_intent_succeeded'
  | 'payment_intent_failed'
  | 'payment_link_created'
  | 'payment_link_completed'
  | 'payment_verified'
  | 'payment_verification_failed'
  | 'manual_payment_approved'
  | 'webhook_received'
  | 'webhook_processed'
  | 'webhook_failed'
  | 'webhook_duplicate'
  | 'refund_verified'
  | 'refund_failed'
  | 'charge_refunded'
  | 'dispute_created'
  | 'card_on_file_charged'
  | 'customer_created'
  | 'mode_mismatch'
  | 'signature_verification_failed'
  | 'idempotency_hit';

export type PaymentLogStatus = 'success' | 'error' | 'warning' | 'info';

export interface PaymentLogEntry {
  timestamp: string;
  mode: 'test' | 'live';
  action: PaymentLogAction;
  orderId?: string;
  orderNumber?: string;
  amount?: number;
  stripeId?: string;
  stripeEventId?: string;
  customerId?: string;
  status: PaymentLogStatus;
  error?: string;
  duration?: number;
  metadata?: Record<string, unknown>;
}

export interface LogPaymentEventParams {
  action: PaymentLogAction;
  orderId?: string;
  orderNumber?: string;
  amount?: number;
  stripeId?: string;
  stripeEventId?: string;
  customerId?: string;
  status: PaymentLogStatus;
  error?: string;
  duration?: number;
  metadata?: Record<string, unknown>;
}

/**
 * Log a payment event to both console and Firestore
 */
export async function logPaymentEvent(params: LogPaymentEventParams): Promise<void> {
  const entry: PaymentLogEntry = {
    timestamp: new Date().toISOString(),
    mode: IS_LIVE_MODE ? 'live' : 'test',
    ...params,
  };

  // Log to console as structured JSON (appears in Cloud Functions logs)
  const logLevel = params.status === 'error' ? 'error' : params.status === 'warning' ? 'warn' : 'log';
  console[logLevel](`[PAYMENT] ${JSON.stringify(entry)}`);

  // Save to Firestore for querying (fire and forget - don't await to avoid blocking)
  try {
    const db = admin.firestore();
    await db.collection('payment_logs').add({
      ...entry,
      createdAt: admin.firestore.FieldValue.serverTimestamp(),
    });
  } catch (firestoreError) {
    // Log but don't throw - logging shouldn't break payment flow
    console.error('Failed to save payment log to Firestore:', firestoreError);
  }
}

/**
 * Log payment event synchronously (console only, no Firestore)
 * Use this for high-frequency events or when you can't await
 */
export function logPaymentEventSync(params: LogPaymentEventParams): void {
  const entry: PaymentLogEntry = {
    timestamp: new Date().toISOString(),
    mode: IS_LIVE_MODE ? 'live' : 'test',
    ...params,
  };

  const logLevel = params.status === 'error' ? 'error' : params.status === 'warning' ? 'warn' : 'log';
  console[logLevel](`[PAYMENT] ${JSON.stringify(entry)}`);
}

/**
 * Create a timer for measuring operation duration
 */
export function createPaymentTimer(): { stop: () => number } {
  const start = Date.now();
  return {
    stop: () => Date.now() - start,
  };
}

/**
 * Wrap a payment operation with automatic logging
 */
export async function withPaymentLogging<T>(
  params: {
    action: PaymentLogAction;
    orderId?: string;
    orderNumber?: string;
    amount?: number;
    stripeId?: string;
    metadata?: Record<string, unknown>;
  },
  operation: () => Promise<T>
): Promise<T> {
  const timer = createPaymentTimer();

  try {
    const result = await operation();

    await logPaymentEvent({
      ...params,
      status: 'success',
      duration: timer.stop(),
    });

    return result;
  } catch (error) {
    await logPaymentEvent({
      ...params,
      status: 'error',
      error: error instanceof Error ? error.message : 'Unknown error',
      duration: timer.stop(),
    });

    throw error;
  }
}

/**
 * Get payment logs for an order
 */
export async function getPaymentLogsForOrder(
  orderId: string,
  limit: number = 100
): Promise<PaymentLogEntry[]> {
  const db = admin.firestore();
  const snapshot = await db
    .collection('payment_logs')
    .where('orderId', '==', orderId)
    .orderBy('createdAt', 'desc')
    .limit(limit)
    .get();

  return snapshot.docs.map((doc) => doc.data() as PaymentLogEntry);
}

/**
 * Get recent payment logs (for monitoring dashboard)
 */
export async function getRecentPaymentLogs(
  options: {
    limit?: number;
    mode?: 'test' | 'live' | 'all';
    status?: PaymentLogStatus;
    action?: PaymentLogAction;
  } = {}
): Promise<PaymentLogEntry[]> {
  const { limit = 100, mode = 'all', status, action } = options;
  const db = admin.firestore();

  let query: FirebaseFirestore.Query = db.collection('payment_logs');

  if (mode !== 'all') {
    query = query.where('mode', '==', mode);
  }

  if (status) {
    query = query.where('status', '==', status);
  }

  if (action) {
    query = query.where('action', '==', action);
  }

  const snapshot = await query.orderBy('createdAt', 'desc').limit(limit).get();

  return snapshot.docs.map((doc) => doc.data() as PaymentLogEntry);
}

/**
 * Get error logs for investigation
 */
export async function getPaymentErrorLogs(
  options: {
    limit?: number;
    since?: Date;
  } = {}
): Promise<PaymentLogEntry[]> {
  const { limit = 100, since } = options;
  const db = admin.firestore();

  let query: FirebaseFirestore.Query = db
    .collection('payment_logs')
    .where('status', '==', 'error');

  if (since) {
    query = query.where('createdAt', '>=', since);
  }

  const snapshot = await query.orderBy('createdAt', 'desc').limit(limit).get();

  return snapshot.docs.map((doc) => doc.data() as PaymentLogEntry);
}
