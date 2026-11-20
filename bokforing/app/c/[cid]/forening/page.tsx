import Link from 'next/link';
import { requireCompany } from '@/lib/server/auth';
import { Flash, type SP } from '@/components/ui';
import { kr, today } from '@/lib/format';
import { isAssociation, overview } from '@/lib/services/association';
import { addMember, auditReport, gift, invoiceFees, leave, meeting, notice, rate, report, toggle } from './actions';

export const dynamic = 'force-dynamic';
const ST: Record<string, string> = { draft: 'Utkast', sent: 'Obetald', booked: 'Obetald', partially_paid: 'Delbetald', paid: 'Betald', credited: 'Krediterad' };

export default async function Association({ params, searchParams }: { params: Promise<{ cid: string }>; searchParams: SP }) {
  const { cid } = await params;
  const sp = await searchParams;
  const ctx = await requireCompany(cid, { perm: 'ledger' });
  const id = ctx.company.id, owner = ctx.role === 'owner';
  const on = await isAssociation(id);
  const y = Number(String(sp.ar ?? '').slice(0, 4)) || Number(today().slice(0, 4));
  if (!on) return (
    <div style={{ maxWidth: 800 }}>
      <h1>Förening</h1><Flash searchParams={searchParams} />
      <p>Föreningsläget anpassar bokföringen för ideella föreningar: årets resultat förs till 2069 och balanseras på 2068 enligt årsmötets beslut, medlemsavgifter (3890), bidrag (3980) och gåvor (3985) är momsfria och du får medlemsregister och årsmöteshandlingar.</p>
      {owner ? <form action={toggle.bind(null, id, true)}><button className="enable-association">Slå på föreningsläget</button></form> : <p className="muted">Ägaren slår på föreningsläget.</p>}
    </div>
  );
  const o = await overview(id, y);
  const active = o.members.filter((m) => !m.left_on);
  const unpaid = o.fees.filter((f) => f.status !== 'paid' && f.status !== 'credited');
  const restricted = o.gifts.filter((g) => g.restricted).reduce((s, g) => s + g.amount, 0);
  const cats = [...new Set(['Ordinarie', ...o.members.map((m) => m.category)])];
  return (
    <div style={{ maxWidth: 1000 }}>
      <div className="header"><h1>Förening {y}</h1>
        <div className="row"><Link href={`?ar=${y - 1}`}>← {y - 1}</Link><Link href={`?ar=${y + 1}`}>{y + 1} →</Link></div></div>
      <Flash searchParams={searchParams} />
      <div className="grid">
        <div className="card stat"><div className="label">Medlemmar</div><div className="value member-count">{o.stats.total}</div><div className="small muted">{o.stats.joined} nya, {o.stats.left} har lämnat i år</div></div>
        <div className="card stat"><div className="label">Aviserade avgifter</div><div className="value">{kr(o.fees.reduce((s, f) => s + f.amount, 0))}</div><div className="small muted unpaid-count">{unpaid.length} obetalda</div></div>
        <div className="card stat"><div className="label">Gåvor och bidrag</div><div className="value gift-total">{kr(o.gifts.reduce((s, g) => s + g.amount, 0))}</div>{restricted > 0 && <div className="small muted">varav ändamålsbestämt {kr(restricted)}</div>}</div>
        {o.figures && <div className="card stat"><div className="label">Årets resultat</div><div className="value">{kr(o.figures.result)}</div></div>}
      </div>

      <h2>Medlemsregister</h2>
      <div className="table-wrap"><table className="members">
        <thead><tr><th>Nr</th><th>Namn</th><th>Kategori</th><th>E-post</th><th>Inträde</th><th>Utträde</th><th></th></tr></thead>
        <tbody>{o.members.map((m) => (
          <tr key={m.id} className="member"><td>{m.member_no}</td><td>{m.name}</td><td>{m.category}</td><td>{m.email}</td><td>{m.joined}</td><td>{m.left_on ?? ''}</td>
            <td>{!m.left_on && <form action={leave.bind(null, id, m.id)} className="row"><input type="date" name="left_on" defaultValue={today()} aria-label="Utträdesdatum" /><button className="secondary">Utträde</button></form>}</td></tr>
        ))}</tbody>
      </table></div>
      <form action={addMember.bind(null, id)} className="card stack">
        <b>Ny medlem</b>
        <div className="row"><label>Namn<input name="name" required /></label><label>E-post<input name="email" type="email" /></label><label>Telefon<input name="phone" /></label></div>
        <div className="row"><label style={{ flex: '2 1 240px' }}>Adress<input name="address" /></label><label>Kategori<input name="category" list="cats" defaultValue="Ordinarie" /></label><label>Inträde<input type="date" name="joined" defaultValue={today()} /></label></div>
        <datalist id="cats">{cats.map((c) => <option key={c} value={c} />)}</datalist>
        <div><button>Lägg till medlem</button></div>
      </form>

      <h2>Medlemsavgifter {y}</h2>
      <div className="row" style={{ alignItems: 'flex-start' }}>
        <div className="card stack" style={{ flex: '1 1 300px' }}>
          <b>Avgift per kategori</b>
          {o.rates.map((r) => <div key={r.category} className="row fee-rate"><span>{r.category}</span><b>{kr(r.amount)}</b></div>)}
          <form action={rate.bind(null, id)} className="row"><input type="hidden" name="year" value={y} />
            <label>Kategori<input name="category" list="cats" defaultValue="Ordinarie" /></label><label>Avgift (kr)<input name="amount" inputMode="decimal" required /></label><button className="secondary">Spara</button></form>
        </div>
        <form action={invoiceFees.bind(null, id)} className="card stack" style={{ flex: '1 1 300px' }}>
          <b>Avisera årets avgift</b><input type="hidden" name="year" value={y} />
          <label>Fakturadatum<input type="date" name="invoice_date" defaultValue={today()} /></label>
          <p className="small muted" style={{ margin: 0 }}>En momsfri faktura med OCR per aktiv medlem som inte redan aviserats. Betalningar via Swish, autogiro eller bankgiro matchas mot OCR-numret och bokförs automatiskt.</p>
          <div><button>Avisera {active.length} medlemmar</button></div>
        </form>
      </div>
      {o.fees.length > 0 && <div className="table-wrap"><table className="fees">
        <thead><tr><th>Nr</th><th>Medlem</th><th className="num">Avgift</th><th>Faktura</th><th>OCR</th><th>Status</th></tr></thead>
        <tbody>{o.fees.map((f) => (
          <tr key={f.member_no} className="fee"><td>{f.member_no}</td><td>{f.name}</td><td className="num">{kr(f.amount)}</td>
            <td>{f.invoice_id && <Link href={`/c/${id}/fakturor/${f.invoice_id}`}>{f.invoice_number ?? 'utkast'}</Link>}</td><td>{f.ocr}</td><td className="fee-status">{ST[f.status ?? ''] ?? f.status}</td></tr>
        ))}</tbody>
      </table></div>}

      <h2>Gåvor och bidrag</h2>
      {o.gifts.length > 0 && <div className="table-wrap"><table className="gifts">
        <thead><tr><th>Datum</th><th>Typ</th><th>Från</th><th>Ändamål</th><th className="num">Belopp</th><th></th></tr></thead>
        <tbody>{o.gifts.map((g) => (
          <tr key={g.id} className="gift"><td>{g.date}</td><td>{g.kind === 'grant' ? 'Bidrag' : 'Gåva'}</td><td>{g.donor}</td><td>{g.purpose}{g.restricted && <span className="badge"> ändamålsbestämt</span>}</td>
            <td className="num">{kr(g.amount)}</td><td>{g.voucher_id && <Link href={`/c/${id}/verifikationer/${g.voucher_id}`}>Verifikation</Link>}</td></tr>
        ))}</tbody>
      </table></div>}
      <form action={gift.bind(null, id)} className="card stack">
        <div className="row"><label>Typ<select name="kind"><option value="gift">Gåva (3985)</option><option value="grant">Bidrag (3980)</option></select></label>
          <label>Från<input name="donor" required /></label><label>Belopp (kr)<input name="amount" inputMode="decimal" required /></label><label>Datum<input type="date" name="date" defaultValue={today()} /></label></div>
        <div className="row"><label style={{ flex: '2 1 240px' }}>Ändamål<input name="purpose" /></label><label className="check"><input type="checkbox" name="restricted" /> Ändamålsbestämt</label></div>
        <div><button>Bokför</button></div>
      </form>

      <h2>Årsmöte för verksamhetsåret {y}</h2>
      <form action={meeting.bind(null, id)} className="card row"><input type="hidden" name="year" value={y} />
        <label>Datum<input type="date" name="date" defaultValue={o.meeting?.date ?? `${y + 1}-03-15`} required /></label>
        <label>Tid<input name="time" defaultValue={o.meeting?.time ?? '18:00'} /></label>
        <label style={{ flex: '2 1 240px' }}>Plats<input name="place" defaultValue={o.meeting?.place ?? ''} required /></label>
        <button className="secondary">Spara årsmötet</button>
      </form>
      {o.meeting && (<div className="stack">
        <div className="card stack">
          <b>Kallelse</b>
          <p className="small" style={{ margin: 0 }}>Kallelsen ska skickas senast <b className="notice-deadline">{o.meeting.deadline}</b> (två veckor före mötet, om stadgarna inte säger annat).</p>
          {o.meeting.notice_sent_at ? <p className="notice-sent" style={{ margin: 0 }}>Skickad {o.meeting.notice_sent_at.slice(0, 10)} till {o.meeting.notice_count} medlemmar.</p> : (
            <form action={notice.bind(null, id)} className="stack"><input type="hidden" name="year" value={y} />
              <label>Meddelande i kallelsen<textarea name="extra" rows={2} /></label>
              <div><button>Skicka kallelse till {active.filter((m) => m.email).length} medlemmar</button></div></form>)}
        </div>
        <div className="row" style={{ alignItems: 'flex-start' }}>
          <form action={report.bind(null, id)} className="card stack" style={{ flex: '1 1 380px' }}><input type="hidden" name="year" value={y} />
            <b>Verksamhetsberättelse med resultat- och balansräkning</b>
            {o.meeting.report_doc_id ? <Link href={`/c/${id}/dokument/${o.meeting.report_doc_id}`}>Visa verksamhetsberättelsen</Link> : <>
              <label>Årets verksamhet<textarea name="text" rows={5} placeholder="Vad föreningen gjort under året" /></label>
              {[0, 1, 2].map((i) => <div key={i} className="row"><label>Styrelseledamot {i + 1}<input name={`board_name_${i}`} required={i === 0} /></label><label>E-post<input type="email" name={`board_email_${i}`} /></label></div>)}
              <div><button>Skapa för underskrift</button></div></>}
          </form>
          <form action={auditReport.bind(null, id)} className="card stack" style={{ flex: '1 1 380px' }}><input type="hidden" name="year" value={y} />
            <b>Revisionsberättelse</b>
            {o.meeting.audit_doc_id ? <Link href={`/c/${id}/dokument/${o.meeting.audit_doc_id}`}>Visa revisionsberättelsen</Link> : <>
              {[0, 1].map((i) => <div key={i} className="row"><label>Revisor {i + 1}<input name={`auditor_name_${i}`} required={i === 0} /></label><label>E-post<input type="email" name={`auditor_email_${i}`} /></label></div>)}
              <label>Anmärkningar<textarea name="remarks" rows={2} /></label>
              <div><button>Skapa för underskrift</button></div></>}
          </form>
        </div>
      </div>)}
      {owner && <form action={toggle.bind(null, id, false)} style={{ marginTop: 32 }}><button className="secondary">Stäng av föreningsläget</button></form>}
    </div>
  );
}
