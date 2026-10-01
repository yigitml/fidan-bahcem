import { mkdir } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';

if (!globalThis.Deno?.openKv) throw new Error('Use deno run --allow-all --unstable-kv scripts/start-local.mjs');
if (Deno.env.get('DENO_DEPLOY') === 'true') throw new Error('Local database runner cannot run on Deno Deploy.');
const localPath = resolve(process.env.FIDAN_KV_PATH || '.local-data/store.sqlite');
await mkdir(dirname(localPath), { recursive: true });
const localKv = await Deno.openKv(localPath);
// The override exists only in this local runner, never in the deployed application.
Object.defineProperty(Deno, 'openKv', { value: () => Promise.resolve(localKv), configurable: true });
process.env.HOSTNAME ||= '127.0.0.1';
process.env.PORT ||= '3000';
await import(pathToFileURL(resolve('.next/standalone/server.js')).href);
