# Fidan Bahçem

Fidan Bahçem is a Turkish storefront for browsing nursery plants and completing a guest checkout. The payment experience is intentionally a simulation: card details are validated only in the browser, are never transmitted or stored, and no charge is created.

## Local development

```bash
npm ci
npm run dev
```

Open `http://localhost:3000`.

## Verification

```bash
npm run typecheck
npm run build
```

## Production

The project follows the same Deno Deploy setup as `chatlyzer-web`. Deployment settings live in `deno.json`; production publishes from the `main` branch checkout with:

```bash
deno deploy --prod
```

The storefront does not require a database or runtime secrets.
