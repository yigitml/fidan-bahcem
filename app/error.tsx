"use client";

import Link from "next/link";
import { RefreshCw } from "lucide-react";
import { SiteHeader } from "@/components/site-header";
import { SiteFooter } from "@/components/site-footer";

export default function ErrorPage({ retry }: { error: Error & { digest?: string }; retry: () => void }) {
  return (
    <><title>Sayfa yüklenemedi · Fidan Bahçem</title><SiteHeader /><main id="main-content" tabIndex={-1} className="mx-auto grid min-h-[60vh] max-w-2xl place-items-center px-5 py-16 text-center">
      <div role="alert"><span className="mx-auto mb-6 grid size-20 place-items-center rounded-full bg-[#e5eadf]"><RefreshCw size={32} aria-hidden="true" /></span><p className="eyebrow">Geçici bir sorun oluştu</p><h1 className="page-title">Sayfa yüklenemedi.</h1><p className="mt-5 leading-7 text-[var(--muted)]">Yeniden deneyin veya ana sayfadan devam edin.</p><div className="mt-8 flex flex-wrap justify-center gap-3"><button type="button" className="primary-button" onClick={retry}><RefreshCw size={18} aria-hidden="true" />Yeniden dene</button><Link href="/" className="secondary-button">Ana sayfaya dön</Link></div></div>
    </main><SiteFooter /></>
  );
}
