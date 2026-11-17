import './globals.css';
import type { ReactNode } from 'react';
import type { Metadata, Viewport } from 'next';
import { ServiceWorker } from '@/components/ServiceWorker';

export const metadata: Metadata = {
  title: 'Bokföring', description: 'Bokföring, fakturering, leverantörsbetalningar och lön',
  appleWebApp: { capable: true, title: 'Bokföring', statusBarStyle: 'default' },
  icons: { apple: '/icon.svg' },
};
export const viewport: Viewport = { themeColor: '#1f5f8b', width: 'device-width', initialScale: 1 };

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="sv">
      <body>{children}<ServiceWorker /></body>
    </html>
  );
}
