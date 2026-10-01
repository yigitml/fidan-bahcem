"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { Menu, ShoppingBag, Sprout, X } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { useCartStore } from "@/lib/cart-store";

const links = [
  { href: "/", label: "Ana sayfa" },
  { href: "/fidanlar", label: "Fidanlar" },
  { href: "/hesabim", label: "Hesabım" },
  { href: "/odeme", label: "Sepet ve sipariş" },
  { href: "/gizlilik", label: "Gizlilik" },
];

export function SiteHeader() {
  const { lines, ready } = useCartStore();
  const pathname = usePathname();
  const count = lines.reduce((sum, item) => sum + item.quantity, 0);
  const [open, setOpen] = useState(false);
  const dialogRef = useRef<HTMLDialogElement>(null);
  const triggerRef = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    if (!open) return;
    const dialog = dialogRef.current;
    if (!dialog) return;
    const trigger = triggerRef.current;
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    if (!dialog.open) dialog.showModal();
    const media = window.matchMedia("(min-width: 768px)");
    const closeOnDesktop = () => { if (media.matches) setOpen(false); };
    media.addEventListener("change", closeOnDesktop);
    return () => {
      media.removeEventListener("change", closeOnDesktop);
      if (dialog.open) dialog.close();
      document.body.style.overflow = previousOverflow;
      if (trigger?.isConnected) trigger.focus();
    };
  }, [open]);

  return (
    <header className="sticky top-0 z-50 border-b border-[var(--line)] bg-[color:var(--paper)]/95 backdrop-blur-md">
      <a href="#main-content" className="skip-link">İçeriğe geç</a>
      <div className="mx-auto flex h-[76px] max-w-[1440px] items-center justify-between gap-3 px-5 md:px-10">
        <Link href="/" className="flex shrink-0 items-center gap-2 sm:gap-3" aria-label="Fidan Bahçem ana sayfa">
          <span className="grid size-9 place-items-center rounded-full bg-[var(--ink)] text-[var(--paper)] sm:size-10"><Sprout size={21} aria-hidden="true" /></span>
          <span className="font-serif text-base font-semibold tracking-[-0.03em] sm:text-[1.35rem]">Fidan Bahçem</span>
        </Link>
        <nav className="hidden items-center gap-8 text-[15px] font-medium md:flex" aria-label="Ana menü">
          {links.filter((link) => ["/", "/fidanlar", "/gizlilik"].includes(link.href)).map((link) => (
            <Link key={link.href} href={link.href} className="nav-link" aria-current={pathname === link.href ? "page" : undefined}>{link.label}</Link>
          ))}
        </nav>
        <div className="flex shrink-0 items-center gap-2">
          <Link href="/hesabim" className="hidden min-h-11 items-center px-1 text-sm underline underline-offset-4 sm:flex" aria-current={pathname === "/hesabim" ? "page" : undefined}>Hesabım</Link>
          <Link href="/odeme" className="cart-button" aria-label={ready ? `Sepet, ${count} fidan` : "Sepet"} aria-current={pathname === "/odeme" ? "page" : undefined}>
            <ShoppingBag size={18} aria-hidden="true" /><span className="hidden sm:inline">Sepet</span><span className="cart-count" aria-hidden="true">{ready ? count : "–"}</span>
          </Link>
          <button ref={triggerRef} type="button" className="icon-button md:hidden" onClick={() => setOpen(true)} aria-label="Menüyü aç" aria-expanded={open} aria-controls="mobile-menu"><Menu size={21} aria-hidden="true" /></button>
        </div>
      </div>
      <dialog ref={dialogRef} id="mobile-menu" className="mobile-menu" aria-labelledby="mobile-menu-title" onCancel={(event) => { event.preventDefault(); setOpen(false); }} onClick={(event) => { if (event.target === event.currentTarget) setOpen(false); }}>
        <div className="flex items-center justify-between gap-4 border-b border-[var(--line)] pb-5">
          <h2 id="mobile-menu-title" className="font-serif text-2xl">Fidan Bahçem</h2>
          <button type="button" className="icon-button" onClick={() => setOpen(false)} aria-label="Menüyü kapat"><X size={21} aria-hidden="true" /></button>
        </div>
        <nav aria-label="Mobil ana menü" className="grid py-4">
          {links.map((link) => <Link key={link.href} href={link.href} className="mobile-nav-link" aria-current={pathname === link.href ? "page" : undefined} onClick={() => setOpen(false)}>{link.label}</Link>)}
        </nav>
        <p className="border-t border-[var(--line)] pt-5 text-sm leading-6 text-[var(--muted)]">Fidanları keşfedin, bakım bilgilerini karşılaştırın ve demo siparişinizi tamamlayın.</p>
      </dialog>
    </header>
  );
}
