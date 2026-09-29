# Production operations

## Setup — 2026-09-30

Repository: https://github.com/yigitml/fidan-bahcem ; default branch `main`.

Hosting: Deno Deploy organization `yigitml`, application `fidan-bahcem-web`, free plan, 3072 MB build allocation. Public URL: https://fidan-bahcem-web.yigitml.deno.net with managed HTTPS. No domain was purchased. This reuses chatlyzer-web's hosting pattern, not its customer data or secrets.

Managed database `fidan-bahcem-db` is assigned to the app. `Deno.openKv()` uses its deployment timeline binding; production and preview are separated. `ADMIN_KEY_HASH` contains the SHA-256 hash of a random owner key. The raw key is delivered in a private local file outside the repository.

## Schema / migration

The old application had browser-only carts and simulated checkout, no production account/order database to import. Existing carts remain compatible. Schema v1 uses KV prefixes `user`, `email`, `session`, `order`, `orders`, `order-request`, `operator-session`, `rate`, and `schema`.

Email uniqueness and order creation use optimistic atomic checks. The API recalculates catalog prices and delivery fees. Idempotency keys prevent duplicate checkout retries. Owner status changes update the customer order view atomically. Guest orders expire after 90 days; account-linked records remain until deletion. Schema changes must preserve existing keys or include an explicit migration. No automated backup/restore job or restore drill is configured; do not treat managed storage as a tested backup.

## Security and privacy

Salted scrypt password hashes; random hashed session tokens; HttpOnly/Secure/SameSite cookies. Customer sessions expire in seven days and owner sessions in one hour. Recovery codes rotate and revoke customer sessions. Signup is public; email ownership is not verified. Lost passwords require the saved recovery code—there is no fake password-reset email.

The `/yonetim` dashboard requires the private owner key. Rotate it by generating a new random 32-byte key, saving its SHA-256 hash to Deno's `ADMIN_KEY_HASH` secret, and redeploying. Existing owner sessions expire within an hour. Never expose the raw key in source, CI, logs or URLs.

Mutation endpoints require matching Origin/Host, enforce body limits, validate fields, rate-limit by IP/action and return generic infrastructure errors. Headers deny frames and MIME sniffing, enforce HTTPS and disable unnecessary browser permissions. API responses are not cacheable. Order reads/exports are user-scoped. Account deletion requires the password and removes associated orders/indexes/sessions. No analytics cookies. Card fields never enter API payloads or storage.

## Verification and deployment

GitHub Actions `Production validation` installs dependencies, runs lint/types/audit/build, starts Deno with an isolated local KV database, and tests pages, health, CSRF, registration, failed login, sessions, durable/idempotent orders, server pricing, input validation, owner authorization/status updates, account isolation, recovery/session revocation, export, profile edits and deletion.

Local and production acceptance suites passed on 2026-09-30. Browser guest checkout also saved an order and cleared the cart. Use only synthetic data for production verification:

```bash
node scripts/acceptance.mjs https://fidan-bahcem-web.yigitml.deno.net /absolute/path/to/private-owner-access.txt
```

The test creates disposable accounts and deletes their associated records. The optional private key file enables owner tests without printing the key.

Deploy a clean `main` checkout with `deno deploy --prod --json --non-interactive --org yigitml --app fidan-bahcem-web`. Check `/api/store/health` and rerun acceptance tests; routed status alone is insufficient. The health route performs a KV read and returns 503 on failure. Checkout retains the cart on failure and uses the same request ID for retry. Roll back by redeploying a known-good Git revision, retaining schema compatibility. Deployment needs the authenticated owner CLI; GitHub does not contain a long-lived production token.

## Separate onboarding / intentional exclusions

Real payments and payment callbacks are excluded by request. Shipping-provider callbacks, email/SMS notifications, social OAuth, email verification, live inventory integrations, automated backup/restore, external uptime paging and custom domains are not configured. No fake external integration is claimed. Password authentication and recovery codes work without those providers.

The catalog has representative photographs and provisional plant identification. Before genuine commerce, the owner must confirm inventory/pricing, physical fulfillment, business/contact details and applicable legal/customer policies. Current orders are simulated, not paid purchases. The production app and implemented workflows are operational; external onboarding is recorded separately.
