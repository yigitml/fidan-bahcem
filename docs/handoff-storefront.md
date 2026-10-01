# Storefront completion handoff — 2026-10-01

The storefront track is complete in the shared checkout. No feature from chatlyzer-web was copied. Google/RevenueCat configuration, API security, provider verification, production deployment, and the remaining integrated browser checks remain owned by the root agent.

## Completed storefront behavior

- Consistent home, catalog, cart/checkout, footer, route metadata, accessible loading, retryable error, and 404 states. Product details show general light/watering guidance and explicitly identify representative photos and uncertain species. Physical nursery checkout is clearly a demo and collects no card information.
- Responsive navigation has current-page indicators, skip links, a native modal menu with keyboard focus containment, Escape/backdrop dismissal, scroll locking, and focus restoration. The effect cleanup captures the trigger node, eliminating the React hooks lint warning.
- Catalog category filtering, price sorting, result announcements, empty-result reset, and search across name/Latin species/category. Searches ignore Turkish diacritics, so `findik` matches `Fındık`; clearing search returns keyboard focus to the search field.
- The cart uses a stable server snapshot before browser storage hydration, discards corrupted/unknown items and invalid quantities, combines duplicate product lines up to 99, propagates storage events between tabs, and falls back to memory if storage is unavailable.
- Checkout shows a hydration state before an empty state, supports removing/updating quantities, uses an 8-second timeout for account prefill, and preserves user edits if the account response arrives late.
- Demo consent is required by the UI and submitted as `demoConsent: true` for the server to enforce. Each new submitted order uses a UUID request ID and a resolved `checkoutUserId` (account UUID or null). Every submit performs a bounded fresh `/me` identity check; failure prevents sending and identity changes preserve the original attempt until its original account/guest identity is restored. The server checks the expected identity and authenticated session atomically.
- A network timeout, malformed successful response, server failure, or conflict preserves the original submission and ID, freezes its form/cart edits, and offers an explicit retry of that same order. Definitive 4xx rejection (except conflict) allows editing and a fresh submission. Versioned `sessionStorage` preserves contact/address/cart/identity/ID/timestamp through reload and navigation in the same tab. Restore validates the UUID, account identity, schema version, timestamp, contact limits, phone/email, known products, unique lines, and quantity limits. Attempts less than 24 hours old restore automatically; those between 24 hours and 90 days require explicit same-ID recovery. Invalid/expired records require a clear previous-order warning and an acknowledgment before the user explicitly discards the local record and starts a new demo order. Success/definitive rejection clears the stored attempt.
- If browser storage is unavailable, no order is sent until the user explicitly acknowledges that retry context can only survive while the current page remains open. This memory fallback preserves the same payload/ID for current-page retries and clearly warns against navigation/reload until receipt. It applies only to nonfinancial demo plant orders, not RevenueCat purchasing.
- Successful checkout validates the server receipt, uses its total/items/account ownership, focuses the receipt heading, and subtracts only purchased quantities from the latest cart. Product additions made while the request was in flight survive. Account-expiry races therefore use the receipt's `userId`, rather than an earlier account prefill, to describe order ownership.
- Home hero uses `loading="eager"` and `fetchPriority="high"` in place of deprecated Next Image `priority`. Error fallback uses the installed Next 16.3 `retry` prop.

## Verified locally

- Read applicable installed Next guides for client boundaries, layouts, error handling, and images before modifying those surfaces.
- Focused ESLint for all owned storefront TS/TSX files and cart tests: clean, no warnings.
- `npm run typecheck`: passed after the checkout/cart changes.
- `node --import tsx --test scripts/cart-tests.ts`: 8 tests passed, covering corrupt/tampered cart values, duplicate quantity limits, retaining in-flight additions, removed/changed cart lines without negative quantities, preserving serialized request/account identity and contact data, recovery age boundaries, and corrupted/tampered storage rejection.
- Scoped `git diff --check`: clean. An unrelated global diff warning was observed in root-owned `deno.json` (blank line at EOF).
- The `tsx` CLI needs a sandbox-forbidden IPC pipe; use Node's `--import tsx` test-loader invocation, which ran successfully without escalation.

## Integrated browser verification for root

### Completed in Zen at 390 × 844

- Search for `findik`, catalog sorting, care disclosures, and mobile-menu keyboard interaction worked.
- Root tested checkout through a disposable local reverse proxy outside the repository. The proxy let the first successful backend order finish, then hid its receipt behind a synthetic HTTP 503. The app retained the pending submission, and reloading restored its original frozen fields and request identity.
- After logout, retry was blocked because the active identity no longer matched the original account. Logging back into that account allowed the same saved submission to return the original 850 TL receipt: `FB-978cabba-7a76-4269-bfba-8b3027de3fe7`.
- Account history contained one order, confirming that recovery did not create a duplicate. The cart count returned to zero after successful recovery.
- Browser data-export download was denied by the permission system. It was not retried or bypassed; the browser download remains unverified.

### Full checklist

1. Desktop and narrow mobile: home/catalog/empty cart/404, no horizontal overflow, image loading, route titles, footer, skip link and visible keyboard focus.
2. Mobile menu: first focus, forward/backward Tab trap, Escape, backdrop dismissal, navigation, restored trigger focus and scroll position; resize while the menu is open.
3. Catalog: every category, both price sort directions, `findik` and `Fındık`, Latin name search, unmatched search, filter reset, search clear focus, care disclosures.
4. Cart: add from home/catalog, header count, reload persistence, second-tab changes, remove/quantity controls, 99 cap, damaged stored JSON/unknown IDs, and blocked storage fallback.
5. Demo checkout: required fields and consent, short/invalid phone rejection from the server, 89 TL delivery below 750 TL, free delivery at 750 TL, no card controls, server receipt total/ID, cleared purchased items, keyboard focus on errors/success.
6. Authenticated checkout: correct profile prefill, editing/clearing fields before prefill resolves, order appears in account history, expired session uses actual receipt ownership.
7. Checkout error recovery: reject definitive bad input, restore edits, preserve original payload/request ID for ambiguous failures, freeze quantity/form controls, and retry without duplicate orders. Reload/navigate away and return after an ambiguous attempt; verify frozen saved fields and same ID are restored. An account login/logout change must preserve the attempt and require its original identity. Test older explicit recovery, corrupt/expired acknowledgment and restart, and storage-disabled explicit current-page memory fallback. Keep additions from another tab while retry is unresolved and after successful receipt.
8. Verify privacy text describes demo contact/address storage; root enforces `demoConsent === true` and canonical order/idempotency validation at the API boundary.

Root owns `package.json`; include `scripts/cart-tests.ts` in the unified unit-test command.
