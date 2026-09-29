"use client";
import Image from "next/image";
import Link from "next/link";
import { Check, Plus } from "lucide-react";
import { useState } from "react";
import { addCart } from "@/lib/cart-store";
import { formatPrice, type Product } from "@/lib/products";

export function ProductCard({ product }: { product: Product }) {
  const [added, setAdded] = useState(false);
  function add() { addCart(product.id); setAdded(true); window.setTimeout(() => setAdded(false), 1300); }
  return <article className="product-card group"><div className="relative aspect-[4/3] overflow-hidden bg-[#dfe6dc]"><Image src={product.image} alt={`${product.name} için temsili bitki fotoğrafı`} fill className="object-cover transition duration-500 group-hover:scale-[1.035]" sizes="(max-width: 768px) 100vw, 33vw" /><span className="absolute left-4 top-4 rounded-full bg-[var(--paper)] px-3 py-1.5 text-xs font-semibold shadow-sm">{product.group}</span></div><div className="flex flex-1 flex-col p-5"><div className="mb-4 flex items-start justify-between gap-3"><div><h3 className="font-serif text-2xl font-semibold tracking-[-0.03em]">{product.name}</h3><p className="mt-1 text-sm italic text-[var(--muted)]">{product.latin}</p></div><p className="whitespace-nowrap text-lg font-semibold">{formatPrice(product.price)}</p></div><p className="mb-5 flex-1 text-[15px] leading-6 text-[var(--muted)]">{product.note}</p><div className="mb-5 border-y border-[var(--line)] py-3 text-xs"><span>Fidan boyu: {product.size}</span></div><div className="grid grid-cols-[1fr_auto] gap-2"><Link href={`/fidanlar#${product.id}`} className="secondary-button">Detay</Link><button onClick={add} className="primary-button px-4" aria-label={`${product.name} sepete ekle`}>{added ? <Check size={18} /> : <Plus size={18} />}<span className="hidden sm:inline">{added ? "Eklendi" : "Sepete ekle"}</span></button></div></div></article>;
}
