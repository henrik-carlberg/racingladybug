import Link from 'next/link';
import { sql } from '@/lib/db';
import { requireUser } from '@/lib/server/auth';
import { SharedPreview } from '@/components/SharedFile';

export const dynamic = 'force-dynamic';

/** Hit kommer filer som delas till appen från bildgalleriet eller andra appar */
export default async function Share() {
  const user = await requireUser();
  const companies = await sql<{ id: number; name: string }[]>`SELECT c.id, c.name FROM companies c JOIN memberships m ON m.company_id = c.id WHERE m.user_id = ${user.id} AND m.role IN ('owner','accountant') ORDER BY c.name`;
  return (
    <div className="center" style={{ maxWidth: 560 }}>
      <h1>Vad är det här?</h1>
      <SharedPreview />
      {companies.map((c) => (
        <div key={c.id} className="card stack">
          {companies.length > 1 && <b>{c.name}</b>}
          <div className="actions" style={{ margin: 0 }}>
            <Link className="btn" href={`/c/${c.id}/kvitto?delad=1`}>Ett kvitto</Link>
            <Link className="btn secondary" href={`/c/${c.id}/leverantorsfakturor/inkorg?delad=1`}>En faktura att betala</Link>
          </div>
        </div>
      ))}
      {companies.length === 0 && <p className="muted">Du har inget bolag där du kan bokföra.</p>}
    </div>
  );
}
