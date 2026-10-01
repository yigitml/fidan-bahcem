"use client";

import Image from "next/image";
import { Check, Droplets, Plus, Sun } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { addCart } from "@/lib/cart-store";
import { formatPrice, type Product } from "@/lib/products";

export function ProductCard({ product }: { product: Product }) {
  const [added, setAdded] = useState(false);
  const [message, setMessage] = useState("");
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  useEffect(() => () => { if (timer.current) clearTimeout(timer.current); }, []);

  function add() {
    if (timer.current) clearTimeout(timer.current);
    const success = addCart(product.id);
    setAdded(success);
    setMessage(success ? `${product.name} sepete eklendi.` : `${product.name} için en fazla 99 adet ekleyebilirsiniz.`);
    timer.current = setTimeout(() => setAdded(false), 1500);
  }

  return (
    <article className="product-card group" aria-labelledby={`product-${product.id}`}>
      <div className="relative aspect-[4/3] overflow-hidden bg-[#dfe6dc]">
        <Image src={product.image} alt={`${product.name} için temsili bitki fotoğrafı`} fill className="object-cover transition duration-500 group-hover:scale-[1.035]" sizes="(max-width: 767px) 100vw, (max-width: 1279px) 50vw, 33vw" />
        <span className="absolute left-4 top-4 rounded-full bg-[var(--paper)] px-3 py-1.5 text-xs font-semibold shadow-sm">{product.group}</span>
        <span className="absolute bottom-3 right-3 rounded-full bg-white/90 px-2.5 py-1 text-[10px] text-[var(--muted)]">Temsili görsel</span>
      </div>
      <div className="flex flex-1 flex-col p-5">
        <div className="mb-4 flex items-start justify-between gap-3">
          <div className="min-w-0"><h3 id={`product-${product.id}`} className="font-serif text-2xl font-semibold tracking-[-0.03em]">{product.name}</h3><p className="mt-1 text-sm italic text-[var(--muted)]">{product.latin}</p></div>
          <p className="whitespace-nowrap text-lg font-semibold">{formatPrice(product.price)}<span className="block text-right text-xs font-normal text-[var(--muted)]">/ adet</span></p>
        </div>
        <p className="mb-4 flex-1 text-[15px] leading-6 text-[var(--muted)]">{product.note}</p>
        <p className="border-t border-[var(--line)] pt-3 text-xs">Fidan boyu: <strong>{product.size}</strong></p>
        <details className="product-details mb-5 mt-3">
          <summary>Bakım bilgileri<span className="sr-only">: {product.name}</span></summary>
          <dl className="grid gap-3 pt-3 text-xs leading-5">
            <div className="flex gap-2"><Sun size={16} aria-hidden="true" /><div><dt className="font-semibold">Işık</dt><dd className="text-[var(--muted)]">{product.light}</dd></div></div>
            <div className="flex gap-2"><Droplets size={16} aria-hidden="true" /><div><dt className="font-semibold">Sulama</dt><dd className="text-[var(--muted)]">{product.water}</dd></div></div>
          </dl>
        </details>
        <button type="button" onClick={add} className="primary-button w-full" aria-label={`${product.name} sepete ekle`}>{added ? <Check size={18} aria-hidden="true" /> : <Plus size={18} aria-hidden="true" />}{added ? "Sepete eklendi" : "Sepete ekle"}</button>
        <p role="status" className="sr-only">{message}</p>
        {message && !added && message.includes("99") && <p className="mt-3 text-xs text-[var(--muted)]">{message}</p>}
      </div>
    </article>
  );
}
