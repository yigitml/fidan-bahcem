import type { Metadata } from "next";

export const metadata: Metadata = {
  title: "Sepet ve teslimat",
  description: "Sepetinizi gözden geçirin ve kart bilgisi paylaşmadan demo siparişinizi tamamlayın.",
  robots: { index: false, follow: false },
};

export default function CheckoutLayout({ children }: { children: React.ReactNode }) {
  return children;
}
