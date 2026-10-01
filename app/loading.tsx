import { LoaderCircle } from "lucide-react";
import { SiteHeader } from "@/components/site-header";

export default function Loading() {
  return (
    <><SiteHeader /><main id="main-content" tabIndex={-1} className="mx-auto flex min-h-[65vh] max-w-2xl flex-col items-center justify-center gap-5 px-5 py-16 text-center" aria-busy="true">
      <LoaderCircle className="animate-spin text-[var(--muted)]" size={30} aria-hidden="true" /><p role="status" className="font-serif text-2xl">Sayfa hazırlanıyor…</p><p className="text-sm text-[var(--muted)]">Birazdan bahçenize devam edebilirsiniz.</p>
    </main></>
  );
}
