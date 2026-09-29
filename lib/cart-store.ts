"use client";
import { useEffect, useSyncExternalStore } from "react";
import type { CartLine } from "@/lib/cart";

let lines: CartLine[] = [];
const serverLines: CartLine[] = [];
let ready = false;
const listeners = new Set<() => void>();
const emit = () => listeners.forEach((listener) => listener());
const subscribe = (listener: () => void) => { listeners.add(listener); return () => listeners.delete(listener); };

function init() {
  if (ready) return;
  try { lines = JSON.parse(window.localStorage?.getItem("fidan-bahcem-cart") || "[]"); } catch { /* in-memory fallback */ }
  ready = true;
  emit();
}

export function replaceCart(next: CartLine[]) {
  lines = next;
  try { window.localStorage?.setItem("fidan-bahcem-cart", JSON.stringify(next)); } catch { /* in-memory fallback */ }
  emit();
}

export function addCart(id: string) {
  const existing = lines.find((line) => line.id === id);
  replaceCart(existing ? lines.map((line) => line.id === id ? { ...line, quantity: line.quantity + 1 } : line) : [...lines, { id, quantity: 1 }]);
}

export function useCartStore() {
  const current = useSyncExternalStore(subscribe, () => lines, () => serverLines);
  useEffect(init, []);
  return { lines: current, ready };
}
