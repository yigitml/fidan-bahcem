if (typeof globalThis.Deno?.openKv !== 'function') {
  throw new Error('Deployment requires the Deno runtime with managed KV support.');
}
if (Deno.env.get('DENO_DEPLOY') !== 'true') {
  throw new Error('This runner is for Deno Deploy. Use npm run start:local for local development.');
}

process.env.HOSTNAME = '0.0.0.0';
process.env.PORT ||= '8000';
await import(new URL('../.next/standalone/server.js', import.meta.url).href);
