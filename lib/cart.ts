export type CartLine = { id: string; quantity: number };
const CART_KEY = "fidan-bahcem-cart";

export function getCart(): CartLine[] {
  if (typeof window === "undefined") return [];
  try { return JSON.parse(window.localStorage.getItem(CART_KEY) || "[]"); } catch { return []; }
}

export function setCart(lines: CartLine[]) {
  window.localStorage.setItem(CART_KEY, JSON.stringify(lines));
  window.dispatchEvent(new Event("fidan-cart-change"));
}

export function addToCart(id: string) {
  const lines = getCart();
  const existing = lines.find((line) => line.id === id);
  if (existing) existing.quantity += 1;
  else lines.push({ id, quantity: 1 });
  setCart(lines);
}
