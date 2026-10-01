# Fidan Bahçem

Turkish nursery storefront with searchable plant care information, a persistent cart, explicitly simulated plant orders, customer accounts and a protected owner dashboard. Plant orders collect no card information and trigger no payment or shipment.

Google OAuth and RevenueCat account billing are implemented. They enable only when dedicated provider configuration is present; no product, entitlement, credit system or customer data from chatlyzer-web is reused. Current provider onboarding and verification are recorded in [the implementation status](docs/implementation-handoff.md).

## Local development

```sh
npm ci
npm run dev
```

The Node development server previews the UI. Functional account/order APIs require Deno KV. For a complete local instance:

```sh
cp .env.example .env.local
npm run build
APP_URL=http://127.0.0.1:3000 npm run start:local
```

Open `http://127.0.0.1:3000`. The local runner always opens an explicit SQLite KV file at `.local-data/store.sqlite`, never a deployment database. Override `FIDAN_KV_PATH` for disposable verification. Next loads `.env.local`; use app-specific credentials there and keep it untracked. Password accounts and demo orders work without Google or RevenueCat.

## Verification

```sh
npm run lint
npm run typecheck
npm test
npm audit --omit=dev
npm run build
npm run test:acceptance -- http://127.0.0.1:3000
```

`npm test` runs cart/recovery, signed Google token/authentication, RevenueCat and request/order concurrency suites. Deno tests use isolated in-memory KV and need no network or write permission. Acceptance tests run against the actual server, create synthetic accounts and delete their records. Optional `ADMIN_TEST_KEY` enables owner tests; production verification can read a private owner key file as the second acceptance argument. Never print or commit the real owner key.

The compiled billing regression is separate: `npm run test:runtime-config -- <local-origin>` checks that a standalone build reads its runtime public SDK key and excludes server secrets. Follow the [isolated runtime configuration procedure](docs/production.md#compiled-runtime-configuration-regression) to use distinct synthetic build/runtime keys, complete fake billing settings, a dedicated port and temporary KV. This check creates and deletes a disposable local account and makes no RevenueCat requests or purchases.

## Production and providers

Live: [Fidan Bahçem](https://fidan-bahcem-web.yigitml.deno.net).

The existing Deno Deploy app is `yigitml/fidan-bahcem-web`, with managed Deno KV. `deno.json` uses an explicit custom runtime: the build prepares standalone static assets, then `scripts/start-deploy.mjs` starts Next's generated standalone server on `0.0.0.0` and the supplied `PORT` (default `8000`). This bypasses Deno's failing Next.js integration finalizer. The deployment runner keeps the native, timeline-bound `Deno.openKv()` connection and refuses local execution.

For this existing app, Deno Settings → App Configuration also required **No Preset** / **Dynamic App**, entrypoint `scripts/start-deploy.mjs`, and working directory `.`; removing the source preset alone left the saved Next.js finalizer active. Latest production revision `9ngzmvzqs125` completed Install, Build and Deploy successfully and serves the canonical URL. All 94 tests, the compiled runtime-key/webhook-only regressions, isolated compiled owner/customer acceptance and fresh production synthetic acceptance pass. Production checks include OAuth start/cancellation/replay and disposable-record cleanup. Previous revision `86cjy6mk1hrz` succeeded after an unchanged retry of a transient artifact failure. On October 2 the human completed Google consent and the actual code exchange returned the expected explicit-link requirement for the preserved password account. Human current-password entry/submission and real link/login/reauthentication remain pending. The subsequent server/webhook configuration separation passes all 94 tests and compiled runtime-key/webhook-only acceptance; it is deployed in the current production revision.

Deploy using the authenticated owner CLI:

```sh
deno deploy --prod --json --non-interactive --org yigitml --app fidan-bahcem-web
```

Set canonical `APP_URL`, Google callback credentials and app-specific RevenueCat keys/products in the deployment environment before enabling those providers. See [.env.example](.env.example) for names and [production operations](docs/production.md) for exact onboarding, security, data retention and verification steps. Server secrets never enter public configuration.

Production `APP_URL` is saved as `https://fidan-bahcem-web.yigitml.deno.net` for the Production environment only; previews need their own canonical origin. Provider onboarding uses Google Cloud project `psyched-loader-510323-e2` and RevenueCat project `cd7cbe23` (`FidanBahcem`). RevenueCat Test Store now has QA Offering `fidan_qa`, product `fidan_qa_monthly`, and entitlement `fidan_qa_test`. Real Test Store checkout cancellation/failure/success, server synchronization, reload and mobile persistence passed against the compiled local app; an independent provider read also verified sandbox renewal/expiry mapping. No Stripe connection or real-money billing is configured. Validated server-only webhook configuration can operate while the public SDK key remains unset and checkout stays disabled. Provider subscription cancellation/refund/management, webhook setup/delivery and a genuine production account Offering remain pending. The server credential must support RevenueCat REST API V1 subscriber reads; the public Test Store key worked for sandbox QA, while a V2-only key must not be assumed compatible.

GitHub Actions runs lint, types, isolated tests, dependency audit, a build with a synthetic public key, the compiled runtime regression with a different synthetic key, and real-server acceptance against a separate local KV file. Detailed track notes: [authentication](docs/handoff-auth.md), [billing](docs/handoff-billing.md), [storefront](docs/handoff-storefront.md).
