# Fidan Bahçem

Fidan Bahçem is a Turkish storefront for browsing nursery plants and completing a guest checkout. The payment experience is intentionally a simulation: card details are validated only in the browser, are never transmitted or stored, and no charge is created.

## Local development

```bash
npm ci
npm run dev
```

Open `http://localhost:3000` for the UI preview. The complete API needs Deno KV: build first, copy `public` and `.next/static` into `.next/standalone`, then run:

```bash
HOSTNAME=127.0.0.1 PORT=3000 deno eval --unstable-kv "await import('./.next/standalone/server.js')"
```

## Verification

```bash
npm run typecheck
npm run lint
npm audit --omit=dev
npm run build
npm run test:acceptance -- http://127.0.0.1:3000
```

## Production

The project follows the same Deno Deploy setup as `chatlyzer-web`. Deployment settings live in `deno.json`; production publishes from the `main` branch checkout with:

```bash
deno deploy --prod
```

Live: https://fidan-bahcem-web.yigitml.deno.net

Managed Deno KV provides accounts and saved orders. Password login, recovery codes, customer order history, profile editing, personal-data export/deletion, and a protected owner dashboard are implemented. `ADMIN_KEY_HASH` is configured as a Deno secret; the raw owner key is delivered privately, never committed.

GitHub Actions validates lint, types, dependency audit, build, and acceptance tests with an isolated local database. See [production operations](docs/production.md) for deployment, security, schema, validation, and separate onboarding.
