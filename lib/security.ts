import { randomBytes, scryptSync, timingSafeEqual, createHash } from 'node:crypto';
export const token = () => randomBytes(32).toString('hex');
export const digest = (value: string) => createHash('sha256').update(value).digest('hex');
export function hashPassword(password: string) {
  const salt = randomBytes(16).toString('hex');
  return `${salt}:${scryptSync(password, salt, 64).toString('hex')}`;
}
// Unknown and Google-only accounts still perform one password derivation per login attempt.
export const dummyPasswordHash = hashPassword('unusable-account-password');
export function verifyPassword(password: string, hash: string) {
  if (!/^[a-f0-9]{32}:[a-f0-9]{128}$/.test(hash)) return false;
  const [salt, expected] = hash.split(':');
  const actual = scryptSync(password, salt, 64);
  const stored = Buffer.from(expected, 'hex');
  return stored.length === actual.length && timingSafeEqual(stored, actual);
}
export function password(value: unknown): string {
  if (typeof value !== 'string' || !value.trim() || value.length > 128) throw new Error('Lütfen şifrenizi kontrol edin.');
  return value;
}
export function text(value: unknown, maximum = 300): string {
  if (typeof value !== 'string' || !value.trim() || value.length > maximum) throw new Error('Lütfen bilgilerinizi kontrol edin.');
  return value.trim();
}
export function email(value: unknown) {
  const result = text(value, 254).toLowerCase();
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(result)) throw new Error('Geçerli e-posta girin.');
  return result;
}
