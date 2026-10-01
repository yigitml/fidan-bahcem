import Link from "next/link";
import { Sprout } from "lucide-react";

export function SiteFooter() {
  return (
    <footer className="mt-20 border-t border-[var(--line)] bg-[#173d2e] text-[#f3f0e6]">
      <div className="mx-auto grid max-w-[1440px] gap-10 px-5 py-12 md:grid-cols-[1fr_auto] md:px-10">
        <div>
          <Link href="/" className="mb-4 flex w-fit items-center gap-3 font-serif text-2xl" aria-label="Fidan Bahçem ana sayfa"><Sprout aria-hidden="true" />Fidan Bahçem</Link>
          <p className="max-w-xl text-sm leading-6 text-[#c9d6cf]">Bahçeniz için fidanları boy, ışık ve sulama bilgileriyle karşılaştırın. Türü belirsiz olan seçenekler açıklamalarında belirtilir.</p>
          <p className="mt-4 max-w-xl text-xs leading-6 text-[#c9d6cf]">Demo fidan siparişleri için gerçek ödeme veya sevkiyat yapılmaz.</p>
        </div>
        <nav aria-label="Alt menü" className="grid grid-cols-2 gap-x-10 text-sm">
          <Link className="footer-link" href="/fidanlar">Tüm fidanlar</Link>
          <Link className="footer-link" href="/odeme">Sepet ve sipariş</Link>
          <Link className="footer-link" href="/gizlilik">Gizlilik</Link>
          <Link className="footer-link" href="/hesabim">Hesabım</Link>
        </nav>
      </div>
      <div className="border-t border-white/15 px-5 py-5 text-center text-xs leading-6 text-[#bdcec3]">© {new Date().getFullYear()} Fidan Bahçem · Temsili fotoğraflar Unsplash kaynaklıdır.</div>
    </footer>
  );
}
