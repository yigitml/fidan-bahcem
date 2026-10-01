import type { Metadata } from "next";
import Link from "next/link";
import { Sprout } from "lucide-react";
import { SiteHeader } from "@/components/site-header";
import { SiteFooter } from "@/components/site-footer";

export const metadata: Metadata = { title: "Sayfa bulunamadı", robots: { index: false, follow: false } };

export default function NotFound() {
  return (
    <><SiteHeader /><main id="main-content" tabIndex={-1} className="mx-auto grid min-h-[60vh] max-w-2xl place-items-center px-5 py-16 text-center">
      <div><span className="mx-auto mb-6 grid size-20 place-items-center rounded-full bg-[#e5eadf]"><Sprout size={34} aria-hidden="true" /></span><p className="eyebrow">404 · Sayfa bulunamadı</p><h1 className="page-title">Bu dal başka yere uzanıyor.</h1><p className="mx-auto mt-5 max-w-md leading-7 text-[var(--muted)]">Bu sayfa taşınmış veya adresi yanlış yazılmış olabilir. Fidan kataloğundan devam edebilirsiniz.</p><div className="mt-8 flex flex-wrap justify-center gap-3"><Link href="/fidanlar" className="primary-button">Fidanları keşfet</Link><Link href="/" className="secondary-button">Ana sayfaya dön</Link></div></div>
    </main><SiteFooter /></>
  );
}
