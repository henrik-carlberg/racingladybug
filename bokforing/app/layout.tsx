import './globals.css';
import type { ReactNode } from 'react';

export const metadata = { title: 'Bokföring', description: 'Bokföring, fakturering, leverantörsbetalningar och lön' };

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="sv">
      <body>{children}</body>
    </html>
  );
}
