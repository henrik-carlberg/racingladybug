import Link from 'next/link';
import { notFound } from 'next/navigation';
import { requireCompany } from '@/lib/server/auth';
import { Flash, type SP } from '@/components/ui';
import { NotFoundError } from '@/lib/errors';
import { kr } from '@/lib/format';
import { binder } from '@/lib/services/closing-binder';
import { save } from './actions';

export const dynamic = 'force-dynamic';
const ST: Record<string, [string, string]> = { ok: ['Avstämt', 'ok'], diff: ['Differens', 'danger'], open: ['Att stämma av', 'warn'] };

export default async function Binder({ params, searchParams }: { params: Promise<{ cid: string; fyid: string }>; searchParams: SP }) {
  const { cid, fyid } = await params;
  const ctx = await requireCompany(cid, { perm: 'ledger' });
  const c = ctx.company;
  const b = await binder(c.id, Number(fyid) || 0).catch((e) => { if (e instanceof NotFoundError) notFound(); throw e; });
  const base = `/c/${c.id}/bokslut/${b.fy.id}`;
  const v = (o: number | null) => (o == null ? '' : String(o / 100).replace('.', ','));
  return (
    <div style={{ maxWidth: 1100 }}>
      <div className="header"><h1>Bokslutspärm {b.fy.start_date} – {b.fy.end_date}</h1>
        <div className="actions" style={{ margin: 0 }}><a className="btn" href={`${base}/parm/pdf`}>Ladda ner som PDF</a><Link className="btn secondary" href={base}>Bokslutet</Link></div></div>
      <p className="muted">En specifikation per balanskonto: saldot i huvudboken stäms av mot reskontra, register eller ett eget underlag. Kundfordringar, leverantörsskulder, anläggningar och lager specificeras automatiskt. Bocka av kontot när specifikationen stämmer – pärmen kan sedan skickas som PDF till revisor och bank.</p>
      <Flash searchParams={searchParams} />
      <p className="binder-progress"><b>{b.done}</b> av <b>{b.total}</b> konton avstämda · årets resultat {kr(b.result)} kr</p>
      {b.secs.map((s) => (
        <section key={s.key} className="card binder-section">
          <div className="header" style={{ marginBottom: '.3rem' }}><b>{s.title}</b><span className={`badge ${s.done ? 'ok' : 'warn'}`}>{s.done ? 'Klar' : `${s.open} kvar`}</span></div>
          <table className="binder"><thead><tr><th>Konto</th><th className="num">Huvudbok</th><th className="num">Specificerat</th><th className="num">Differens</th><th>Status</th><th>Specifikation och avstämning</th></tr></thead>
            <tbody>{s.rows.map((r) => (
              <tr key={r.account} id={`a${r.account}`} className={`binder-row ${r.status}`}>
                <td>{r.account} {r.name}{r.source && <div className="small muted">{r.source}</div>}</td>
                <td className="num">{kr(r.ledger)}</td><td className="num spec">{r.specified == null ? '–' : kr(r.specified)}</td><td className="num diff">{r.diff == null ? '–' : kr(r.diff)}</td>
                <td><span className={`badge ${ST[r.status][1]}`}>{ST[r.status][0]}</span>{r.item?.signed_by && <div className="small muted">{r.item.signed_by} {r.item.signed_at}</div>}</td>
                <td><form action={save.bind(null, c.id, b.fy.id, r.account)} className="row" style={{ alignItems: 'end' }}>
                  <label style={{ flex: '0 0 120px' }}>Belopp (kr)<input name="amount" defaultValue={v(r.item?.amount ?? null)} placeholder={r.source && r.source !== 'Manuell specifikation' ? 'automatiskt' : ''} inputMode="decimal" /></label>
                  <label style={{ flex: '1 1 140px' }}>Underlag<input name="reference" defaultValue={r.item?.reference ?? ''} placeholder="T.ex. kontoutdrag 31/12" /></label>
                  <label style={{ flex: '1 1 140px' }}>Kommentar<input name="note" defaultValue={r.item?.note ?? ''} /></label>
                  <label className="check"><input type="checkbox" name="done" defaultChecked={r.item?.done} /> Avstämt</label>
                  <button className="secondary small">Spara</button></form></td>
              </tr>))}</tbody>
            <tfoot><tr><td>Summa</td><td className="num">{kr(s.total)}</td><td colSpan={4} /></tr></tfoot>
          </table>
        </section>))}
    </div>
  );
}
