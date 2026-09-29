type Key = (string | number)[];
export type Entry<T> = { key: Key; value: T | null; versionstamp: string | null };
export interface KV {
  get<T>(key: Key): Promise<Entry<T>>;
  set(key: Key, value: unknown, options?: { expireIn: number }): Promise<unknown>;
  delete(key: Key): Promise<void>;
  list<T>(selector: { prefix: Key }): AsyncIterable<Entry<T>>;
  atomic(): { check(entry: Entry<unknown>): ReturnType<KV['atomic']>; set(key: Key, value: unknown, options?: { expireIn: number }): ReturnType<KV['atomic']>; delete(key: Key): ReturnType<KV['atomic']>; commit(): Promise<{ ok: boolean }> };
}
let connection: Promise<KV> | undefined;
export function database(): Promise<KV> {
  const runtime = (globalThis as unknown as { Deno?: { openKv(): Promise<KV> } }).Deno;
  if (!runtime) throw new Error('Managed database requires Deno runtime');
  return connection ??= runtime.openKv();
}
