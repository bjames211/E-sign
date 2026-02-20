# esign-automation

E-signature automation app for Big Buildings Direct. Firebase/React/TypeScript.

## Commands

```bash
# Frontend
npm run dev              # Local dev server
npm run build            # Build (tsc + vite)
npx tsc --noEmit         # Type check frontend

# Cloud Functions
cd functions && npx tsc --noEmit   # Type check functions
firebase deploy --only hosting     # Deploy frontend
firebase deploy --only functions   # Deploy all functions
firebase deploy --only functions:functionName  # Deploy single function
firebase functions:log --only functionName     # View logs
```

## Architecture

- **Firebase project:** `e-sign-27f9a` | Hosting: `https://e-sign-27f9a.web.app`
- **Frontend:** React 18 + TypeScript + Vite (code-split with React.lazy), inline styles (no CSS framework)
- **Backend:** Cloud Functions v1 (Node 20), all exported from `functions/src/index.ts`
- **Database:** Firestore
- **Payments:** Stripe (currently in TEST MODE)
- **E-Signatures:** SignNow API
- **PDF extraction:** Anthropic Claude AI
- **Routing:** Manual view switching in App.tsx (no React Router)
- **Auth:** Firebase Auth + `user_roles` collection for role-based access
- **Roles:** admin > manager > sales_rep. Default fallback is `sales_rep` (least-privilege). `isManager` = admin OR manager.

## Key Collections

| Collection | Purpose |
|---|---|
| `orders` | Order documents with `ledgerSummary` denormalized on them |
| `payment_ledger` | All payment/refund entries (single source of truth). **Read-only for clients** — all writes via Cloud Functions |
| `payment_audit_log` | Immutable audit trail for every payment action |
| `esign_documents` | SignNow document tracking |
| `change_orders` | Change order documents |
| `manufacturer_config` | Deposit %, SignNow template IDs per manufacturer |
| `user_roles` | Email-to-role mapping. **Document ID = email address** (not a field) |
| `order_audit_log` | Order-level audit trail (cancellations, status changes) |
| `prepaid_credits` | Prepaid credit tracking |
| `reconciliation_reports` | Daily reconciliation reports |
| `counters` | Atomic counters for order/payment number generation |

## Order Statuses

`draft` → `pending_payment` → `sent_for_signature` → `signed` → `ready_for_manufacturer`

`cancelled` — terminal state, can be reached from any non-draft status. Cancels linked SignNow invites and active change orders. Payment ledger entries are preserved (not voided).

## Payment System Rules

- **All payment writes go through Cloud Functions** (`addLedgerEntry`), never client-side Firestore
- **Never delete ledger entries** — void them (`status: 'voided'`)
- **Amounts are always positive** — `transactionType` determines direction: `payment`, `refund`, `deposit_increase`, `deposit_decrease`
- **Never modify amounts after creation** — void and create new
- **Balance formula:** `depositRequired - netReceived` (positive = customer owes, negative = refund due)
- **`netReceived`** only counts `verified` or `approved` entries (not `pending`)
- **Summary is cached on order as `order.ledgerSummary`** — this is what the UI reads for instant display
- `recalculateLedgerSummary(orderId)` recalculates from raw ledger entries and updates the cached summary
- Legacy `order.paymentSummary` exists but is deprecated; `ledgerSummary` is the source of truth
- Payment numbers are sequential (`PAY-XXXXX`) via atomic Firestore counter

## Cloud Functions (key ones)

| Function | Purpose |
|---|---|
| `addLedgerEntry` | Create payment/refund ledger entry |
| `approveLedgerEntry` | Manager approves pending entry |
| `voidLedgerEntry` | Void an entry (soft delete) |
| `recalculateLedgerSummary` | Rebuild cached summary from entries |
| `getAllLedgerEntries` | Fetch all entries (admin) |
| `getPendingLedgerEntries` | Fetch entries needing approval |
| `cancelOrder` | Cancel order + linked esign + change orders |
| `sendOrderForSignature` | Upload PDF to SignNow + send invite |
| `cancelSignature` | Cancel SignNow invite only |
| `signNowWebhook` | Handle SignNow document.complete callback |
| `setUserRole` | Set user role (admin-only, requires `callerEmail` for auth) |
| `getUserRoles` | List all user roles |
| `createPaymentIntent` | Stripe payment intent |
| `stripeWebhook` | Handle Stripe webhooks |

## SignNow Integration

- Templates are configured per manufacturer in `manufacturer_config` collection
- `copyFieldsFromTemplate` filters to only signature/initials/date/email fields (text/checkbox excluded)
- Test mode orders still send real SignNow emails if a PDF is uploaded
- Webhooks registered on `document.complete` → `signNowWebhook` → `updateOrderOnSigned`
- `orderEsignBridge.ts` guards against updating cancelled orders on signed callback

## Key Types

- `Order` / `OrderStatus` — `src/types/order.ts`
- `PaymentLedgerEntry` / `OrderLedgerSummary` — `src/types/payment.ts`
- `ChangeOrder` — `src/types/changeOrder.ts`
- `UserRole`: admin | manager | sales_rep — `src/contexts/AuthContext.tsx`

## Project Structure

```
src/
├── components/
│   ├── admin/          # AdminPanel, PDF extraction, signature preview
│   ├── manager/        # ManagerPayments (approval queue)
│   ├── orderForm/      # Multi-step order creation form
│   ├── orders/         # OrdersList, OrderDetails, OrderCard, ChangeOrderPage
│   ├── payments/       # PaymentSection, PaymentReconciliation, PaymentSummaryCard, PaymentHistoryTable
│   ├── sales/          # SalesDashboard (rep view)
│   └── stripe/         # Stripe payment components
├── services/           # API/Firestore service layers
├── types/              # TypeScript type definitions
├── contexts/           # AuthContext (role management)
└── config/             # Firebase config
functions/src/
├── index.ts            # All Cloud Function exports
├── orderEsignBridge.ts # SignNow ↔ Order status sync
└── signNowService.ts   # SignNow API client
```

## Environment Variables

Frontend (in `.env.local`):
- `VITE_FIREBASE_*` — Firebase config (API key, auth domain, project ID, etc.)
- `VITE_STRIPE_PUBLISHABLE_KEY` — Stripe publishable key
- `VITE_STRIPE_MODE` — `test` or `live`
- `VITE_FUNCTIONS_URL` — Cloud Functions base URL (`https://us-central1-e-sign-27f9a.cloudfunctions.net`)

## Conventions

- Inline `React.CSSProperties` style objects, no CSS modules/Tailwind
- Components grouped by feature domain in `src/components/`
- Services in `src/services/` wrap Firestore/API calls
- Cloud Functions in `functions/src/` — business logic lives here, not in frontend
- Never hardcode Stripe keys or secrets — use environment variables
- All fetch calls must check `response.ok` before calling `.json()`
- Heavy view components are lazy-loaded via `React.lazy()` in App.tsx
- Vite splits Firebase and Stripe into separate chunks for caching
- Deprecated functions are marked with `@deprecated` JSDoc and should not be used for new code

## Security

- `setUserRole` requires `callerEmail` and verifies caller is admin before allowing role changes
- Default role fallback is `sales_rep` (least-privilege) in both AuthContext and Firestore rules
- `payment_ledger` is read-only for clients (`create, update, delete: if false` in Firestore rules)
- Payment audit log is immutable — no client writes allowed
