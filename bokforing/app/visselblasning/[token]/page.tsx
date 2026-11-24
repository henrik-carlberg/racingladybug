import Link from 'next/link';
import { notFound } from 'next/navigation';
import { publicInfo } from '@/lib/services/whistleblowing';
import ReportForm from './ReportForm';

export const dynamic = 'force-dynamic';
export const metadata = { robots: { index: false }, referrer: 'no-referrer' };

export default async function Whistle({ params }: { params: Promise<{ token: string }> }) {
  const { token } = await params;
  const info = await publicInfo(token);
  if (!info) notFound();
  return (
    <main style={{ maxWidth: 680, margin: '2rem auto', padding: '0 1rem' }}>
      <h1>Visselblåsning – {info.company}</h1>
      <p className="small">Här kan du rapportera missförhållanden som det finns ett allmänintresse av att de kommer fram. Du kan vara anonym. Rapporten läses bara av de handläggare som bolaget har utsett,
        och du får en bekräftelse inom sju dagar och återkoppling inom tre månader. Det är förbjudet att hindra rapportering eller vidta repressalier mot den som rapporterar.</p>
      <ReportForm token={token} />
      <p className="small"><Link href={`/visselblasning/${encodeURIComponent(token)}/arende`}>Följ ett ärende du redan har rapporterat →</Link></p>
    </main>
  );
}
