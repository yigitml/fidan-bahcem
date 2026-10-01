import type { Metadata } from "next";

export const metadata: Metadata = {
  title: "Fidan kataloğu",
  description: "Fidan seçeneklerini boy, ışık ve sulama ihtiyaçlarıyla karşılaştırın. Fidan Bahçem demo kataloğunu keşfedin.",
};

export default function CatalogLayout({ children }: { children: React.ReactNode }) {
  return children;
}
