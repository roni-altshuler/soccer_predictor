import type { ReactNode } from 'react';
import './globals.css';

export const metadata = {
  title: 'FotPredict',
  description: 'AI-powered football predictions, live tracking, and league simulations.',
};

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}
