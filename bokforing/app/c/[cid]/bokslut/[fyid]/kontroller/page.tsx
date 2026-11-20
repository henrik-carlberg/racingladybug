import Link from 'next/link';
import { notFound } from 'next/navigation';
import { requireCompany } from '@/lib/server/auth';
import { NotFoundError } from '@/lib/errors';
import { Flash, type SP } from '@/components/ui';
import { yearChecks } from '@/lib/services/quality-checks';
import { ack, unack } from './actions';

export const dynamic = 'force-dynamic';

/** Kvalitetskontroller före bokslut: ovanliga saldon, gamla avräkningskonton och momsavvikelser med förslag på åtgärd */
export default async function QualityChecks({ params, searchParams }: { params: Promise<{ cid: string; fyid: string }>; searchParams: SP }) {
  const { cid, fyid } = await params;
  const ctx = await requireCompany(cid, { perm: 'ledger' });
  const id = ctx.company.id;
  const q = await yearChecks(id, Number(fyid)).catch((e) => { if (e instanceof NotFoundError) notFound(); throw e; });
  const open = q.findings.filter((f) => !f.ack), done = q.findings.filter((f) => f.ack);
  return (
    <div style={{ maxWidth: 900 }}>
      <h1>Kontroller före bokslut {q.fy.start_date.slice(0, 4)}</h1>
      <p className="small"><Link href={`/c/${id}/bokslut/${q.fy.id}`}>← Bokslutet</Link> · <Link href={`/c/${id}/bokslut/${q.fy.id}/parm`}>Bokslutspärm</Link></p>
      <Flash searchParams={searchParams} />
      <div className="grid">
        <div className="card stat"><div className="label">Fel</div><div className="value qc-errors">{q.summary.errors}</div></div>
        <div className="card stat"><div className="label">Att kontrollera</div><div className="value qc-warnings">{q.summary.warnings}</div></div>
        <div className="card stat"><div className="label">Kvitterade</div><div className="value qc-acked">{q.summary.acked}</div></div>
      </div>
      {!open.length && <div className="card qc-clean">✅ Inga avvikelser att åtgärda per {q.fy.end_date}.</div>}
      {open.map((f) => (
        <div key={f.key} className={`card stack qc-finding ${f.level}`} data-key={f.key}>
          <div className="header" style={{ margin: 0 }}>
            <h2 style={{ margin: 0, fontSize: '1.05rem' }}><span className={`badge ${f.level === 'error' ? 'danger' : 'warn'}`} style={{ marginRight: '.5rem' }}>{f.level === 'error' ? 'Fel' : 'Kontrollera'}</span>{f.title}</h2>
            <Link href={f.href}>Visa</Link>
          </div>
          <p className="small" style={{ margin: 0 }}>{f.detail}</p>
          <p style={{ margin: 0 }}><b>Åtgärd:</b> {f.action}</p>
          {!f.key.startsWith('integrity:') && !q.fy.closed && (
            <form action={ack.bind(null, id, q.fy.id)} style={{ display: 'flex', gap: '.4rem' }}>
              <input type="hidden" name="key" value={f.key} />
              <input name="note" required maxLength={500} placeholder="Förklaring, t.ex. utnyttjad checkkredit" aria-label="Förklaring" style={{ flex: 1 }} />
              <button className="secondary">Kvittera</button>
            </form>
          )}
        </div>
      ))}
      {done.length > 0 && (
        <>
          <h2>Kvitterade</h2>
          <table><tbody>{done.map((f) => (
            <tr key={f.key} className="qc-acked-row"><td>{f.title}</td><td className="small">{f.ack!.note} – {f.ack!.by ?? 'okänd'} {f.ack!.at}</td>
              <td>{!q.fy.closed && <form action={unack.bind(null, id, q.fy.id, f.key)}><button className="secondary small">Ångra</button></form>}</td></tr>))}</tbody></table>
        </>
      )}
      <p className="small muted">Kontrollerna gäller saldon per bokslutsdagen: negativa kassa- och bankkonton, tillgångar med kreditsaldo och skulder med debetsaldo,
        avräkningskonton (1610–1619, 1630, 1680–1689, 2650, 2890–2899) utan rörelse de senaste 90 dagarna, intäkts- och kostnadskonton med ovanligt tecken samt utgående moms jämfört med försäljningen.</p>
    </div>
  );
}
