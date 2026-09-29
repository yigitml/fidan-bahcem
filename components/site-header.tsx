"use client";
import Link from "next/link";
import { Menu, ShoppingBag, Sprout } from "lucide-react";
import { useState } from "react";
import { useCartStore } from "@/lib/cart-store";

export function SiteHeader() {
  const { lines } = useCartStore();
  const count = lines.reduce((sum, item) => sum + item.quantity, 0);
  const [open, setOpen] = useState(false);
  return (
    <header className="sticky top-0 z-50 border-b border-[var(--line)] bg-[color:var(--paper)]/95 backdrop-blur-md">
      <div className="mx-auto flex h-[76px] max-w-[1440px] items-center justify-between px-5 md:px-10">
        <Link href="/" className="flex items-center gap-3" aria-label="Fidan Bahçem ana sayfa">
          <span className="grid size-10 place-items-center rounded-full bg-[var(--ink)] text-[var(--paper)]"><Sprout size={21} /></span>
          <span className="font-serif text-[1.35rem] font-semibold tracking-[-0.03em]">Fidan Bahçem</span>
        </Link>
        <nav className="hidden items-center gap-8 text-[15px] font-medium md:flex" aria-label="Ana menü">
          <Link href="/" className="nav-link">Ana sayfa</Link><Link href="/fidanlar" className="nav-link">Fidanlar</Link><Link href="/odeme" className="nav-link">Teslimat & ödeme</Link>
        </nav>
        <div className="flex items-center gap-2">
          <Link href="/odeme" className="cart-button" aria-label={`Sepet, ${count} ürün`}><ShoppingBag size={18} /><span className="hidden sm:inline">Sepet</span><span className="cart-count">{count}</span></Link>
          <button className="icon-button md:hidden" onClick={() => setOpen(!open)} aria-label="Menüyü aç" aria-expanded={open}><Menu size={21} /></button>
        </div>
      </div>
      {open && <nav className="grid border-t border-[var(--line)] bg-[var(--paper)] px-5 py-4 text-base md:hidden"><Link href="/" className="py-3" onClick={() => setOpen(false)}>Ana sayfa</Link><Link href="/fidanlar" className="py-3" onClick={() => setOpen(false)}>Fidanlar</Link><Link href="/odeme" className="py-3" onClick={() => setOpen(false)}>Teslimat & ödeme</Link></nav>}
    </header>
  );
}
