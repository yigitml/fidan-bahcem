import Image from "next/image";
import Link from "next/link";
import { ArrowDown, BadgeCheck, PackageCheck, Truck } from "lucide-react";
import { ProductCard } from "@/components/product-card";
import { SiteFooter } from "@/components/site-footer";
import { SiteHeader } from "@/components/site-header";
import { products } from "@/lib/products";

export default function Home() {
  return <><SiteHeader /><main>
    <section className="mx-auto grid max-w-[1440px] gap-8 px-5 pb-16 pt-8 md:grid-cols-[0.9fr_1.1fr] md:px-10 md:pb-24 md:pt-10">
      <div className="flex flex-col justify-center py-8 md:py-14">
        <p className="eyebrow">Doğrudan bahçeden · Tür teyitli satış</p>
        <h1 className="hero-title">Bahçeniz için doğru fidanı, güvenle seçin.</h1>
        <p className="mt-6 max-w-xl text-lg leading-8 text-[var(--muted)]">Fotoğraflarda seçilebilen fidanları boy ve bakım bilgileriyle sunuyoruz. Belirsiz türleri paketlemeden önce sizinle teyit ediyoruz.</p>
        <div className="mt-8 flex flex-col gap-3 sm:flex-row"><Link className="primary-button" href="/fidanlar">Fidanları incele <ArrowDown size={18} /></Link><Link className="secondary-button" href="/odeme">Üyeliksiz ödeme</Link></div>
        <div className="mt-10 grid max-w-xl grid-cols-3 gap-3 border-t border-[var(--line)] pt-6 text-sm"><div><strong className="block text-xl">8</strong><span className="text-[var(--muted)]">fidan grubu</span></div><div><strong className="block text-xl">3</strong><span className="text-[var(--muted)]">bakım bilgisi</span></div><div><strong className="block text-xl">0</strong><span className="text-[var(--muted)]">üyelik adımı</span></div></div>
      </div>
      <div className="hero-image-wrap"><Image src="/images/nursery.jpg" alt="Fidanlıkta düzenlenmiş bitkiler" fill priority className="object-cover" sizes="(max-width: 768px) 100vw, 55vw" /><div className="absolute bottom-5 left-5 right-5 rounded-2xl bg-[var(--paper)]/95 p-5 shadow-xl backdrop-blur"><p className="mb-1 text-xs font-semibold uppercase tracking-[0.14em] text-[var(--muted)]">Bu hafta öne çıkan</p><div className="flex items-end justify-between gap-4"><div><strong className="font-serif text-2xl">Fındık fidanı</strong><p className="mt-1 text-sm text-[var(--muted)]">60–90 cm · Düzenli sulama</p></div><Link href="/fidanlar#findik" className="text-sm font-semibold underline underline-offset-4">İncele</Link></div></div></div>
    </section>
    <section className="bg-[#173d2e] text-[#f6f3e9]"><div className="mx-auto grid max-w-[1440px] divide-y divide-white/15 px-5 md:grid-cols-3 md:divide-x md:divide-y-0 md:px-10">{[[BadgeCheck,"Sipariş öncesi teyit","Belirsiz türleri yakın çekimle birlikte netleştiririz."],[PackageCheck,"Kök dostu paketleme","Fidan kökü nemini koruyan ambalajla hazırlanır."],[Truck,"Teslimat teyidi","Sevkiyat öncesi tür ve boy bilgisi paylaşılır."]].map(([Icon,title,text]) => { const I=Icon as typeof BadgeCheck; return <div key={title as string} className="flex gap-4 px-2 py-7 md:px-8"><I className="mt-1 shrink-0 text-[#efb94f]" /><div><h2 className="font-semibold">{title as string}</h2><p className="mt-1 text-sm leading-6 text-[#c7d4cd]">{text as string}</p></div></div>})}</div></section>
    <section className="mx-auto max-w-[1440px] px-5 py-20 md:px-10 md:py-28"><div className="section-heading"><div><p className="eyebrow">Seçili fidanlar</p><h2>Bahçeye hazır favoriler</h2></div><Link href="/fidanlar" className="text-sm font-semibold underline underline-offset-4">Tümünü gör</Link></div><div className="grid gap-5 md:grid-cols-3">{products.slice(0,3).map((p) => <ProductCard key={p.id} product={p} />)}</div></section>
    <section className="mx-auto max-w-[1440px] px-5 md:px-10"><div className="rounded-[2rem] bg-[#e5eadf] p-7 md:grid md:grid-cols-[1fr_1.15fr] md:gap-16 md:p-14"><div><p className="eyebrow">Dürüst seçim rehberi</p><h2 className="font-serif text-4xl leading-tight tracking-[-0.04em] md:text-5xl">Fotoğraftan emin olmadığımızı saklamıyoruz.</h2></div><div className="mt-7 grid gap-5 md:mt-0"><p className="text-lg leading-8 text-[var(--muted)]">Fındık gibi ayırt edici yapraklı türler daha net seçiliyor. Mazı, Leylandi ve bazı servilerde ise yakın çekim olmadan kesin tür sözü vermiyoruz.</p><Link href="/fidanlar" className="primary-button w-fit">Fidanları incele</Link></div></div></section>
  </main><SiteFooter /></>;
}
