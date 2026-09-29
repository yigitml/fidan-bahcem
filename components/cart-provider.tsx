"use client";
import { createContext, useContext, useEffect, useState } from "react";
import type { CartLine } from "@/lib/cart";

type CartContextValue = {
  lines: CartLine[];
  ready: boolean;
  add: (id: string) => void;
  replace: (lines: CartLine[]) => void;
};

const CartContext = createContext<CartContextValue | null>(null);

export function CartProvider({ children }: { children: React.ReactNode }) {
  const [lines, setLines] = useState<CartLine[]>([]);
  const [ready, setReady] = useState(false);
  useEffect(() => {
    try { setLines(JSON.parse(window.localStorage?.getItem("fidan-bahcem-cart") || "[]")); } catch { /* storage may be unavailable */ }
    setReady(true);
  }, []);
  function replace(next: CartLine[]) {
    setLines(next);
    try { window.localStorage?.setItem("fidan-bahcem-cart", JSON.stringify(next)); } catch { /* in-memory cart still works */ }
  }
  function add(id: string) {
    const existing = lines.find((line) => line.id === id);
    replace(existing ? lines.map((line) => line.id === id ? { ...line, quantity: line.quantity + 1 } : line) : [...lines, { id, quantity: 1 }]);
  }
  return <CartContext.Provider value={{ lines, ready, add, replace }}>{children}</CartContext.Provider>;
}

export function useCart() {
  const value = useContext(CartContext);
  if (!value) throw new Error("useCart must be used inside CartProvider");
  return value;
}
