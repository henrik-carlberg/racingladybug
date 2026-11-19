import { OfflineReceiptForm } from '@/components/OfflineReceiptForm';

export const dynamic = 'force-static';
export const metadata = { title: 'Nytt kvitto (utan uppkoppling)', robots: { index: false } };

/** Visas av service workern när sidan Nytt kvitto öppnas utan uppkoppling. Innehåller inga bolagsuppgifter. */
export default function OfflineReceipt() {
  return (
    <div className="center" style={{ maxWidth: 560 }}>
      <h1>Nytt kvitto</h1>
      <OfflineReceiptForm />
    </div>
  );
}
