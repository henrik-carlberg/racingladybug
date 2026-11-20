import Link from 'next/link';
import { requireCompany } from '@/lib/server/auth';
import { Flash, type SP } from '@/components/ui';
import { PrintButton } from '@/components/PrintButton';
import { kr, today } from '@/lib/format';
import { fmtRanges, issueEntries } from '@/lib/shares';
import { getRegister, subscriptions } from '@/lib/services/shares';
import { decide, init, minutes, pay, register, sub, transfer } from './actions';

export const dynamic = 'force-dynamic';
const ST: Record<string, string> = { decided: 'Beslutad – teckning pågår', paid: 'Inbetald – väntar på registrering', registered: 'Registrerad', cancelled: 'Avbruten' };
const pct = (n: number) => `${n.toLocaleString('sv-SE', { maximumFractionDigits: 2 })} %`;

export default async function ShareRegister({ params, searchParams }: { params: Promise<{ cid: string }>; searchParams: SP }) {
  const { cid } = await params;
  const ctx = await requireCompany(cid, { perm: 'ledger' });
  const id = ctx.company.id, owner = ctx.role === 'owner';
  const r = await getRegister(id);
  const subs = new Map(await Promise.all(r.issues.filter((i) => i.status !== 'registered').map(async (i) => [i.id, await subscriptions(id, i.id)] as const)));
  return (
    <div style={{ maxWidth: 1000 }}>
      <div className="header"><h1>Aktiebok</h1>{r.settings && <PrintButton label="Skriv ut aktieboken" />}</div>
      <p className="muted no-print">Aktieboken visar varje aktieägare med aktienummer och när aktierna förvärvades (aktiebolagslagen 5 kap.). Den ska hållas tillgänglig för alla och uppdateras vid varje överlåtelse och nyemission.</p>
      <Flash searchParams={searchParams} />
      {!r.settings ? (owner ? (
        <form action={init.bind(null, id)} className="card stack">
          <b>Lägg upp aktieboken</b>
          <div className="row"><label>Aktiekapital (kr)<input name="share_capital" inputMode="decimal" defaultValue="25000" required /></label><label>Per datum<input type="date" name="date" defaultValue={today()} /></label></div>
          {[0, 1, 2, 3].map((i) => (
            <div key={i} className="row">
              <label style={{ flex: '2 1 200px' }}>Ägare {i + 1}<input name={`name_${i}`} required={i === 0} /></label>
              <label>Person-/orgnr<input name={`id_${i}`} /></label>
              <label style={{ flex: '2 1 200px' }}>Adress<input name={`address_${i}`} /></label>
              <label>Antal aktier<input name={`shares_${i}`} type="number" min={1} required={i === 0} /></label>
              <label>Slag<select name={`class_${i}`}><option value="B">B</option><option value="A">A</option></select></label>
            </div>
          ))}
          <div><button>Lägg upp aktieboken</button></div>
          <p className="small muted" style={{ margin: 0 }}>Aktierna numreras från 1 i den ordning ägarna står. A-aktier har 10 röster, B-aktier 1 röst. Finns bara ett aktieslag väljer du B.</p>
        </form>
      ) : <p>Ägaren lägger upp aktieboken.</p>) : (<>
        <div className="grid">
          <div className="card stat"><div className="label">Aktiekapital</div><div className="value share-capital">{kr(r.settings.share_capital)}</div></div>
          <div className="card stat"><div className="label">Antal aktier</div><div className="value total-shares">{r.settings.total_shares.toLocaleString('sv-SE')}</div></div>
          <div className="card stat"><div className="label">Kvotvärde</div><div className="value">{kr(r.quota)}</div></div>
        </div>
        <div className="table-wrap"><table className="register">
          <thead><tr><th>Aktieägare</th><th>Person-/orgnr</th><th>Aktienummer</th><th className="num">Antal</th><th className="num">Kapital</th><th className="num">Röster</th><th>Sedan</th></tr></thead>
          <tbody>{r.holders.map((h) => (
            <tr key={h.key} className="holder"><td><b>{h.name}</b>{h.address && <div className="small muted">{h.address}</div>}</td><td>{h.holder_id}</td>
              <td className="small">{h.a.length > 0 && <>A: {fmtRanges(h.a)}<br /></>}{h.b.length > 0 && <>{h.a.length > 0 ? 'B: ' : ''}{fmtRanges(h.b)}</>}</td>
              <td className="num">{h.shares.toLocaleString('sv-SE')}</td><td className="num">{pct(h.pct)}</td><td className="num">{pct(h.votePct)}</td><td>{h.since}</td></tr>
          ))}</tbody>
        </table></div>

        {owner && (<div className="no-print">
          <h2>Överlåtelse</h2>
          <form action={transfer.bind(null, id)} className="card stack">
            <div className="row">
              <label>Säljare<select name="from">{r.holders.map((h) => <option key={h.key} value={h.key}>{h.name} ({h.shares} st)</option>)}</select></label>
              <label>Slag<select name="share_class"><option value="B">B</option><option value="A">A</option></select></label>
              <label>Antal aktier<input name="shares" type="number" min={1} required /></label>
              <label>Datum<input type="date" name="date" defaultValue={today()} /></label>
            </div>
            <div className="row"><label style={{ flex: '2 1 200px' }}>Köpare<input name="to_name" required /></label><label>Person-/orgnr<input name="to_id" /></label>
              <label style={{ flex: '2 1 200px' }}>Adress<input name="to_address" /></label><label>Typ<select name="kind"><option value="sale">Försäljning</option><option value="gift">Gåva</option><option value="inheritance">Arv</option></select></label>
              <label>Pris totalt (kr)<input name="price" inputMode="decimal" /></label></div>
            <p className="small muted" style={{ margin: 0 }}>Vid försäljning blir köpeskillingen köparens omkostnadsbelopp. Vid gåva och arv tar mottagaren över omkostnadsbeloppet och det sparade utdelningsutrymmet (K10) för aktierna.</p>
            <div><button className="secondary">För in överlåtelsen</button></div>
            <p className="small muted" style={{ margin: 0 }}>Säljarens lägsta aktienummer överlåts. Kontrollera hembud, förköp och samtyckesförbehåll i bolagsordningen.</p>
          </form>

          <h2>Nyemission</h2>
          {r.issues.map((i) => {
            const e = issueEntries({ newShares: i.new_shares, pricePerShare: i.price, quota: r.quota });
            return (
              <div key={i.id} className="card stack issue" data-status={i.status}>
                <div><b>{i.new_shares} {i.share_class}-aktier à {kr(i.price)} kr</b> · beslut {i.decided_on} · <span className="badge">{ST[i.status]}</span>
                  {i.document_id && <> · <Link href={`/c/${id}/dokument/${i.document_id}`}>Protokoll</Link></>}</div>
                <div className="small">Totalt {kr(e.total)} kr: aktiekapital {kr(e.capital)} kr, överkurs {kr(e.premium)} kr. Tecknat {i.subscribed} av {i.new_shares}.</div>
                {subs.get(i.id)?.length ? <table className="small"><tbody>{subs.get(i.id)!.map((s) => <tr key={s.id}><td>{s.name}</td><td>{s.holder_id}</td><td className="num">{s.shares} st</td></tr>)}</tbody></table> : null}
                {i.status === 'decided' && i.subscribed < i.new_shares && (
                  <form action={sub.bind(null, id, i.id)} className="row" style={{ alignItems: 'end' }}>
                    <label style={{ flex: '2 1 200px' }}>Tecknare<input name="name" required /></label><label>Person-/orgnr<input name="holder_id" /></label>
                    <label>Antal<input name="shares" type="number" min={1} required /></label><div style={{ flex: '0 0 auto' }}><button className="secondary">För in teckning</button></div>
                  </form>
                )}
                {i.status === 'decided' && i.subscribed === i.new_shares && (
                  <form action={pay.bind(null, id, i.id)} className="row" style={{ alignItems: 'end' }}><label>Betald<input type="date" name="date" defaultValue={today()} /></label>
                    <div style={{ flex: '0 0 auto' }}><button>Bokför inbetalningen</button></div></form>
                )}
                {i.status === 'paid' && (<>
                  <div className="small card bv">Underlag till Bolagsverket (anmälan om nyemission): beslut {i.decided_on}, {i.new_shares} nya {i.share_class}-aktier, teckningskurs {kr(i.price)} kr,
                    aktiekapitalet ökar från {kr(r.settings!.share_capital)} kr till {kr(r.settings!.share_capital + e.capital)} kr och antalet aktier från {r.settings!.total_shares} till {r.settings!.total_shares + i.new_shares}.
                    Bifoga protokollet, teckningslistan och bankintyg om inbetalningen.</div>
                  <form action={register.bind(null, id, i.id)} className="row" style={{ alignItems: 'end' }}><label>Registrerad hos Bolagsverket<input type="date" name="date" defaultValue={today()} /></label>
                    <div style={{ flex: '0 0 auto' }}><button>Registrerad – uppdatera aktieboken</button></div></form>
                </>)}
              </div>
            );
          })}
          <form action={decide.bind(null, id)} className="card row" style={{ alignItems: 'end' }}>
            <label>Nya aktier<input name="new_shares" type="number" min={1} required /></label><label>Teckningskurs per aktie (kr)<input name="price" inputMode="decimal" required /></label>
            <label>Slag<select name="share_class"><option value="B">B</option><option value="A">A</option></select></label><label>Beslutsdatum<input type="date" name="date" defaultValue={today()} /></label>
            <div style={{ flex: '0 0 auto' }}><button className="secondary">Besluta om nyemission</button></div>
          </form>

          <h2>Styrelseprotokoll</h2>
          <form action={minutes.bind(null, id)} className="card stack">
            <div className="row"><label>Datum<input type="date" name="date" defaultValue={today()} /></label><label>Plats<input name="place" /></label><label style={{ flex: '2 1 240px' }}>Närvarande<input name="present" required /></label></div>
            <label>Beslut och punkter (en per rad)<textarea name="items" rows={4} required /></label>
            {[0, 1, 2].map((i) => <div key={i} className="row"><label>Justeras av<input name={`sname_${i}`} required={i === 0} /></label><label>E-post<input name={`semail_${i}`} type="email" required={i === 0} /></label></div>)}
            <div><button className="secondary">Skicka för e-signering</button></div>
          </form>
        </div>)}

        {r.events.length > 0 && (<>
          <h2>Händelser</h2>
          <table className="small events"><tbody>{r.events.map((e, i) => <tr key={i}><td>{e.date}</td><td>{e.text}</td></tr>)}</tbody></table>
        </>)}
      </>)}
    </div>
  );
}
