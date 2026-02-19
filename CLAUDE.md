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
- **Frontend:** React 18 + TypeScript + Vite, inline styles (no CSS framework)
- **Backend:** Cloud Functions v1 (Node 20), all exported from `functions/src/index.ts`
- **Database:** Firestore
- **Payments:** Stripe (currently in TEST MODE)
- **E-Signatures:** SignNow API
- **PDF extraction:** Anthropic Claude AI
- **Routing:** Manual view switching in App.tsx (no React Router)
- **Auth:** Firebase Auth + `user_roles` collection for role-based access

## Key Collections

| Collection | Purpose |
|---|---|
| `orders` | Order documents with `ledgerSummary` denormalized on them |
| `payment_ledger` | All payment/refund entries (single source of truth) |
| `payment_audit_log` | Audit trail for every payment action |
| `esign_documents` | SignNow document tracking |
| `change_orders` | Change order documents |
| `manufacturer_config` | Deposit %, SignNow template IDs per manufacturer |
| `user_roles` | Email-to-role mapping (admin, manager, sales_rep) |

## Payment System Rules

- **All payment writes go through Cloud Functions** (`addLedgerEntry`), never client-side Firestore
- **Never delete ledger entries** — void them (`status: 'voided'`)
- **Amounts are always positive** — `transactionType` determines direction (payment/refund/deposit_increase/deposit_decrease)
- **Never modify amounts after creation** — void and create new
- **Balance formula:** `depositRequired - netReceived` (positive = customer owes, negative = refund due)
- **Summary is cached on order as `order.ledgerSummary`** — this is what the UI reads
- Legacy `order.paymentSummary` exists but is deprecated; `ledgerSummary` is the source of truth
- `recalculateLedgerSummary(orderId)` recalculates from ledger entries and updates the order

## SignNow Integration

- Templates are configured per manufacturer in `manufacturer_config` collection
- `copyFieldsFromTemplate` filters to only signature/initials/date/email fields (text/checkbox excluded)
- Test mode orders still send real SignNow emails if a PDF is uploaded
- Webhooks registered on `document.complete` → `signNowWebhook` → `updateOrderOnSigned`

## Key Types

- `Order` / `OrderStatus` — `src/types/order.ts`
- `PaymentLedgerEntry` / `OrderLedgerSummary` — `src/types/payment.ts`
- `ChangeOrder` — `src/types/changeOrder.ts`
- `UserRole`: admin | manager | sales_rep — `src/contexts/AuthContext.tsx`

## Conventions

- Inline `React.CSSProperties` style objects, no CSS modules/Tailwind
- Components grouped by feature domain in `src/components/`
- Services in `src/services/` wrap Firestore/API calls
- Cloud Functions in `functions/src/` — business logic lives here, not in frontend
- Never hardcode Stripe keys or secrets — use environment variables
- Deprecated functions are marked with `@deprecated` JSDoc and should not be used for new code
