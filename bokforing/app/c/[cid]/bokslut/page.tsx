import Link from 'next/link';
import { requireCompany } from '@/lib/server/auth';
import { fiscalYears } from '@/lib/server/ledger';

export const dynamic = 'force-dynamic';

export default async function Yearend({ params }: { params: Promise<{ cid: string }> }) {
  const { cid } = await params;
  const { company } = await requireCompany(cid);
  const years = await fiscalYears(company.id);
  return (
    <div style={{ maxWidth: 820 }}>
      <h1>Bokslut och deklaration</h1>
      <p className="muted">{company.company_type === 'AB'
        ? 'För aktiebolag: bokslut, beräknad skatt, inkomstdeklaration 2 (INK2) och årsredovisning till Bolagsverket.'
        : 'För enskild firma: årsbokslut (förenklat om omsättningen normalt är högst 3 Mkr) och NE-bilagan till din inkomstdeklaration.'}</p>
      <table>
        <thead><tr><th>Räkenskapsår</th><th>Status</th><th></th></tr></thead>
        <tbody>{years.map((y) => (
          <tr key={y.id}><td>{y.start_date} – {y.end_date}</td><td>{y.closed ? <span className="badge ok">Stängt</span> : <span className="badge">Öppet</span>}</td>
            <td className="num"><Link className="btn secondary" href={`/c/${company.id}/bokslut/${y.id}`}>Öppna</Link></td></tr>
        ))}</tbody>
      </table>
    </div>
  );
}
