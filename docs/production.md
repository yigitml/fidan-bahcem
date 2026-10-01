# Production operations

## Hosting

Repository: https://github.com/yigitml/fidan-bahcem, branch `main`. Existing Deno Deploy organization `yigitml`, app `fidan-bahcem-web`, URL https://fidan-bahcem-web.yigitml.deno.net. `deno.json` declares installation/build settings and an explicit dynamic runtime entrypoint; no framework preset is set. Managed KV `fidan-bahcem-db` is bound by deployment timeline; previews and production are separate. No custom domain or paid plan was purchased.

`npm run build` generates Next's standalone server and copies `public` and `.next/static` into its artifact. Deno executes `scripts/start-deploy.mjs`, which requires `DENO_DEPLOY=true` and native KV support, binds `HOSTNAME=0.0.0.0`, preserves a supplied `PORT` or defaults to `8000`, and imports `.next/standalone/server.js`. It never opens a SQLite file or overrides `Deno.openKv`; application database calls use the assigned managed database. The separate local runner always opens an explicit local KV file and refuses Deno Deploy.

This custom runtime bypasses the automatic Next.js integration finalizer: revision `fadnf27bvvsc` completed compilation, TypeScript checks, page tracing and static asset preparation, then failed with `Integration error: please contact support` during `Finalizing build for nextjs`. Removing the framework preset from source alone did not clear this existing app's saved integration: revision `8nvp2snc9xpp` still prepared/finalized as Next.js and failed the same way. In Deno Settings → App Configuration, root explicitly saved **No Preset**, **Dynamic App**, entrypoint `scripts/start-deploy.mjs`, working directory `.`, install `npm ci`, and build `npm run build`. Keep those dashboard settings aligned with `deno.json` when migrating an existing app. Use the [documented custom runtime configuration](https://docs.deno.com/deploy/reference/builds/) and [managed KV connection](https://docs.deno.com/deploy/reference/deno_kv/).

After that dashboard change, revision `0p3a9m1c1djn` routed successfully on 2026-10-01. Production health confirmed connected managed KV and schema 1, with `googleAvailable: true`. The later revision `a56e105ffwv9` passed full production acceptance, including live OAuth start/cancellation/replay and disposable-record cleanup. Next reconstructs its standalone request URL from the internal listener: the OAuth guard requires exact canonical Host and permits that known listener only under `DENO_DEPLOY`; it never trusts forwarding headers. Final source passes 91 tests and compiled local acceptance, including loopback URL normalization and distinct build/runtime billing keys. At that October 1 checkpoint, the Google grant and password-account link were pending. On October 2 the human completed consent; the actual code exchange and signed identity verification returned the expected `link_required` result while preserving the existing password account. Its current-password link submission, Google login and reauthentication remain pending.

Latest production revision `86cjy6mk1hrz` completed Install, Build and Deploy successfully in 1 minute 15 seconds on 2026-10-01, and the Production timeline points to the canonical URL. Deno's Retry Build action created this revision using the unchanged configuration after `v20rj5gajjkj` passed compilation/types/prerendering/tracing/static asset preparation but failed at artifact creation with exit code 1. The successful retry needed no source or configuration change. CLI 0.0.9907 publishes an existing app's source manifest without applying framework autodetection; the failure was distinct from the earlier native Next.js finalizer issue. Full production acceptance against `86cjy6mk1hrz` completed with exit 0, including owner/customer/order flows, OAuth start/cancellation/replay and successful disposable-record cleanup. Those acceptance checks alone do not establish a real Google grant, password-account link or Google-only deletion reauthentication. The separate October 2 Zen grant/code-exchange verification establishes the provider grant only.

October 2 revision **9ngzmvzqs125** deploys server/webhook verification independent of public checkout configuration. CLI reported routed and Zen confirmed all build stages succeeded with Production Serving traffic. Fresh production synthetic acceptance passes OAuth start/cancellation/replay, customer/order/privacy flows and disposable cleanup. All 94 source tests and the compiled runtime-key/webhook-only checks pass; isolated compiled acceptance also verifies owner management. The production synthetic run does not use the real owner key. Actual provider webhook setup/delivery still needs the scoped-key confirmation; current deployed checkout remains disabled.

`ADMIN_KEY_HASH` is an existing server secret containing SHA-256 of a random owner key. The raw key stays outside the repository. Rotate by privately generating a fresh key, setting its hash in Deno and redeploying; owner sessions expire within an hour.

Canonical `APP_URL=https://fidan-bahcem-web.yigitml.deno.net` was saved through the Deno dashboard and confirmed for the Production environment only. Preview deployments need their own exact canonical origin; do not give previews the production value.

## Database and privacy

Schema v1 remains compatible with prior password accounts, sessions and carts. Prefixes: `user`, `email`, `session`, `google-user`, `google-oauth`, `order`, `orders`, `order-request`, `operator-session`, `rate`, `schema`, `revenuecat`, `revenuecat-event`, `revenuecat-rate`. New authentication versions default to zero for older records. Billing snapshots are separated by sandbox/production environment.

Atomic checks enforce email/Google identity uniqueness, session-bound account mutations, order creation, receipt retries, owner status changes and billing sync. Server catalog prices and 89 TL delivery below 750 TL are authoritative. A same-ID retry returns the original receipt even after catalog price changes; altered client items or shipping conflict. Authenticated checkout freezes the expected account identity. Guest orders and request markers expire after 90 days; member orders persist until account deletion.

Passwords use salted scrypt; opaque session tokens are hashed in KV. Customer sessions last seven days. Password changes/recovery rotate recovery codes and invalidate older authentication versions. Recovery requires the private saved code, with no reset email or claim of verified password-signup email ownership. Google login requests only OpenID/email/profile, uses PKCE/state/browser binding/nonce and signed-token verification, and retains no provider access/refresh tokens. Email matches do not automatically link password accounts.

Mutation routes require exact canonical Origin, JSON objects, streamed byte limits and atomic rate limits. By default rate limits use a shared action bucket, because unsolicited proxy headers are untrusted. Set `TRUSTED_CLIENT_IP_HEADER` only when the ingress is documented to overwrite that header. API responses are private/no-store; framing and MIME sniffing are denied. No analytics cookies or card fields.

Cart quantities use localStorage. Ambiguous demo submissions retain immutable contact/address, cart, UUID and account identity in sessionStorage across navigation/reload. Automatic recovery lasts 24 hours; older attempts require explicit same-ID retry until 90 days, then informed discard/restart. Unavailable storage requires acknowledgment of a current-page-only retry mode. Confirmed/definitively rejected attempts clear. Pending RevenueCat verification also persists per account; clearing an attempt does not cancel/refund a provider purchase.

Exports include public account data, orders and both local billing environments. Account deletion tombstones the account first, blocks ordinary login/mutations and allows cleanup retry by the initiating session. It deletes local orders/indexes/billing/Google mapping and sessions. If that session expires or is lost during a persistent cleanup failure, an operator must finish the tombstoned user's cleanup before the email can be reused. Provider subscriptions/payment records are not automatically cancelled/deleted. The account UI instructs users to manage active subscriptions first.

There is no scheduled backup or tested restore drill. Do not treat managed KV as evidence of a verified backup procedure.

## Google onboarding

Provider onboarding uses Google Cloud project `psyched-loader-510323-e2`. The user created the dedicated Web OAuth client; root saved its server `GOOGLE_CLIENT_ID` and `GOOGLE_CLIENT_SECRET` in Deno's Production environment only. Canonical `APP_URL=https://fidan-bahcem-web.yigitml.deno.net` is also Production-only. The exact callback is:

```text
https://fidan-bahcem-web.yigitml.deno.net/api/auth/google/callback
```

Configure the consent screen and test-user/publishing settings in Google Cloud. Start `/api/auth/google`; `/api/auth/config` reports availability without exposing secrets. Validate a real login/new account, cancellation, explicit password-account linking, and Google-only deletion reauthentication. Use disposable identities. Signed-fixture tests verify implementation, not live provider onboarding.

## RevenueCat onboarding

The dedicated RevenueCat project already exists: `cd7cbe23`, display name `FidanBahcem`. Its Test Store now contains sandbox QA Offering `fidan_qa`, product `fidan_qa_monthly`, and entitlement `fidan_qa_test`. Root verified a real Test Store round trip in Zen against the compiled local app at `http://127.0.0.1:3001`: package loading, cancellation, simulated failure with safe pending recovery, successful purchase with server subscriber synchronization, reload and persistence at a 390-pixel mobile viewport. The public Test Store credential successfully authenticated the server's V1 subscriber read. No credentials are printed here; no Stripe connection or real-money payment was made. Test Store QA is separate from a genuine RevenueCat Billing payment gateway.

An independent provider read through the application billing module at 2026-10-01 10:21:37 UTC confirmed automatic Test Store period advancement and expiry. The QA subscription's latest period began at 10:10:24 UTC and expired at 10:15:24 UTC; fresh and cached server views correctly returned inactive access and no future renewal. The provider retained a null cancellation marker after expiry, so renewal metadata now additionally requires active validity. No refund, billing issue or management URL was present. Test Store renewal/expiry is verified; provider cancellation/refund/management, webhook delivery and real gateway lifecycles remain unverified. This check used only an existing synthetic customer, the public Test Store key and isolated in-memory KV; it changed no deployed configuration.

For isolated QA, keep `REVENUECAT_ENVIRONMENT=sandbox`, use the dedicated Test Store fixtures, and restrict test entitlement access to disposable QA UUIDs through [Sandbox Testing Access](https://www.revenuecat.com/docs/projects/sandbox-access). The installed Web SDK 1.67.1 exceeds the [Test Store](https://www.revenuecat.com/docs/test-and-launch/sandbox/test-store) minimum of 1.15.0. Test Store needs no Stripe connection and reports purchases as sandbox data. QA fixtures establish no promised service or production price.

For genuine production billing, use Web → RevenueCat Billing in the same project to create the actual web config. It can connect an existing Stripe account or create a claimable Stripe sandbox; an unclaimed sandbox cannot take real payments and has a claim deadline. Create only account products/Offering packages whose delivered service, price and renewal terms the owner has established. Keep these separate from demo physical plant orders. The current SDK flow does not pay for the nursery cart or connect payments to quantities, shipping, stock or fulfillment. Required settings:

- `NEXT_PUBLIC_REVENUECAT_WEB_API_KEY` — public SDK key for this app/environment.
- `REVENUECAT_SECRET_API_KEY` — server-side credential compatible with REST API V1 `GET https://api.revenuecat.com/v1/subscribers/{local-account-UUID}`. Its name is retained even though the public Test Store key is sufficient for the verified sandbox subscriber read; this app does not use it for restricted provider operations. Keep actual secret credentials server-only and never pass them to the SDK. Do not assume a scoped V2-only key works with this V1 endpoint. The [customer GET](https://www.revenuecat.com/docs/api-v1/customers) creates a provider customer if absent, so use disposable QA identities.
- `REVENUECAT_WEBHOOK_SECRET` — independently generated webhook authorization secret.
- `REVENUECAT_ENVIRONMENT=sandbox|production` — explicit environment.
- `REVENUECAT_ALLOWED_PRODUCT_IDS` — comma-separated exact provider product identifiers.

Server webhook/cache/sync operations require only the V1 subscriber-read credential, webhook authorization secret, explicit environment and allowlisted products. Omitting `NEXT_PUBLIC_REVENUECAT_WEB_API_KEY` keeps the original public checkout configuration fully disabled while the validated server receiver can verify sandbox events. Invalid SDK keys or offering IDs cannot enable checkout and do not disable valid server verification. The October 2 integrated rerun passes 94 tests and compiled runtime-key plus webhook-only authentication/retry checks.

Optional `REVENUECAT_OFFERING_ID`, `REVENUECAT_MANAGEMENT_HOSTS` (exact HTTPS hosts), and `REVENUECAT_WEBHOOK_SIGNING_SECRET`. No fallback products or entitlements are invented. Missing configuration disables purchasing honestly. The SDK uses the current local account UUID; prices/offers come from the provider. Client success does not grant access: the server must verify the matching product/period/environment against RevenueCat.

The public web key is read at request time with `Reflect.get` and served through authenticated `/api/billing/status`; its existing `NEXT_PUBLIC_REVENUECAT_WEB_API_KEY` name is retained. Direct public-key property reads, including reads through a `process.env` alias, were inlined by the installed Next.js 16.3.7 Webpack build. The compiled regression below checks the actual build/runtime behavior. A `test_` key is supported for Test Store sandbox QA; use `rcb_sb_` for a RevenueCat Billing sandbox and `rcb_` for real RevenueCat Billing production. SDK configuration must never receive a server secret.

Webhook URL `${APP_URL}/api/billing/webhook`, exact authorization `Bearer <REVENUECAT_WEBHOOK_SECRET>`. Leave optional `REVENUECAT_WEBHOOK_SIGNING_SECRET` unset until HMAC signing is explicitly enabled for the integration and a real signed delivery is verified. Current [RevenueCat webhook documentation](https://www.revenuecat.com/docs/integrations/webhooks#webhook-signature-verification-hmac) matches the application's format: `X-RevenueCat-Webhook-Signature: t=<seconds>,v1=<hex>`, HMAC-SHA256 over `<timestamp>.<exact raw JSON>`, within five minutes. Retries recompute the delivery signature and timestamp. The signing secret is separate from the authorization secret. Webhook deliveries are authenticated, size-limited, replay/order checked and refresh provider authority rather than trusting event entitlements. Aliases/transfers refresh known accounts atomically; unknown/deleting accounts are not recreated. Provider failure returns a retriable error without marking success.

Webhook configuration/delivery is not yet verified. A separate V2 credential with only `project_configuration:integrations:read_write` is staged at its mandatory creation confirmation in Zen, not created. The [V2 webhook creation endpoint](https://www.revenuecat.com/docs/api-v2/integration) accepts name, URL, authorization header, sandbox scope and app/event filters. Its response example includes `signing_secret`; that does not independently confirm HMAC signing is enabled. Do not save that V2 credential as the app's V1 subscriber-read credential.

Before production purchasing, verify a real sandbox checkout, successful/delayed webhook delivery, cancellation, refund/expiration, alias/transfer behavior, session changes and management links. Move dedicated keys/product settings to production only after that succeeds. Mock SDK/provider suites do not substitute for this step.

## Verification and deployment

```sh
npm run lint
npm run typecheck
npm test
npm audit --omit=dev
npm run build
APP_URL=http://127.0.0.1:3000 FIDAN_KV_PATH=/tmp/fidan-check.sqlite npm run start:local
```

In another terminal, run `npm run test:acceptance -- http://127.0.0.1:3000`. Use only synthetic data. Optional `ADMIN_TEST_KEY` activates owner tests without logging the key. GitHub Actions runs the same isolated suites and fails if the KV-backed health check never becomes ready. The local runner refuses Deno Deploy and always opens an explicit local file.

### Compiled runtime configuration regression

Run this separate local check from the repository root. It builds with one synthetic public SDK key, starts the compiled standalone app with a different synthetic key and complete fake billing configuration, then verifies the runtime key and secret exclusion. The dedicated port is `3411`; KV and logs use a newly created temporary directory. The script calls only local registration, billing status and deletion routes, and deletes its disposable account. It does not call RevenueCat, initialize SDK checkout or charge a payment.

```sh
(
  set -eu
  runtime_config_directory=$(mktemp -d /tmp/fidan-runtime-config.XXXXXX)
  runtime_config_server_pid=''
  cleanup_runtime_config() {
    if [ -n "$runtime_config_server_pid" ]; then
      kill "$runtime_config_server_pid" 2>/dev/null || true
      wait "$runtime_config_server_pid" 2>/dev/null || true
    fi
    rm -rf "$runtime_config_directory"
  }
  trap cleanup_runtime_config EXIT

  if curl -sS --max-time 2 http://127.0.0.1:3411 > /dev/null 2>&1; then
    printf '%s\n' 'Port 3411 is already serving HTTP; use an unused dedicated port for this check.'
    exit 1
  fi

  NEXT_PUBLIC_REVENUECAT_WEB_API_KEY=rcb_sb_documented_build_fixture npm run build

  export APP_URL=http://127.0.0.1:3411
  export HOSTNAME=127.0.0.1
  export PORT=3411
  export FIDAN_KV_PATH="$runtime_config_directory/store.sqlite"
  export NEXT_PUBLIC_REVENUECAT_WEB_API_KEY=rcb_sb_documented_runtime_fixture
  export REVENUECAT_SECRET_API_KEY=synthetic-documentation-server-key
  export REVENUECAT_WEBHOOK_SECRET=synthetic-documentation-webhook-key
  export REVENUECAT_ENVIRONMENT=sandbox
  export REVENUECAT_ALLOWED_PRODUCT_IDS=documented_runtime_fixture
  export REVENUECAT_OFFERING_ID=''
  export REVENUECAT_WEBHOOK_SIGNING_SECRET=''
  export REVENUECAT_MANAGEMENT_HOSTS=''
  npm run start:local > "$runtime_config_directory/server.log" 2>&1 &
  runtime_config_server_pid=$!

  runtime_config_ready=false
  for runtime_config_attempt in $(seq 1 30); do
    if curl -fsS "$APP_URL/api/store/health" > /dev/null; then
      runtime_config_ready=true
      break
    fi
    sleep 1
  done
  if [ "$runtime_config_ready" != true ]; then
    cat "$runtime_config_directory/server.log"
    exit 1
  fi
  npm run test:runtime-config -- "$APP_URL"
)
```

Expected result: `PASS: compiled billing configuration uses the runtime public key and excludes server secrets.` The subshell restores the caller's environment and removes its temporary KV/logs after stopping the local process. CI performs the same distinct-key regression before acceptance. Its fixture product identifier is not a product sold by the application. Build a normal artifact again with `npm run build` before ordinary development or deployment; compiled configuration checks and mock suites do not demonstrate a live provider integration.

Publish using authenticated owner CLI:

```sh
deno deploy --prod --json --non-interactive --org yigitml --app fidan-bahcem-web
node scripts/acceptance.mjs https://fidan-bahcem-web.yigitml.deno.net /absolute/path/to/private-owner-access.txt
```

The second acceptance argument is optional. Tests create and delete disposable member records. `/api/store/health` performs a real KV read and returns 503 when unavailable. Verify browser pages, account/cart/order flows and provider availability after routing; a routed deployment alone is insufficient. Roll back by redeploying a known-good compatible revision. No long-lived production token is stored in GitHub.

Current run results and provider access blockers live in [implementation status](implementation-handoff.md). Shipping-provider callbacks, email/SMS delivery, live inventory, custom domains and external uptime paging remain outside this implementation. The owner must confirm real inventory/pricing/fulfillment and customer policies before genuine plant commerce.
