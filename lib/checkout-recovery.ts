import { MAX_CART_QUANTITY, type CartLine } from "@/lib/cart";
import { products } from "@/lib/products";

export const CHECKOUT_RECOVERY_KEY = "fidan-bahcem-pending-order";
export const AUTO_RECOVERY_TTL = 24 * 60 * 60 * 1000;
export const MAX_RECOVERY_TTL = 90 * 24 * 60 * 60 * 1000;
export type OrderSubmission = {
  requestId: string;
  checkoutUserId: string | null;
  items: CartLine[];
  name: string;
  email: string;
  phone: string;
  address: string;
  city: string;
  district: string;
  demoConsent: true;
};
export type SavedOrderSubmission = { version: 1; savedAt: number; submission: OrderSubmission };
export type CheckoutRecovery = { kind: "none" }
  | { kind: "valid" | "older"; attempt: SavedOrderSubmission }
  | { kind: "invalid" | "expired" };

const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const boundedText = (value: unknown, minimum: number, maximum: number): value is string =>
  typeof value === "string" && value.trim().length >= minimum && value.length <= maximum;

export function isOrderSubmission(value: unknown): value is OrderSubmission {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false;
  const data = value as Record<string, unknown>;
  if (typeof data.requestId !== "string" || !uuid.test(data.requestId)
    || !(data.checkoutUserId === null || typeof data.checkoutUserId === "string" && uuid.test(data.checkoutUserId))
    || data.demoConsent !== true || !boundedText(data.name, 2, 100)
    || !boundedText(data.email, 3, 254) || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(data.email.trim())
    || !boundedText(data.phone, 9, 30) || !/^\+?[\d\s()-]{9,30}$/.test(data.phone.trim())
    || data.phone.replace(/\D/g, "").length < 9 || data.phone.replace(/\D/g, "").length > 15
    || !boundedText(data.address, 10, 500) || !boundedText(data.city, 2, 100) || !boundedText(data.district, 2, 100)
    || !Array.isArray(data.items) || !data.items.length || data.items.length > products.length) return false;
  const seen = new Set<string>();
  return data.items.every((value) => {
    if (!value || typeof value !== "object" || Array.isArray(value)) return false;
    const line = value as Record<string, unknown>;
    if (typeof line.id !== "string" || seen.has(line.id) || !products.some((product) => product.id === line.id)
      || typeof line.quantity !== "number" || !Number.isInteger(line.quantity) || line.quantity < 1 || line.quantity > MAX_CART_QUANTITY) return false;
    seen.add(line.id);
    return true;
  });
}

export function parseCheckoutRecovery(raw: string | null, now = Date.now()): CheckoutRecovery {
  if (raw === null) return { kind: "none" };
  if (raw.length > 16_384) return { kind: "invalid" };
  let value: unknown;
  try { value = JSON.parse(raw); } catch { return { kind: "invalid" }; }
  if (!value || typeof value !== "object" || Array.isArray(value)) return { kind: "invalid" };
  const data = value as Record<string, unknown>;
  if (data.version !== 1 || typeof data.savedAt !== "number" || !Number.isSafeInteger(data.savedAt)
    || data.savedAt < 0 || data.savedAt > now + 60_000 || !isOrderSubmission(data.submission)) return { kind: "invalid" };
  const age = now - data.savedAt;
  if (age >= MAX_RECOVERY_TTL) return { kind: "expired" };
  const attempt = { version: 1 as const, savedAt: data.savedAt, submission: data.submission };
  return { kind: age >= AUTO_RECOVERY_TTL ? "older" : "valid", attempt };
}
