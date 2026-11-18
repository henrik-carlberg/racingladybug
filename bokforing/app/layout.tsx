import './globals.css';
import type { ReactNode } from 'react';
import type { Metadata, Viewport } from 'next';
import { ServiceWorker } from '@/components/ServiceWorker';
import { uiLang } from '@/lib/server/lang';
import { tr } from '@/lib/ui-i18n';

export const metadata: Metadata = {
  title: 'Bokföring', description: 'Bokföring, fakturering, leverantörsbetalningar och lön',
  appleWebApp: { capable: true, title: 'Bokföring', statusBarStyle: 'default' },
  icons: { apple: '/icon.svg' },
};
export const viewport: Viewport = { themeColor: '#1f5f8b', width: 'device-width', initialScale: 1 };

export default async function RootLayout({ children }: { children: ReactNode }) {
  const lang = await uiLang();
  return (
    <html lang={lang}>
      <body><a className="skip-link" href="#main">{tr(lang, 'Hoppa till innehållet')}</a>{children}<ServiceWorker /></body>
    </html>
  );
}
