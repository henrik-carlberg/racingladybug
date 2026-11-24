import type { MetadataRoute } from 'next';
import { APP_NAME } from '@/lib/brand';

export default function manifest(): MetadataRoute.Manifest {
  return {
    name: APP_NAME,
    short_name: APP_NAME,
    description: 'Bokföring, fakturering, lön och hela verksamheten',
    start_url: '/',
    scope: '/',
    display: 'standalone',
    background_color: '#f6f7f9',
    theme_color: '#1f5f8b',
    lang: 'sv',
    icons: [
      { src: '/icon.svg', sizes: 'any', type: 'image/svg+xml', purpose: 'any' },
      { src: '/icon-maskable.svg', sizes: 'any', type: 'image/svg+xml', purpose: 'maskable' },
    ],
    // Genvägar när man håller in appikonen
    shortcuts: [
      { name: 'Nytt kvitto', short_name: 'Kvitto', description: 'Fota ett kvitto', url: '/genvag/kvitto', icons: [{ src: '/icon.svg', sizes: 'any' }] },
      { name: 'Skanna leverantörsfaktura', short_name: 'Faktura', description: 'Ladda upp en faktura till inkorgen', url: '/genvag/faktura', icons: [{ src: '/icon.svg', sizes: 'any' }] },
      { name: 'Att göra', short_name: 'Att göra', url: '/genvag/oversikt', icons: [{ src: '/icon.svg', sizes: 'any' }] },
    ],
    // Dela en bild eller PDF från andra appar direkt hit (tas emot av service workern)
    share_target: { action: '/dela', method: 'POST', enctype: 'multipart/form-data', params: { title: 'title', text: 'text', files: [{ name: 'file', accept: ['image/*', 'application/pdf'] }] } },
  };
}
