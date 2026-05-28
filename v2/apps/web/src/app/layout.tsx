import type { ReactNode } from 'react';
import './globals.css';

export const metadata = {
  title: 'Pitchwise',
  description: 'Calibrated football intelligence — predictions, live tracking, and league simulations.',
};

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}
