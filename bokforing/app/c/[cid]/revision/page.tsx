import Link from 'next/link';
import { requireCompany } from '@/lib/server/auth';
import { EmptyState, Flash, type SP } from '@/components/ui';
import { fiscalYears } from '@/lib/server/ledger';
import { engagements } from '@/lib/services/audit-work';

export const dynamic = 'force-dynamic';

export default async function Audit({ params, searchParams }: { params: Promise<{ cid: string }>; searchParams: SP }) {
  const { cid } = await params;
  const ctx = await requireCompany(cid, { perm: 'ledger' });
  const list = await engagements(ctx.company.id);
  const years = await fiscalYears(ctx.company.id);
  const free = years.filter((y) => !list.some((e) => e.fy === y.id));
  const b = `/c/${ctx.company.id}`;
  return (
    <div style={{ maxWidth: 900 }}>
      <h1>Revision</h1>
      <Flash searchParams={searchParams} />
      <p className="muted">Revisorns arbetsyta: stickprov på verifikationer, kontrollpunkter per balanspost och anmärkningar till bolaget. Granskningen ändrar ingenting i bokföringen.{ctx.role !== 'auditor' && ' Bjud in revisorn med rollen Revisor under Inställningar.'}</p>
      {list.length === 0 ? <EmptyState icon="check" title="Ingen granskning än">{ctx.role === 'auditor' ? 'Starta granskningen av ett räkenskapsår nedan.' : 'När revisorn startar granskningen syns den här.'}</EmptyState> : (
        <table>
          <thead><tr><th>Räkenskapsår</th><th>Status</th><th className="num">Stickprov</th><th className="num">Anmärkningar</th></tr></thead>
          <tbody>{list.map((e) => <tr key={e.id}><td><Link href={`${b}/revision/${e.id}`}>{e.start} – {e.end}</Link></td><td>{e.status === 'open' ? <span className="badge warn">Pågår</span> : <span className="badge ok">Avslutad</span>}</td><td className="num">{e.samples}</td><td className="num">{e.remarks}</td></tr>)}</tbody>
        </table>
      )}
      {ctx.role === 'auditor' && free.length > 0 && (
        <form method="post" action={`${b}/revision/granska`} className="card row" style={{ alignItems: 'end' }}>
          <input type="hidden" name="op" value="start" />
          <label>Räkenskapsår<select name="fy">{free.map((y) => <option key={y.id} value={y.id}>{y.start_date} – {y.end_date}</option>)}</select></label>
          <div style={{ flex: '0 0 auto' }}><button>Starta granskning</button></div>
        </form>
      )}
    </div>
  );
}
