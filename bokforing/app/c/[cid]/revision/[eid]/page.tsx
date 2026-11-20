import Link from 'next/link';
import { notFound } from 'next/navigation';
import { sql } from '@/lib/db';
import { requireCompany } from '@/lib/server/auth';
import { Flash, type SP } from '@/components/ui';
import { NotFoundError } from '@/lib/errors';
import { kr } from '@/lib/format';
import { SAMPLE_LABEL } from '@/lib/audit-work';
import { materialityBasis, workspace } from '@/lib/services/audit-work';

export const dynamic = 'force-dynamic';
const ST: Record<string, [string, string]> = { pending: ['Att granska', ''], ok: ['Utan anmärkning', 'ok'], remark: ['Anmärkning', 'danger'] };

/** Formulär till granskningsrouten (vanligt POST – se revision/granska/route.ts) */
function Post({ url, eid, op, extra, className, style, children }: { url: string; eid: number; op: string; extra?: Record<string, string | number>; className?: string; style?: React.CSSProperties; children: React.ReactNode }) {
  return (
    <form method="post" action={url} className={className} style={style}>
      <input type="hidden" name="op" value={op} /><input type="hidden" name="eid" value={eid} />
      {Object.entries(extra ?? {}).map(([k, v]) => <input key={k} type="hidden" name={k} value={v} />)}
      {children}
    </form>
  );
}

function Review({ url, eid, op, extra, status, comment, label }: { url: string; eid: number; op: string; extra: Record<string, string | number>; status: string; comment: string; label: string }) {
  return (
    <Post url={url} eid={eid} op={op} extra={extra} className="row review" style={{ alignItems: 'end', margin: '.3rem 0 0' }}>
      <fieldset className="row" style={{ flex: '0 0 auto', border: 0, padding: 0, margin: 0 }}><legend className="sr-only">{label}</legend>
        {(['ok', 'remark', 'pending'] as const).map((s) => <label key={s} className="check"><input type="radio" name="status" value={s} defaultChecked={status === s} /> {ST[s][0]}</label>)}
      </fieldset>
      <label style={{ flex: '2 1 240px' }}>Kommentar<input name="comment" defaultValue={comment} placeholder="T.ex. underlag saknas, fel period, fel konto" /></label>
      <div style={{ flex: '0 0 auto' }}><button className="secondary">Spara</button></div>
    </Post>
  );
}

export default async function AuditWorkspace({ params, searchParams }: { params: Promise<{ cid: string; eid: string }>; searchParams: SP }) {
  const { cid, eid } = await params;
  const ctx = await requireCompany(cid, { perm: 'ledger' });
  const w = await workspace(ctx, Number(eid)).catch((e) => { if (e instanceof NotFoundError) notFound(); throw e; });
  const isAuditor = ctx.role === 'auditor', open = w.status === 'open', edit = isAuditor && open;
  const b = `/c/${ctx.company.id}`;
  const url = `${b}/revision/granska`;
  const users = edit ? await sql<{ id: number; name: string }[]>`SELECT u.id, u.name FROM memberships m JOIN users u ON u.id = m.user_id WHERE m.company_id = ${ctx.company.id} ORDER BY u.name` : [];
  const sug = edit ? await materialityBasis(ctx, w.id) : null;
  const krIn = (o: number) => (o ? String(o / 100).replace('.', ',') : '');
  const remarks = [...w.samples.filter((s) => s.status === 'remark'), ...w.checkpoints.filter((c) => c.status === 'remark')];
  const ledgerRemarks = w.ledger.filter((l) => l.status === 'remark' && (isAuditor || l.sent));
  const unsent = w.samples.filter((s) => s.status === 'remark' && !s.sent).length + w.checkpoints.filter((c) => c.status === 'remark' && !c.sent).length + w.ledger.filter((l) => l.status === 'remark' && !l.sent).length;
  return (
    <div style={{ maxWidth: 1100 }}>
      <div className="header">
        <h1>Revision {w.start} – {w.end}</h1>
        <div className="actions" style={{ margin: 0 }}><a className="btn secondary" href={`${b}/revision/${w.id}/export`}>Excel</a><Link className="btn secondary" href={`${b}/revision`}>Alla granskningar</Link></div>
      </div>
      <Flash searchParams={searchParams} />
      <div className="grid">
        <div className="card stat"><div className="label">Status</div><div className="value">{open ? 'Pågår' : `Avslutad ${w.closed}`}</div></div>
        <div className="card stat"><div className="label">Stickprov granskade</div><div className="value">{w.summary.samples.total - w.summary.samples.pending} av {w.summary.samples.total}</div></div>
        <div className="card stat"><div className="label">Kontrollpunkter klara</div><div className="value">{w.summary.checkpoints.total - w.summary.checkpoints.pending} av {w.summary.checkpoints.total}</div></div>
        <div className="card stat"><div className="label">Anmärkningar</div><div className="value">{w.summary.samples.remark + w.summary.checkpoints.remark}</div></div>
      </div>
      {w.integrity && <p className="small">{w.integrity.errors ? <b style={{ color: 'var(--danger)' }}>Integritetskontrollen {w.integrity.run} hittade {w.integrity.errors} avvikelser.</b> : `Integritetskontrollen ${w.integrity.run}: inga avvikelser.`} <Link href={`${b}/installningar/integritet`}>Visa</Link></p>}

      {!isAuditor && remarks.length > 0 && (
        <section className="card remarks"><b>Anmärkningar från revisorn</b><ul>{remarks.map((r, i) => <li key={i}>{'voucher_id' in r ? <><Link href={`${b}/verifikationer/${r.voucher_id}`}>{r.label}</Link> {r.text}: </> : <>{r.title}: </>}{r.comment}</li>)}</ul></section>
      )}

      <h2>Väsentlighet och stickprov</h2>
      {w.materiality > 0 && <p className="small materiality">Väsentlighet <b>{kr(w.materiality)} kr</b>{w.materiality_basis && ` (${w.materiality_basis})`} · genomförandeväsentlighet <b className="perf">{kr(w.performance)} kr</b> · obetydlighetsgräns {kr(w.trivial)} kr</p>}
      {edit && (
        <>
          {sug && sug.options.length > 0 && <div className="card small materiality-suggestion">
            <b>Förslag till väsentlighet</b>
            <ul style={{ margin: '.3rem 0' }}>{sug.options.map((o) => <li key={o.basis}>{o.pct} % av {o.basis.toLowerCase()} ({kr(o.base)} kr): {kr(o.amount)} kr</li>)}</ul>
            {sug.recommended && <Post url={url} eid={w.id} op="materiality" className="row">
              <input type="hidden" name="materiality" value={krIn(sug.amount)} /><input type="hidden" name="performance" value={krIn(sug.performance)} /><input type="hidden" name="trivial" value={krIn(sug.trivial)} />
              <input type="hidden" name="basis" value={`${sug.recommended.pct} % av ${sug.recommended.basis.toLowerCase()}`} />
              <span>Lägst: <b>{kr(sug.amount)} kr</b> ({sug.recommended.basis.toLowerCase()}), genomförandeväsentlighet {kr(sug.performance)} kr, obetydligt under {kr(sug.trivial)} kr.</span>
              <button className="secondary small">Använd förslaget</button></Post>}
          </div>}
          <Post url={url} eid={w.id} op="materiality" className="card row" style={{ alignItems: 'end' }}>
            <label>Väsentlighet (kr)<input name="materiality" inputMode="decimal" defaultValue={krIn(w.materiality)} /></label>
            <label>Genomförandeväsentlighet (kr)<input name="performance" inputMode="decimal" defaultValue={krIn(w.performance)} placeholder="75 %" /></label>
            <label>Obetydlighetsgräns (kr)<input name="trivial" inputMode="decimal" defaultValue={krIn(w.trivial)} placeholder="5 %" /></label>
            <div style={{ flex: '0 0 auto' }}><button className="secondary">Spara</button></div>
            <span className="small muted">Väsentligheten är gräns för urvalet över väsentlighetsbeloppet; genomförandeväsentligheten är intervallet i det beloppsviktade urvalet; fel under obetydlighetsgränsen behöver inte samlas.</span>
          </Post>
          <Post url={url} eid={w.id} op="sample" className="card row new-sample" style={{ alignItems: 'end' }}>
            <label>Urval<select name="method">{Object.entries(SAMPLE_LABEL).map(([k, l]) => <option key={k} value={k}>{l}</option>)}</select></label>
            <label style={{ flex: '0 0 110px' }}>Antal (högst)<input name="count" inputMode="numeric" defaultValue="10" /></label>
            <label style={{ flex: '0 0 120px' }}>Konto från<input name="from" inputMode="numeric" placeholder="T.ex. 5000" /></label>
            <label style={{ flex: '0 0 120px' }}>Konto till<input name="to" inputMode="numeric" placeholder="T.ex. 5999" /></label>
            <label>Användare<select name="user_id" defaultValue=""><option value="">–</option>{users.map((u) => <option key={u.id} value={u.id}>{u.name}</option>)}</select></label>
            <div style={{ flex: '0 0 auto' }}><button>Lägg till i stickprovet</button></div>
          </Post>
        </>
      )}
      {w.samples.length === 0 ? <p className="muted">Inga stickprov än.</p> : (
        <table className="samples">
          <thead><tr><th>Verifikation</th><th>Datum</th><th>Text</th><th className="num">Belopp</th><th>Underlag</th><th>Urval</th><th>Status</th></tr></thead>
          <tbody>{w.samples.map((s) => (
            <tr key={s.id} id={`s${s.id}`}>
              <td><Link href={`${b}/verifikationer/${s.voucher_id}`}>{s.label}</Link></td><td>{s.date}</td><td>{s.text}</td><td className="num">{kr(s.amount)}</td>
              <td>{s.attachments ? `${s.attachments} st` : <span style={{ color: 'var(--danger)' }}>Saknas</span>}</td><td className="small">{s.reason}</td>
              <td><span className={`badge ${ST[s.status][1]}`}>{ST[s.status][0]}</span>{s.sent && <span className="small muted"> · skickad</span>}{s.comment && <div className="small">{s.comment}</div>}
                {edit && <Review url={url} eid={w.id} op="review" extra={{ sample: s.id }} status={s.status} comment={s.comment} label={`Granskning av ${s.label}`} />}</td>
            </tr>
          ))}</tbody>
        </table>
      )}

      <h2 id="reskontra">Reskontror per balansdagen</h2>
      <p className="small muted">Stickprov ur kund- och leverantörsreskontran på öppna poster per {w.end}. Betalningar efter balansdagen visas som underlag; övriga poster stäms av mot saldobekräftelse eller bedöms som osäkra.</p>
      {edit && <Post url={url} eid={w.id} op="ledger_sample" className="card row ledger-sample" style={{ alignItems: 'end' }}>
        <label>Reskontra<select name="kind"><option value="customer">Kundfordringar</option><option value="supplier">Leverantörsskulder</option></select></label>
        <label>Urval<select name="method"><option value="mus">Beloppsviktat (MUS)</option><option value="largest">Största posterna</option><option value="random">Slumpmässigt</option></select></label>
        <label style={{ flex: '0 0 110px' }}>Antal (högst)<input name="count" inputMode="numeric" defaultValue="10" /></label>
        <div style={{ flex: '0 0 auto' }}><button>Lägg till ur reskontran</button></div>
      </Post>}
      {!isAuditor && ledgerRemarks.length > 0 && <section className="card remarks"><b>Anmärkningar på reskontran</b><ul>{ledgerRemarks.map((l) => <li key={l.id}>{l.kind === 'customer' ? 'Kundfaktura' : 'Leverantörsfaktura'} {l.ref} {l.party}: {l.comment}</li>)}</ul></section>}
      {w.ledger.length > 0 && <table className="ledger-samples">
        <thead><tr><th>Reskontra</th><th>Faktura</th><th>Part</th><th>Förfallen</th><th className="num">Öppet per balansdagen</th><th>Underlag</th><th>Urval</th><th>Status</th></tr></thead>
        <tbody>{w.ledger.map((l) => (
          <tr key={l.id} id={`l${l.id}`} className={`ledger-row ${l.kind}`}>
            <td>{l.kind === 'customer' ? 'Kund' : 'Leverantör'}</td>
            <td><Link href={`${b}/${l.kind === 'customer' ? 'fakturor' : 'leverantorsfakturor'}/${l.ref_id}`}>{l.ref}</Link></td><td>{l.party}</td><td>{l.due}</td><td className="num">{kr(l.open_amount)}</td>
            <td className={`small evidence ${l.evidence.status}`}>{l.evidence.text}</td><td className="small">{l.reason}</td>
            <td><span className={`badge ${ST[l.status][1]}`}>{ST[l.status][0]}</span>{l.sent && <span className="small muted"> · skickad</span>}{l.comment && <div className="small">{l.comment}</div>}
              {edit && <Review url={url} eid={w.id} op="ledger_review" extra={{ sample: l.id }} status={l.status} comment={l.comment} label={`Granskning av faktura ${l.ref}`} />}</td>
          </tr>))}</tbody>
      </table>}

      <h2>Kontrollpunkter</h2>
      {w.checkpoints.map((c) => (
        <section key={c.key} id={`k-${c.key}`} className="card checkpoint">
          <div className="header" style={{ marginBottom: '.2rem' }}><b>{c.title}</b><span className={`badge ${ST[c.status][1]}`}>{ST[c.status][0]}</span></div>
          <div className="small muted">{c.hint}{c.balance != null && ` Saldo på balansdagen (${c.from}–${c.to}): ${kr(c.balance)}.`}</div>
          {c.hints.map((h) => <div key={h} className="small" style={{ color: 'var(--warn)' }}>⚠ {h}</div>)}
          {c.comment && <div className="small">{c.comment}{c.sent && <span className="muted"> · skickad</span>}</div>}
          {edit && <Review url={url} eid={w.id} op="checkpoint" extra={{ key: c.key }} status={c.status} comment={c.comment} label={c.title} />}
        </section>
      ))}

      {edit && (
        <>
          <Post url={url} eid={w.id} op="send" className="actions"><button className="secondary">Skicka anmärkningar till bolaget{unsent ? ` (${unsent})` : ''}</button></Post>
          <Post url={url} eid={w.id} op="close" className="card stack">
            <label>Sammanfattning och slutsats (underlag för revisionsberättelsen)<textarea name="conclusion" rows={4} defaultValue={w.conclusion} /></label>
            <div><button>Avsluta granskningen</button></div>
          </Post>
        </>
      )}
      {!open && w.conclusion && <section className="card"><b>Revisorns sammanfattning</b><p style={{ whiteSpace: 'pre-wrap' }}>{w.conclusion}</p></section>}
    </div>
  );
}
