/**
 * Stripe Configuration
 * Manages live/test mode switching and key validation
 *
 * Environment Variables:
 * - STRIPE_MODE: 'test' | 'live' (defaults to 'test')
 * - STRIPE_SECRET_KEY_TEST: Test mode secret key
 * - STRIPE_SECRET_KEY_LIVE: Live mode secret key
 * - STRIPE_WEBHOOK_SECRET_TEST: Test mode webhook signing secret
 * - STRIPE_WEBHOOK_SECRET_LIVE: Live mode webhook signing secret
 *
 * Legacy support:
 * - STRIPE_SECRET_KEY: Falls back if mode-specific key not found
 * - STRIPE_WEBHOOK_SECRET: Falls back if mode-specific secret not found
 */

export type StripeMode = 'test' | 'live';

// Determine mode from environment
export const STRIPE_MODE: StripeMode = (process.env.STRIPE_MODE as StripeMode) || 'test';
export const IS_LIVE_MODE: boolean = STRIPE_MODE === 'live';

// Get the appropriate secret key based on mode
function getSecretKey(): string {
  if (IS_LIVE_MODE) {
    const liveKey = process.env.STRIPE_SECRET_KEY_LIVE;
    if (liveKey) return liveKey;

    // Fatal error in production - cannot use test key in live mode
    throw new Error(
      'CRITICAL: STRIPE_MODE is "live" but STRIPE_SECRET_KEY_LIVE is not set. ' +
      'Refusing to use test key in live mode.'
    );
  }

  // Test mode - try mode-specific key first, then fall back to legacy key
  const testKey = process.env.STRIPE_SECRET_KEY_TEST || process.env.STRIPE_SECRET_KEY;
  if (!testKey) {
    throw new Error('Missing Stripe secret key. Set STRIPE_SECRET_KEY_TEST or STRIPE_SECRET_KEY.');
  }

  return testKey;
}

// Get the appropriate webhook secret based on mode
function getWebhookSecret(): string | undefined {
  if (IS_LIVE_MODE) {
    const liveSecret = process.env.STRIPE_WEBHOOK_SECRET_LIVE;
    if (!liveSecret) {
      // In live mode, webhook secret is MANDATORY
      throw new Error(
        'CRITICAL: STRIPE_MODE is "live" but STRIPE_WEBHOOK_SECRET_LIVE is not set. ' +
        'Webhook signature verification is mandatory in production.'
      );
    }
    return liveSecret;
  }

  // Test mode - try mode-specific secret first, then fall back to legacy
  return process.env.STRIPE_WEBHOOK_SECRET_TEST || process.env.STRIPE_WEBHOOK_SECRET;
}

// Export the resolved configuration
export const STRIPE_SECRET_KEY = getSecretKey();
export const STRIPE_WEBHOOK_SECRET = getWebhookSecret();

// Log mode on startup (only once)
const modeEmoji = IS_LIVE_MODE ? '🔴' : '🟡';
console.warn(`${modeEmoji} STRIPE RUNNING IN ${STRIPE_MODE.toUpperCase()} MODE`);

if (IS_LIVE_MODE) {
  console.warn('⚠️  LIVE MODE ENABLED - Real charges will be processed!');
}

// Validation helpers
export function validateKeyPrefix(key: string): boolean {
  if (IS_LIVE_MODE) {
    return key.startsWith('sk_live_');
  }
  return key.startsWith('sk_test_');
}

export function validatePublishableKeyPrefix(key: string): boolean {
  if (IS_LIVE_MODE) {
    return key.startsWith('pk_live_');
  }
  return key.startsWith('pk_test_');
}

// Verify key prefix matches mode (runtime check)
if (!STRIPE_SECRET_KEY.includes('placeholder')) {
  if (IS_LIVE_MODE && !STRIPE_SECRET_KEY.startsWith('sk_live_')) {
    throw new Error(
      'CRITICAL: STRIPE_MODE is "live" but secret key does not start with "sk_live_". ' +
      'Key/mode mismatch detected.'
    );
  }
  if (!IS_LIVE_MODE && !STRIPE_SECRET_KEY.startsWith('sk_test_')) {
    console.warn('⚠️  Warning: Test mode but secret key does not start with "sk_test_"');
  }
}

// Shared Stripe instance — import this instead of creating new Stripe() in each file
import Stripe from 'stripe';
export const stripe = new Stripe(STRIPE_SECRET_KEY, {
  apiVersion: '2023-10-16',
});

// Export configuration summary (safe to log, no secrets)
export const STRIPE_CONFIG = {
  mode: STRIPE_MODE,
  isLiveMode: IS_LIVE_MODE,
  hasWebhookSecret: !!STRIPE_WEBHOOK_SECRET,
  keyPrefix: STRIPE_SECRET_KEY.substring(0, 8) + '...',
} as const;
