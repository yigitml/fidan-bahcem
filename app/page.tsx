import Image from "next/image";
import Link from "next/link";
import { ArrowRight, Droplets, Ruler, ShoppingBag } from "lucide-react";
import { ProductCard } from "@/components/product-card";
import { SiteFooter } from "@/components/site-footer";
import { SiteHeader } from "@/components/site-header";
import { products } from "@/lib/products";

const benefits = [
  { icon: Ruler, title: "Boy bilgisi açık", text: "Fidan boylarını kartlardaki aralıklarla karşılaştırın." },
  { icon: Droplets, title: "Bakım bilgisi elinizin altında", text: "Işık ve sulama ihtiyaçlarını seçmeden önce inceleyin." },
  { icon: ShoppingBag, title: "Üyeliksiz demo sipariş", text: "Sepetinizi oluşturun, kart bilgisi paylaşmadan süreci deneyin." },
];

export default function Home() {
  return (
    <><SiteHeader /><main id="main-content" tabIndex={-1}>
      <section className="mx-auto grid max-w-[1440px] gap-8 px-5 pb-16 pt-8 md:grid-cols-[0.9fr_1.1fr] md:px-10 md:pb-24 md:pt-10">
        <div className="flex flex-col justify-center py-8 md:py-14">
          <p className="eyebrow">Fidan seçimi · Bakım bilgileri</p>
          <h1 className="hero-title">Bahçeniz için doğru fidanı, güvenle seçin.</h1>
          <p className="mt-6 max-w-xl text-lg leading-8 text-[var(--muted)]">Fidanları boy, ışık ve sulama ihtiyaçlarıyla keşfedin. Türü belirsiz seçenekleri açıkça belirten kataloğumuzla bahçenize uygun bir seçim yapın.</p>
          <div className="mt-8 flex flex-col gap-3 sm:flex-row"><Link className="primary-button" href="/fidanlar">Fidanları incele <ArrowRight size={18} aria-hidden="true" /></Link><Link className="secondary-button" href="/odeme">Sepetimi gör</Link></div>
          <p className="mt-5 text-xs leading-6 text-[var(--muted)]">Demo mağaza · Gerçek ödeme veya sevkiyat yapılmaz.</p>
          <div className="mt-8 grid max-w-xl grid-cols-3 gap-3 border-t border-[var(--line)] pt-6 text-sm"><div><strong className="block text-xl">{products.length}</strong><span className="text-[var(--muted)]">fidan seçeneği</span></div><div><strong className="block text-xl">{new Set(products.map((product) => product.group)).size}</strong><span className="text-[var(--muted)]">kategori</span></div><div><strong className="block text-xl">Kolay</strong><span className="text-[var(--muted)]">misafir siparişi</span></div></div>
        </div>
        <div className="hero-image-wrap">
          <Image src="/images/nursery.jpg" alt="Fidanlıkta düzenlenmiş bitkilerin temsili fotoğrafı" fill loading="eager" fetchPriority="high" className="object-cover" sizes="(max-width: 767px) 100vw, 55vw" />
          <div className="absolute bottom-5 left-5 right-5 rounded-2xl bg-[var(--paper)]/95 p-5 shadow-xl backdrop-blur"><p className="mb-1 text-xs font-semibold uppercase tracking-[0.14em] text-[var(--muted)]">Katalogdan bir seçim</p><div className="flex items-end justify-between gap-4"><div><strong className="font-serif text-2xl">Fındık fidanı</strong><p className="mt-1 text-sm text-[var(--muted)]">60–90 cm · Düzenli sulama</p></div><Link href="/fidanlar#findik" className="min-h-11 content-center text-sm font-semibold underline underline-offset-4">İncele</Link></div></div>
        </div>
      </section>
      <section className="bg-[#173d2e] text-[#f6f3e9]" aria-label="Alışveriş rehberi">
        <div className="mx-auto grid max-w-[1440px] divide-y divide-white/15 px-5 md:grid-cols-3 md:divide-x md:divide-y-0 md:px-10">{benefits.map(({ icon: Icon, title, text }) => <div key={title} className="flex gap-4 px-2 py-7 md:px-6"><Icon className="mt-1 shrink-0 text-[#efb94f]" aria-hidden="true" /><div><h2 className="font-semibold">{title}</h2><p className="mt-1 text-sm leading-6 text-[#c7d4cd]">{text}</p></div></div>)}</div>
      </section>
      <section className="mx-auto max-w-[1440px] px-5 py-20 md:px-10 md:py-28">
        <div className="section-heading"><div><p className="eyebrow">Seçili fidanlar</p><h2>Kataloğa bir göz atın.</h2></div><Link href="/fidanlar" className="shrink-0 text-sm font-semibold underline underline-offset-4">Tümünü gör</Link></div>
        <div className="grid gap-5 md:grid-cols-3">{products.slice(0, 3).map((product) => <ProductCard key={product.id} product={product} />)}</div>
      </section>
      <section className="mx-auto max-w-[1440px] px-5 md:px-10">
        <div className="rounded-[2rem] bg-[#e5eadf] p-7 md:grid md:grid-cols-[1fr_1.15fr] md:gap-16 md:p-14"><div><p className="eyebrow">Dürüst seçim rehberi</p><h2 className="font-serif text-4xl leading-tight tracking-[-0.04em] md:text-5xl">Tür belirsizliğini açıkça görün.</h2></div><div className="mt-7 grid gap-5 md:mt-0"><p className="text-lg leading-8 text-[var(--muted)]">Mazı, Leylandi ve bazı servi seçenekleri birbirine benzeyebilir. Katalogdaki açıklamalar, kesin tür bilgisi bulunmayan fidanları ayrıca belirtir. Temsili fotoğrafları boy ve bakım bilgileriyle birlikte değerlendirin.</p><Link href="/fidanlar" className="primary-button w-fit">Kataloğu keşfet <ArrowRight size={18} aria-hidden="true" /></Link></div></div>
      </section>
    </main><SiteFooter /></>
  );
}
