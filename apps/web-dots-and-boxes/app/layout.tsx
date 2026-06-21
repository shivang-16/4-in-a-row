import type { Metadata } from 'next';
import { Lilita_One } from 'next/font/google';
import { Analytics } from '@vercel/analytics/next';
import './globals.css';

const lilitaOne = Lilita_One({
  weight: '400',
  subsets: ['latin'],
  variable: '--font-lilita',
});

export const metadata: Metadata = {
  title: 'Dots & Boxes',
};

export const viewport = {
  width: 'device-width',
  initialScale: 1,
  maximumScale: 1,
  userScalable: false,
  viewportFit: 'cover',
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body className={lilitaOne.variable}>{children}<Analytics /></body>
    </html>
  );
}
