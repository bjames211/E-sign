# AI Developer Prompt: Payment Automation System

## Your Mission

You are building automation features for an existing Order Forms, Payments, and Audit Tracking System. The system already has a working foundation - your job is to ADD automation capabilities without breaking existing functionality.

---

## CRITICAL: Read This First

### Technology Stack
- **Frontend**: React + TypeScript + Vite
- **Backend**: Firebase (Firestore + Cloud Functions + Storage)
- **Payments**: Stripe API
- **E-Signatures**: SignNow API

### Firestore Collections
- `orders` - Order documents with `ledgerSummary` for balance tracking
- `payment_ledger` - Individual payment/refund/adjustment entries
- `changeOrders` - Order revisions that can change deposit amounts
- `payments` - Legacy payment records (being phased out)

---

## Existing Data Types (DO NOT MODIFY - extend only)

### PaymentLedgerEntry (Single Source of Truth for Transactions)
```typescript
interface PaymentLedgerEntry {
  id?: string;
  orderId: string;
  orderNumber: string;
  changeOrderId?: string;
  changeOrderNumber?: string;

  // CRITICAL: Transaction type determines how amount affects balance
  transactionType: 'payment' | 'refund' | 'deposit_increase' | 'deposit_decrease';

  // Amount is ALWAYS POSITIVE - transactionType determines direction
  amount: number;

  method: 'stripe' | 'check' | 'wire' | 'credit_on_file' | 'cash' | 'other';
  category: 'initial_deposit' | 'additional_deposit' | 'refund' | 'change_order_adjustment';

  status: 'pending' | 'verified' | 'approved' | 'voided';

  // Stripe verification
  stripePaymentId?: string;
  stripeVerified?: boolean;
  stripeAmount?: number;          // Cents
  stripeAmountDollars?: number;

  // Manual payment proof
  proofFile?: {
    name: string;
    storagePath: string;
    downloadUrl: string;
    size: number;
    type: string;
  };

  // Audit trail
  description: string;
  notes?: string;
  createdAt: Timestamp;
  createdBy: string;
  approvedBy?: string;
  approvedAt?: Timestamp;

  // Soft delete
  voidedAt?: Timestamp;
  voidedBy?: string;
  voidReason?: string;
}
```

### OrderLedgerSummary (Denormalized on Order Document)
```typescript
interface OrderLedgerSummary {
  // What's required
  depositRequired: number;        // Current deposit after adjustments
  originalDeposit: number;        // Starting deposit
  depositAdjustments: number;     // Sum of increase/decrease entries

  // What's been received
  totalReceived: number;          // Sum of payments (verified/approved)
  totalRefunded: number;          // Sum of refunds (verified/approved)
  netReceived: number;            // totalReceived - totalRefunded

  // Balance calculation
  balance: number;                // depositRequired - netReceived
                                  // Positive = customer owes us
                                  // Negative = we owe customer (refund due)
  balanceStatus: 'paid' | 'underpaid' | 'overpaid' | 'pending';

  // Pending (not yet verified/approved)
  pendingReceived: number;
  pendingRefunds: number;

  // Metadata
  entryCount: number;
  calculatedAt: Timestamp;
}
```

### Order (Relevant Fields Only)
```typescript
interface Order {
  id: string;
  orderNumber: string;            // "ORD-00030"
  status: 'draft' | 'pending_payment' | 'sent_for_signature' | 'signed' | 'ready_for_manufacturer';

  pricing: {
    subtotalBeforeTax: number;    // Full order value
    extraMoneyFluff: number;      // Additional charges
    deposit: number;              // Current required deposit
  };

  ledgerSummary?: OrderLedgerSummary;  // Single source of truth

  customer: {
    firstName: string;
    lastName: string;
    email: string;
    phone: string;
    // ...
  };

  payment: {
    type: 'stripe_already_paid' | 'stripe_pay_now' | 'stripe_pay_later' | 'check' | 'wire' | 'credit_on_file' | 'other';
    status: 'pending' | 'paid' | 'manually_approved' | 'failed';
    stripePaymentId?: string;
    stripePaymentLinkId?: string;
    stripePaymentLinkUrl?: string;
  };
}
```

---

## Balance Calculation Formula (MUST FOLLOW)

```
depositRequired = originalDeposit + sum(deposit_increases) - sum(deposit_decreases)
netReceived = sum(verified/approved payments) - sum(verified/approved refunds)
balance = depositRequired - netReceived

if (balance > 0) → "underpaid" - customer owes us
if (balance < 0) → "overpaid" - we owe customer a refund
if (balance === 0) → "paid" - fully settled
```

---

## Existing Cloud Functions (Use These)

| Function | Method | Purpose |
|----------|--------|---------|
| `addLedgerEntry` | POST | Add any ledger entry |
| `recalculateLedgerSummary` | POST | Recalculate summary from entries |
| `voidLedgerEntry` | POST | Soft-delete an entry |
| `addPaymentRecord` | POST | Add payment (creates ledger entry) |
| `approvePaymentRecord` | POST | Approve pending payment |

### Example: Adding a Ledger Entry
```typescript
const response = await fetch(`${FUNCTIONS_URL}/addLedgerEntry`, {
  method: 'POST',
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({
    orderId: 'abc123',
    orderNumber: 'ORD-00030',
    transactionType: 'payment',  // or 'refund', 'deposit_increase', 'deposit_decrease'
    amount: 1500,                // ALWAYS positive
    method: 'stripe',
    category: 'initial_deposit',
    description: 'Initial deposit payment',
    stripePaymentId: 'pi_xxx',
    createdBy: 'system',
  }),
});
```

---

## FEATURES TO BUILD (Automation Tasks)

### 1. Automatic Payment Link Generation for Underpaid Orders

**Trigger**: When `ledgerSummary.balance > 0` (customer owes money)

**What to Build**:
- Cloud Function: `generatePaymentLink`
- Creates Stripe Payment Link for exact balance amount
- Stores link URL on order: `order.payment.stripePaymentLinkUrl`
- Optionally sends email to customer with link

**Input**:
```typescript
{
  orderId: string;
  amount?: number;  // Optional override, defaults to balance
  sendEmail?: boolean;
}
```

**Output**:
```typescript
{
  success: boolean;
  paymentLinkUrl: string;
  paymentLinkId: string;
}
```

---

### 2. Automatic Refund Processing for Overpaid Orders

**Trigger**: When `ledgerSummary.balance < 0` (we owe customer)

**What to Build**:
- Cloud Function: `processRefund`
- Finds original Stripe payment(s) for order
- Issues Stripe refund for overpaid amount
- Creates ledger entry with `transactionType: 'refund'`
- Updates `ledgerSummary`

**Input**:
```typescript
{
  orderId: string;
  amount?: number;  // Optional partial refund, defaults to full overpayment
  reason?: string;
  createdBy: string;
}
```

**Logic**:
1. Get order's ledger entries where `transactionType === 'payment'` and `stripePaymentId` exists
2. Calculate total refundable amount
3. Call Stripe Refund API
4. Add ledger entry with `transactionType: 'refund'`
5. Recalculate summary

---

### 3. Stripe Webhook Handler for Automatic Payment Recording

**Trigger**: Stripe webhook events

**What to Build**:
- Cloud Function: `stripeWebhook`
- Handles `payment_intent.succeeded` events
- Matches payment to order via metadata or payment link
- Automatically creates ledger entry
- Updates order status if fully paid

**Events to Handle**:
- `payment_intent.succeeded` - Record payment
- `charge.refunded` - Record refund
- `payment_link.completed` - Payment link used

**Matching Logic**:
```typescript
// Payment Intent metadata should include:
{
  orderId: string;
  orderNumber: string;
}

// Or match via payment link ID stored on order
```

---

### 4. Prepaid Quote/Payment Tracking

**Problem**: Customers sometimes pay before order form exists

**What to Build**:
- New Firestore collection: `prepaid_credits`
- Cloud Function: `recordPrepaidPayment`
- Cloud Function: `applyPrepaidCredit`
- UI to link prepaid amounts to orders

**Data Structure**:
```typescript
interface PrepaidCredit {
  id: string;
  customerEmail: string;
  customerName: string;
  amount: number;
  stripePaymentId: string;
  stripeVerified: boolean;
  status: 'available' | 'applied' | 'refunded';
  appliedToOrderId?: string;
  appliedAt?: Timestamp;
  createdAt: Timestamp;
  notes?: string;
}
```

**Flow**:
1. Payment comes in before order exists → create `PrepaidCredit`
2. Order is created → UI shows matching prepaid credits
3. Staff clicks "Apply" → creates ledger entry, marks credit as applied

---

### 5. PDF Deposit Extraction (OCR)

**Problem**: Deposit amounts are manually entered, could mismatch PDF

**What to Build**:
- Cloud Function: `extractPdfDeposit`
- Uses Google Document AI or similar
- Extracts deposit amount from uploaded PDF
- Compares to entered amount
- Flags discrepancies

**Input**:
```typescript
{
  orderId: string;
  pdfStoragePath: string;
}
```

**Output**:
```typescript
{
  success: boolean;
  extractedDeposit: number | null;
  extractedSubtotal: number | null;
  confidence: number;
  matchesEntered: boolean;
  discrepancy?: number;
}
```

---

### 6. Daily Reconciliation Report

**What to Build**:
- Scheduled Cloud Function (runs daily)
- Compares all ledger entries vs Stripe records
- Identifies discrepancies
- Sends email report to admin

**Report Contents**:
- Orders with balance issues
- Payments in Stripe not in ledger
- Ledger entries without Stripe verification
- Total receivables outstanding
- Total refunds due

---

## File Locations (For Reference)

```
/src/types/payment.ts          - All payment types (shown above)
/src/types/order.ts            - Order types
/src/services/paymentService.ts - Frontend payment functions
/src/components/payments/      - Payment UI components
/functions/src/                - Cloud Functions (if exists)
```

---

## Testing Instructions

1. Use order `ORD-00030` for testing - it has ledger data
2. Test payments use `stripePaymentId` starting with `test_`
3. Always recalculate ledger summary after changes
4. Check `ledgerSummary.balance` to verify calculations

---

## DO NOT

1. Delete ledger entries - use `status: 'voided'` instead
2. Modify amounts after creation - void and create new
3. Use negative amounts - use `transactionType` to indicate direction
4. Bypass the ledger system - ALL financial changes go through ledger
5. Hardcode Stripe keys - use environment variables

---

## Questions to Ask Before Starting

1. Do you have access to the Firebase project?
2. Do you have Stripe API keys (test and live)?
3. Which features should I prioritize?
4. Should automated emails go through SendGrid, Firebase, or another service?
5. What's the approval workflow for refunds over $X amount?

---

## Example Implementation Pattern

```typescript
// Cloud Function pattern
export const processRefund = functions.https.onRequest(async (req, res) => {
  try {
    const { orderId, amount, reason, createdBy } = req.body;

    // 1. Get order and validate
    const orderDoc = await db.collection('orders').doc(orderId).get();
    if (!orderDoc.exists) {
      return res.json({ success: false, error: 'Order not found' });
    }
    const order = orderDoc.data();

    // 2. Check balance (must be overpaid)
    const balance = order.ledgerSummary?.balance || 0;
    if (balance >= 0) {
      return res.json({ success: false, error: 'Order is not overpaid' });
    }

    const refundAmount = amount || Math.abs(balance);

    // 3. Find Stripe payment to refund
    const payments = await db.collection('payment_ledger')
      .where('orderId', '==', orderId)
      .where('transactionType', '==', 'payment')
      .where('stripePaymentId', '!=', null)
      .get();

    // 4. Process Stripe refund
    const stripe = new Stripe(process.env.STRIPE_SECRET_KEY);
    const refund = await stripe.refunds.create({
      payment_intent: payments.docs[0].data().stripePaymentId,
      amount: Math.round(refundAmount * 100), // Convert to cents
    });

    // 5. Create ledger entry
    await db.collection('payment_ledger').add({
      orderId,
      orderNumber: order.orderNumber,
      transactionType: 'refund',
      amount: refundAmount,
      method: 'stripe',
      category: 'refund',
      status: 'verified',
      stripePaymentId: refund.id,
      stripeVerified: true,
      description: reason || 'Overpayment refund',
      createdAt: admin.firestore.FieldValue.serverTimestamp(),
      createdBy,
    });

    // 6. Recalculate summary
    await recalculateLedgerSummary(orderId);

    return res.json({ success: true, refundId: refund.id });
  } catch (error) {
    return res.json({ success: false, error: error.message });
  }
});
```

---

## Start Here

1. Review the existing code in `/src/services/paymentService.ts`
2. Check if `/functions/src/` exists for cloud functions
3. Ask which feature to build first
4. Build incrementally - one feature at a time
5. Test with existing orders before creating new ones

Good luck!
