"use client";

import { useMemo, useRef, useState } from "react";
import { Search, SlidersHorizontal, X } from "lucide-react";
import { ProductCard } from "@/components/product-card";
import { SiteFooter } from "@/components/site-footer";
import { SiteHeader } from "@/components/site-header";
import { products } from "@/lib/products";

const filters = ["Tümü", "Meyve", "İbreli", "Çit", "Yaprak döken"];
const searchText = (value: string) => value.toLocaleLowerCase("tr").normalize("NFD").replace(/[\u0300-\u036f]/g, "").replace(/ı/g, "i");

export default function ProductsPage() {
  const [filter, setFilter] = useState("Tümü");
  const [query, setQuery] = useState("");
  const [sort, setSort] = useState("catalog");
  const searchRef = useRef<HTMLInputElement>(null);
  const visible = useMemo(() => {
    const term = searchText(query.trim());
    const matches = products.filter((product) => (filter === "Tümü" || product.group === filter) && searchText(`${product.name} ${product.latin} ${product.group}`).includes(term));
    if (sort === "price-asc") matches.sort((a, b) => a.price - b.price);
    if (sort === "price-desc") matches.sort((a, b) => b.price - a.price);
    return matches;
  }, [filter, query, sort]);

  function reset() {
    setFilter("Tümü");
    setQuery("");
    setSort("catalog");
  }

  return (
    <><SiteHeader />
      <main id="main-content" tabIndex={-1} className="mx-auto max-w-[1440px] px-5 py-12 md:px-10 md:py-16">
        <div className="mb-9 grid gap-6 md:grid-cols-[1fr_auto] md:items-end">
          <div><p className="eyebrow">Fidan kataloğu</p><h1 className="page-title">Bahçenize uygun olanı bulun.</h1><p className="mt-4 max-w-2xl leading-7 text-[var(--muted)]">Boylarını karşılaştırın, bakım bilgilerini açarak ışık ve sulama ihtiyaçlarını inceleyin. Görseller temsili, sipariş süreci demodur.</p></div>
          <div className="relative">
            <Search className="absolute left-4 top-1/2 -translate-y-1/2 text-[var(--muted)]" size={18} aria-hidden="true" />
            <label htmlFor="product-search" className="sr-only">Fidan adı, türü veya kategorisi ara</label>
            <input ref={searchRef} id="product-search" type="search" value={query} onChange={(event) => setQuery(event.target.value)} className="search-input pr-12" placeholder="Fidan ara" autoComplete="off" maxLength={100} aria-controls="product-results" />
            {query && <button type="button" onClick={() => { setQuery(""); searchRef.current?.focus(); }} className="absolute right-2 top-1/2 grid size-10 -translate-y-1/2 place-items-center rounded-full" aria-label="Aramayı temizle"><X size={17} aria-hidden="true" /></button>}
          </div>
        </div>
        <div className="mb-8 flex flex-wrap items-center gap-2" role="group" aria-label="Fidan kategorileri">
          <SlidersHorizontal size={18} className="mr-1" aria-hidden="true" />
          {filters.map((item) => <button key={item} type="button" onClick={() => setFilter(item)} aria-pressed={filter === item} aria-controls="product-results" className={`filter-pill ${filter === item ? "active" : ""}`}>{item}</button>)}
        </div>
        <div className="mb-5 flex flex-wrap items-center justify-between gap-4">
          <p role="status" className="text-sm text-[var(--muted)]">{visible.length} fidan{filter !== "Tümü" && ` · ${filter}`}{query.trim() && ` · “${query.trim()}”`}</p>
          <label className="flex items-center gap-3 text-sm text-[var(--muted)]">Sıralama<select value={sort} onChange={(event) => setSort(event.target.value)} className="catalog-sort" aria-controls="product-results"><option value="catalog">Katalog sırası</option><option value="price-asc">Fiyat: düşükten yükseğe</option><option value="price-desc">Fiyat: yüksekten düşüğe</option></select></label>
        </div>
        <div id="product-results" className="grid gap-5 md:grid-cols-2 xl:grid-cols-3">
          {visible.map((product) => <div id={product.id} key={product.id} className="scroll-mt-28"><ProductCard product={product} /></div>)}
        </div>
        {visible.length === 0 && <div className="rounded-3xl border border-dashed border-[var(--line)] bg-white px-5 py-16 text-center"><Search className="mx-auto mb-5 text-[var(--muted)]" size={28} aria-hidden="true" /><h2 className="font-serif text-3xl">Bu aramayla eşleşen fidan yok.</h2><p className="mx-auto mt-3 max-w-md text-sm leading-6 text-[var(--muted)]">Daha kısa bir isimle arayın veya başka bir kategoriyi seçin.</p><button type="button" onClick={reset} className="secondary-button mt-6">Filtreleri temizle</button></div>}
        <aside className="mt-12 rounded-2xl bg-[#e5eadf] p-6 text-sm leading-7 text-[var(--muted)]" aria-label="Katalog hakkında"><strong className="text-[var(--ink)]">Seçerken aklınızda olsun:</strong> Boy aralıkları ve bakım bilgileri genel bir karşılaştırma sunar. Türü kesin olmayan fidanlar ürün açıklamasında belirtilir. Bu demo katalogdaki fotoğraflar teslim edilecek gerçek fidanı göstermez.</aside>
      </main>
      <SiteFooter />
    </>
  );
}
