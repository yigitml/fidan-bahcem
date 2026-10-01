import { products } from "@/lib/products";

export type CartLine = { id: string; quantity: number };
export const CART_KEY = "fidan-bahcem-cart";
export const MAX_CART_QUANTITY = 99;

export function normalizeCart(value: unknown): CartLine[] {
  if (!Array.isArray(value)) return [];
  const quantities = new Map<string, number>();
  for (const line of value) {
    if (!line || typeof line !== "object" || typeof line.id !== "string" || !products.some((product) => product.id === line.id) || !Number.isInteger(line.quantity) || line.quantity < 1) continue;
    quantities.set(line.id, Math.min(MAX_CART_QUANTITY, (quantities.get(line.id) || 0) + line.quantity));
  }
  return [...quantities].map(([id, quantity]) => ({ id, quantity }));
}

export function subtractCartItems(current: unknown, purchased: unknown): CartLine[] {
  const quantities = new Map(normalizeCart(purchased).map((line) => [line.id, line.quantity]));
  return normalizeCart(current).flatMap((line) => {
    const quantity = line.quantity - (quantities.get(line.id) || 0);
    return quantity > 0 ? [{ ...line, quantity }] : [];
  });
}
