import { notFound } from 'next/navigation';
import type { Metadata } from 'next';
import { listLog, siteByKiosk } from '@/lib/services/staff';
import { kioskStamp } from './actions';

export const dynamic = 'force-dynamic';
export const metadata: Metadata = { robots: { index: false, follow: false }, title: 'Personalliggare' };

export default async function Kiosk({ params, searchParams }: { params: Promise<{ token: string }>; searchParams: Promise<Record<string, string | undefined>> }) {
  const { token } = await params;
  const sp = await searchParams;
  const site = await siteByKiosk(token);
  if (!site) notFound();
  const open = (await listLog(site.company_id, { siteId: site.id, open: true })).sort((a, b) => a.person_name.localeCompare(b.person_name));
  return (
    <main className="center" style={{ maxWidth: 520 }}>
      <h1>{site.name}</h1>
      <p className="muted">{site.company} · Personalliggare</p>
      {sp.ok && <div className="flash ok">{sp.ok}</div>}
      {sp.fel && <div className="flash error">{sp.fel === '1' ? 'Sidan är inte längre giltig' : sp.fel}</div>}
      <form action={kioskStamp.bind(null, token)} className="card stack">
        <label>Personnummer<input name="personal_number" inputMode="numeric" autoComplete="off" required autoFocus placeholder="ÅÅÅÅMMDD-NNNN" style={{ fontSize: '1.3rem' }} /></label>
        <label>Namn (bara om du inte är anställd här)<input name="name" autoComplete="off" /></label>
        <button style={{ fontSize: '1.2rem', padding: '.8rem' }}>Stämpla in / ut</button>
      </form>
      <h2>Instämplade nu ({open.length})</h2>
      <ul>{open.map((e) => <li key={e.id}>{e.person_name} – sedan {e.check_in.slice(11, 16)}</li>)}</ul>
    </main>
  );
}
