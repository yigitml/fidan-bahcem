import Link from "next/link";
import { Sprout } from "lucide-react";
export function SiteFooter() {
  return <footer className="mt-24 border-t border-[var(--line)] bg-[#173d2e] text-[#f3f0e6]"><div className="mx-auto grid max-w-[1440px] gap-10 px-5 py-12 md:grid-cols-[1fr_auto] md:px-10"><div><div className="mb-4 flex items-center gap-3 font-serif text-2xl"><Sprout /> Fidan Bahçem</div><p className="max-w-xl text-sm leading-6 text-[#c9d6cf]">Fotoğraflardan seçilen fidanlar boy ve bakım bilgileriyle listelenir. Kesin olmayan türler sevkiyat öncesi yakın çekimle teyit edilir.</p></div><div className="grid grid-cols-2 gap-x-10 gap-y-3 text-sm"><Link href="/fidanlar">Tüm fidanlar</Link><Link href="/odeme">Sepet</Link><span>Özenli paketleme</span><span>Misafir ödeme</span></div></div><div className="border-t border-white/15 px-5 py-5 text-center text-xs text-[#9fb3a8]">© 2026 Fidan Bahçem · Fotoğraflar Unsplash kaynaklıdır.</div></footer>;
}
