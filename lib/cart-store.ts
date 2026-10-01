"use client";

import { useEffect, useSyncExternalStore } from "react";
import { CART_KEY, MAX_CART_QUANTITY, normalizeCart, subtractCartItems, type CartLine } from "@/lib/cart";
import { products } from "@/lib/products";

type CartSnapshot = { lines: CartLine[]; ready: boolean };
const serverSnapshot: CartSnapshot = { lines: [], ready: false };
let snapshot = serverSnapshot;
const listeners = new Set<() => void>();
const emit = () => listeners.forEach((listener) => listener());

function parse(value: string | null) {
  try { return normalizeCart(JSON.parse(value || "[]")); } catch { return []; }
}

function onStorage(event: StorageEvent) {
  if (event.key !== CART_KEY && event.key !== null) return;
  snapshot = { lines: parse(event.key === null ? null : event.newValue), ready: true };
  emit();
}

function subscribe(listener: () => void) {
  if (!listeners.size) window.addEventListener("storage", onStorage);
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
    if (!listeners.size) window.removeEventListener("storage", onStorage);
  };
}

function init() {
  if (snapshot.ready) return;
  let lines: CartLine[] = [];
  try { lines = parse(window.localStorage.getItem(CART_KEY)); } catch { /* Use memory when browser storage is unavailable. */ }
  snapshot = { lines, ready: true };
  emit();
}

export function replaceCart(next: CartLine[]) {
  const lines = normalizeCart(next);
  snapshot = { lines, ready: true };
  try { window.localStorage.setItem(CART_KEY, JSON.stringify(lines)); } catch { /* The cart remains usable in memory. */ }
  emit();
}

export function addCart(id: string) {
  init();
  if (!products.some((product) => product.id === id)) return false;
  const existing = snapshot.lines.find((line) => line.id === id);
  if (existing && existing.quantity >= MAX_CART_QUANTITY) return false;
  replaceCart(existing ? snapshot.lines.map((line) => line.id === id ? { ...line, quantity: line.quantity + 1 } : line) : [...snapshot.lines, { id, quantity: 1 }]);
  return true;
}

export function removePurchasedItems(items: CartLine[]) {
  init();
  replaceCart(subtractCartItems(snapshot.lines, items));
}

export function useCartStore() {
  const current = useSyncExternalStore(subscribe, () => snapshot, () => serverSnapshot);
  useEffect(init, []);
  return current;
}
