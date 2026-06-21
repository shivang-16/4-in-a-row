import type { Metadata } from 'next';
import { Lilita_One, Quicksand } from 'next/font/google';
import { Analytics } from '@vercel/analytics/next';
import './globals.css';

const lilitaOne = Lilita_One({
  subsets: ['latin'],
  variable: '--font-lilita',
  weight: '400',
});

const quicksand = Quicksand({
  subsets: ['latin'],
  variable: '--font-quicksand',
  weight: ['300', '400', '500', '600', '700'],
});

export const metadata: Metadata = {
  title: 'Word Puzzle Bees',
  description: 'A playful word puzzle where you connect letters on a web of hexagonal nodes',
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
      <body className={`${lilitaOne.variable} ${quicksand.variable}`}>{children}<Analytics /></body>
    </html>
  );
}
