import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: { default: "Fidan Bahçem", template: "%s · Fidan Bahçem" },
  description: "Fidanları boy, ışık ve sulama ihtiyaçlarıyla karşılaştırın. Fidan Bahçem demo mağazasında üyeliksiz sipariş sürecini deneyin.",
  applicationName: "Fidan Bahçem",
  openGraph: {
    title: "Fidan Bahçem",
    description: "Bahçeniz için fidanları keşfedin; boy ve bakım bilgilerini karşılaştırın.",
    locale: "tr_TR",
    type: "website",
  },
  icons: {
    icon: "/favicon.svg",
    shortcut: "/favicon.svg",
  },
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="tr" data-scroll-behavior="smooth">
      <body className="antialiased">{children}</body>
    </html>
  );
}
