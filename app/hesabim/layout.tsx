import type { Metadata } from 'next';

export const metadata: Metadata = {
  title: 'Hesabım',
  description: 'Fidan Bahçem hesabınızı, siparişlerinizi ve üyeliğinizi yönetin.',
  robots: { index: false, follow: false },
};

export default function AccountLayout({ children }: { children: React.ReactNode }) {
  return children;
}
