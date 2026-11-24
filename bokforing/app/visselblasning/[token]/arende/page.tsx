import { notFound } from 'next/navigation';
import { publicInfo } from '@/lib/services/whistleblowing';
import ThreadView from './ThreadView';

export const dynamic = 'force-dynamic';
export const metadata = { robots: { index: false }, referrer: 'no-referrer' };

export default async function WhistleCase({ params }: { params: Promise<{ token: string }> }) {
  const { token } = await params;
  const info = await publicInfo(token);
  if (!info) notFound();
  return (
    <main style={{ maxWidth: 680, margin: '2rem auto', padding: '0 1rem' }}>
      <h1>Följ ditt ärende – {info.company}</h1>
      <ThreadView token={token} />
    </main>
  );
}
