"use client";
import { useMemo, useState } from "react";
import { Search, SlidersHorizontal } from "lucide-react";
import { ProductCard } from "@/components/product-card";
import { SiteFooter } from "@/components/site-footer";
import { SiteHeader } from "@/components/site-header";
import { products } from "@/lib/products";
const filters = ["Tümü", "Meyve", "İbreli", "Çit", "Yaprak döken"];
export default function ProductsPage() {
  const [filter, setFilter] = useState("Tümü"); const [query, setQuery] = useState("");
  const visible = useMemo(() => products.filter((p) => (filter === "Tümü" || p.group === filter) && `${p.name} ${p.latin}`.toLocaleLowerCase("tr").includes(query.toLocaleLowerCase("tr"))), [filter, query]);
  return <><SiteHeader /><main className="mx-auto max-w-[1440px] px-5 py-12 md:px-10 md:py-16"><div className="mb-10 grid gap-6 md:grid-cols-[1fr_auto] md:items-end"><div><p className="eyebrow">Fidan kataloğu</p><h1 className="page-title">Bahçenize uygun olanı bulun.</h1><p className="mt-4 max-w-2xl text-[var(--muted)]">Temsili görsellerle listelenen ürünlerin boyu, ışık ve sulama ihtiyacı kartlarda açıkça belirtilir.</p></div><div className="relative"><Search className="absolute left-4 top-1/2 -translate-y-1/2 text-[var(--muted)]" size={18} /><input value={query} onChange={(e) => setQuery(e.target.value)} className="search-input" placeholder="Fidan ara" aria-label="Fidan ara" /></div></div><div className="mb-9 flex flex-wrap items-center gap-2"><SlidersHorizontal size={18} className="mr-1" />{filters.map((item) => <button key={item} onClick={() => setFilter(item)} className={`filter-pill ${filter === item ? "active" : ""}`}>{item}</button>)}</div><p className="mb-5 text-sm text-[var(--muted)]">{visible.length} sonuç</p><div className="grid gap-5 md:grid-cols-2 xl:grid-cols-3">{visible.map((p) => <div id={p.id} key={p.id} className="scroll-mt-28"><ProductCard product={p} /><div className="detail-strip"><span>Işık: {p.light}</span><span>Sulama: {p.water}</span></div></div>)}</div>{visible.length === 0 && <div className="rounded-3xl border border-dashed border-[var(--line)] py-20 text-center"><p className="font-serif text-2xl">Bu aramayla eşleşen fidan yok.</p><button onClick={() => { setFilter("Tümü"); setQuery(""); }} className="mt-4 underline">Filtreleri temizle</button></div>}</main><SiteFooter /></>;
}
