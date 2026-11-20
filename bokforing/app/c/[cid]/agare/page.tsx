import { redirect } from 'next/navigation';
import Link from 'next/link';
import { sql } from '@/lib/db';
import { requireCompany } from '@/lib/server/auth';
import { Flash, EmptyState, type SP } from '@/components/ui';
import { Help } from '@/components/Help';
import { PayoutCalculator } from '@/components/PayoutCalculator';
import { kr, today } from '@/lib/format';
import { defaultParams, stateThresholdFor } from '@/lib/k10';
import { dividendStatus, ku31, listOwners } from '@/lib/services/owners';
import { createInsurance, decide, insuranceValue, pay, premium, removeOwner, saveK10, saveOwner } from './actions';
import { insurances, k10Year } from '@/lib/services/closely-held';
import { dividendPlan } from '@/lib/closely-held';
import { parseAmount } from '@/lib/money';

export const dynamic = 'force-dynamic';

export default async function Owners({ params, searchParams }: { params: Promise<{ cid: string }>; searchParams: SP }) {
  const { cid } = await params;
  // Sidan visar lönesumman och ägarnas egna löner, så behörighet till både bokföring och lön krävs
  const { company } = await requireCompany(cid, { perm: 'ledger' });
  await requireCompany(cid, { perm: 'payroll' });
  const b = `/c/${company.id}`;
  if (company.company_type === 'HB' || company.company_type === 'KB') redirect(`/c/${company.id}/delagare`);
  if (company.company_type !== 'AB') {
    return <div style={{ maxWidth: 760 }}><h1>Ägare och utdelning</h1><EmptyState icon="briefcase" title="Gäller aktiebolag">I en enskild firma tar du ut pengar som eget uttag och beskattas för hela vinsten. 3:12-reglerna och utdelning gäller aktiebolag.</EmptyState></div>;
  }
  const sp = await searchParams;
  const year = Number(sp.year) || Number(today().slice(0, 4));
  const owners = await listOwners(company.id);
  const params0 = defaultParams(year);
  // Sparat utdelningsutrymme hämtas från förra årets sparade K10 (annars det som angetts på ägaren)
  const results = await k10Year(company.id, year);
  const planTotal = parseAmount(String(sp.plan ?? '')) ?? 0;
  const plan = dividendPlan(planTotal, results.map(({ o, r }) => ({ id: o.id, name: o.name, share: o.share_pct, limit: r.limit })));
  const ins = await insurances(company.id, year);
  const status = await dividendStatus(company.id);
  const ku = await ku31(company.id, year);
  const [res] = await sql<{ v: number }[]>`
    SELECT COALESCE(SUM(l.credit - l.debit), 0)::bigint AS v FROM voucher_lines l JOIN vouchers v ON v.id = l.voucher_id JOIN fiscal_years f ON f.id = v.fiscal_year_id
    WHERE v.company_id = ${company.id} AND l.account_number BETWEEN 3000 AND 8799 AND ${today()}::date BETWEEN f.start_date AND f.end_date`;
  const mainLimit = results[0]?.r.limit ?? 0;
  const ownerForm = (o?: (typeof owners)[number]) => (
    <form action={saveOwner.bind(null, company.id, o?.id ?? null)} className="row" style={{ alignItems: 'end' }}>
      <label style={{ flex: '2 1 180px' }}>Namn<input name="name" defaultValue={o?.name} required /></label>
      <label>Personnummer<input name="personal_number" defaultValue={o?.personal_number} placeholder="ÅÅÅÅMMDD-NNNN" /></label>
      <label style={{ flex: '0 0 110px' }}>Ägarandel (%)<input name="share_pct" defaultValue={o ? String(o.share_pct).replace('.', ',') : ''} inputMode="decimal" required /></label>
      <label>Omkostnadsbelopp (kr)<input name="cost_basis" defaultValue={o ? (o.cost_basis / 100).toString() : '25000'} inputMode="decimal" /></label>
      <label>Sparat utdelningsutrymme (kr)<input name="saved_space" defaultValue={o ? (o.saved_space / 100).toString() : '0'} inputMode="decimal" /></label>
      <div style={{ flex: '0 0 auto' }}><button className={o ? 'secondary' : ''}>{o ? 'Spara' : 'Lägg till ägare'}</button></div>
    </form>
  );
  return (
    <div style={{ maxWidth: 1000 }}>
      <h1>Ägare, lön och utdelning <Help term="k10" /></h1>
      <Flash searchParams={searchParams} />
      <p className="muted">Räkna ut hur mycket utdelning som beskattas med 20 % (gränsbeloppet enligt 3:12-reglerna), jämför lön och utdelning och bokför utdelningen.</p>

      <h2>Aktieägare</h2>
      <div className="card stack">
        {owners.map((o) => (
          <details key={o.id}>
            <summary><b>{o.name}</b> · {String(o.share_pct).replace('.', ',')} % {o.personal_number && <span className="small muted">· {o.personal_number}</span>}</summary>
            <div style={{ marginTop: '.5rem' }}>{ownerForm(o)}<form action={removeOwner.bind(null, company.id, o.id)}><button className="link small">Ta bort ägaren</button></form></div>
          </details>
        ))}
        {owners.length === 0 && <p className="small muted" style={{ margin: 0 }}>Lägg upp ägarna. Omkostnadsbeloppet är vad aktierna kostade (oftast aktiekapitalet vid start). Sparat utdelningsutrymme står på förra årets K10.</p>}
        {ownerForm()}
      </div>

      <h2 id="k10">Gränsbelopp (K10) för inkomstår {year}</h2>
      <div className="actions">{[year - 1, year, year + 1].map((y) => <Link key={y} className={`btn ${y === year ? '' : 'secondary'}`} href={`${b}/agare?year=${y}`}>{y}</Link>)}</div>
      {results.map(({ o, basis, r, saved, stored, history }) => (
        <section key={o.id} className="card k10">
          <h3 style={{ marginTop: 0 }}>{o.name}</h3>
          <div className="grid">
            <div className="card stat"><div className="label">Gränsbelopp {year}</div><div className="value">{kr(r.limit)}</div><div className="small muted">utdelning upp till detta beskattas med 20 %</div></div>
            <div className="card stat"><div className="label">Utdelning {year}</div><div className="value">{kr(basis.dividends)}</div><div className="small muted">varav över gränsbeloppet {kr(r.aboveLimit)}</div></div>
            <div className="card stat"><div className="label">Sparas till nästa år</div><div className="value">{kr(r.savedNext)}</div></div>
          </div>
          <table className="small"><tbody>
            <tr><td>{params0.newRules ? 'Grundbelopp (4 inkomstbasbelopp × ägarandel)' : r.rule === 'förenkling' ? 'Förenklingsregeln (2,75 inkomstbasbelopp × ägarandel)' : 'Huvudregeln'}</td><td className="num">{kr(r.basic)}</td></tr>
            {r.capital > 0 && <tr><td>Ränta på omkostnadsbeloppet</td><td className="num">{kr(r.capital)}</td></tr>}
            <tr><td>Lönebaserat utrymme (lönesumma {basis.wages ? kr(basis.wages) : '0'} år {year - 1})</td><td className="num">{kr(r.wageBased)}</td></tr>
            {r.wageRequirementMet !== null && <tr><td>Lönekrav: egen lön {kr(basis.ownSalary)}, krav {kr(r.wageRequirement)}</td><td className="num">{r.wageRequirementMet ? '✓ uppfyllt' : 'Inte uppfyllt'}</td></tr>}
            <tr><td>Sparat utdelningsutrymme{params0.newRules ? '' : ' (uppräknat)'}{saved.from ? <span className="muted"> – från sparad K10 {saved.from}</span> : <span className="muted"> – angivet på ägaren</span>}</td><td className="num saved-in">{kr(r.savedUplifted)}</td></tr>
            <tr className="sum"><td>Gränsbelopp</td><td className="num">{kr(r.limit)}</td></tr>
          </tbody></table>
          {r.notes.map((n) => <p key={n} className="small muted" style={{ margin: '.25rem 0' }}>{n}</p>)}
          {stored && <p className="small">K10 för {year} sparad {stored.saved_at}{stored.limit_amount !== r.limit ? ' – underlaget har ändrats sedan dess, spara igen' : ''}.</p>}
          {history.length > 0 && <table className="small k10-history"><thead><tr><th>År</th><th>Regel</th><th className="num">Gränsbelopp</th><th className="num">Utdelning</th><th className="num">Sparat vidare</th></tr></thead>
            <tbody>{history.map((h) => <tr key={h.year}><td>{h.year}</td><td>{h.rule}</td><td className="num">{kr(h.limit_amount)}</td><td className="num">{kr(h.dividends)}</td><td className="num">{kr(h.saved_next)}</td></tr>)}</tbody></table>}
        </section>
      ))}
      {results.length > 0 && <form action={saveK10.bind(null, company.id, year)} className="actions"><button className="secondary">Spara K10 för {year}</button><span className="small muted">Sparat utdelningsutrymme förs då automatiskt till {year + 1}.</span></form>}

      {results.length > 0 && <>
        <h3 id="plan">Utdelningsplan för ägarna</h3>
        <form className="row" method="get"><input type="hidden" name="year" value={year} /><label>Total utdelning (kr)<input name="plan" defaultValue={planTotal ? String(planTotal / 100) : ''} inputMode="decimal" /></label><button className="secondary">Räkna</button>
          <span className="small muted" style={{ alignSelf: 'center' }}>Största utdelning som ryms inom allas gränsbelopp: <b className="max-within">{kr(plan.maxWithin)}</b> kr</span></form>
        {planTotal > 0 && <table className="plan"><thead><tr><th>Ägare</th><th className="num">Andel</th><th className="num">Utdelning</th><th className="num">Inom gränsbeloppet (20 %)</th><th className="num">Över (tjänst)</th><th className="num">Skatt inom</th></tr></thead>
          <tbody>{plan.rows.map((p) => <tr key={p.id} className="plan-row"><td>{p.name}</td><td className="num">{String(p.share).replace('.', ',')} %</td><td className="num">{kr(p.amount)}</td><td className="num">{kr(p.within)}</td><td className="num above">{kr(p.above)}</td><td className="num">{kr(p.tax)}</td></tr>)}</tbody></table>}
      </>}
      {owners.length > 0 && <p className="small muted">Inkomstbasbelopp {params0.ibb.toLocaleString('sv-SE')} kr, statslåneränta {String(params0.slr).replace('.', ',')} %. Kontrollera beloppen mot Skatteverkets K10-blankett för inkomståret innan du deklarerar.</p>}

      <h2 id="kapitalforsakring">Kapitalförsäkring</h2>
      <p className="small muted">Bolagsägd kapitalförsäkring (t.ex. pantsatt för en pensionsutfästelse till ägaren) tas upp på 1385 till anskaffningsvärdet. Premierna är inte avdragsgilla. Försäkringsbolaget betalar avkastningsskatten (30 % av kapitalunderlaget × statslåneräntan + 1 procentenhet, lägst 1,25 %) och tar den ur försäkringen. Bestående värdenedgång under bokfört värde skrivs ned.</p>
      {ins.map((i) => (
        <section key={i.id} className="card insurance">
          <b>{i.name}</b> <span className="small muted">{i.insurer}{i.policy_no && ` · ${i.policy_no}`}{i.pledged && ` · ${i.pledged}`}</span>
          <div className="grid">
            <div className="stat"><div className="label">Bokfört (1385)</div><div className="value ins-booked">{kr(i.booked)}</div></div>
            <div className="stat"><div className="label">Senaste värde</div><div className="value">{i.latest ? `${kr(i.latest.amount)} (${i.latest.date})` : '–'}</div></div>
            <div className="stat"><div className="label">Avkastningsskatt {year}</div><div className="value ins-tax">{kr(i.yieldTax.tax)}</div><div className="small muted">underlag {kr(i.yieldTax.base)} × {String(i.yieldTax.rate).replace('.', ',')} % × 30 %</div></div>
          </div>
          <div className="row">
            <form action={premium.bind(null, company.id, i.id)} className="row"><label>Premie (kr)<input name="amount" inputMode="decimal" required style={{ width: 110 }} /></label><label>Datum<input type="date" name="date" defaultValue={today()} /></label><button className="secondary">Bokför premie</button></form>
            <form action={insuranceValue.bind(null, company.id, i.id)} className="row"><label>Värde enligt försäkringsbolaget (kr)<input name="value" inputMode="decimal" required style={{ width: 120 }} /></label><label>Per<input type="date" name="date" defaultValue={today()} /></label>
              <label className="check"><input type="checkbox" name="writedown" /> Skriv ned om värdet är lägre</label><button className="secondary">Registrera värde</button></form>
          </div>
          {i.possibleWritedown > 0 && <p className="small" style={{ color: 'var(--warn)' }}>Värdet understiger bokfört värde med {kr(i.possibleWritedown)} kr – skriv ned om nedgången bedöms bestående.</p>}
        </section>))}
      <form action={createInsurance.bind(null, company.id)} className="card row"><label>Namn<input name="name" required /></label><label>Försäkringsbolag<input name="insurer" /></label><label>Försäkringsnummer<input name="policy_no" /></label><label>Pantsatt för<input name="pledged" placeholder="T.ex. pensionsutfästelse till ägaren" /></label><button className="secondary">Ny kapitalförsäkring</button></form>

      <h2>Lön eller utdelning?</h2>
      <div className="card"><PayoutCalculator profit={Number(res.v)} limit={mainLimit} threshold={stateThresholdFor(year) * 100} /></div>

      <h2 id="utdelning">Utdelning</h2>
      <div className="grid">
        <div className="card stat"><div className="label">Fritt eget kapital</div><div className="value">{kr(status.free)}</div><div className="small muted">balanserat resultat och årets resultat</div></div>
        <div className="card stat"><div className="label">Beslutad, inte utbetald (2898)</div><div className="value">{kr(status.unpaid)}</div></div>
      </div>
      <div className="row" style={{ alignItems: 'flex-start' }}>
        <form action={pay.bind(null, company.id)} className="card stack" style={{ flex: '1 1 320px' }}>
          <b>Betala ut utdelning</b>
          <div className="row"><label>Belopp (kr)<input name="amount" defaultValue={status.unpaid > 0 ? (status.unpaid / 100).toString() : ''} inputMode="decimal" required /></label><label>Utbetalningsdag<input type="date" name="date" defaultValue={today()} required /></label></div>
          <label>Från konto<select name="bank_account"><option value="1930">1930 Företagskonto</option><option value="1940">1940 Övriga bankkonton</option></select></label>
          <div><button disabled={status.unpaid <= 0 || owners.length === 0}>Betala ut och bokför</button></div>
          <span className="small muted">Fördelas på ägarna efter ägarandel. Bolaget drar ingen skatt – ägaren betalar 20 % (inom gränsbeloppet) i sin deklaration.</span>
        </form>
        <form action={decide.bind(null, company.id)} className="card stack" style={{ flex: '1 1 320px' }}>
          <b>Utdelning av balanserade vinstmedel</b>
          <span className="small muted">Utdelning av årets vinst beslutas i resultatdispositionen vid bokslutet. Här bokför du beslut från en extra bolagsstämma.</span>
          <div className="row"><label>Belopp (kr)<input name="amount" inputMode="decimal" required /></label><label>Stämmans datum<input type="date" name="date" defaultValue={today()} required /></label></div>
          <div><button className="secondary">Bokför beslutet</button></div>
        </form>
      </div>
      <h3>Kontrolluppgift KU31 för {year}</h3>
      {ku.length === 0 ? <p className="small muted">Ingen utdelning har betalats ut {year}.</p> : (
        <table><thead><tr><th>Mottagare</th><th>Personnummer</th><th className="num">Utdelning</th></tr></thead>
          <tbody>{ku.map((k) => <tr key={k.name + k.personal_number}><td>{k.name}</td><td>{k.personal_number || <span className="badge warn">Saknas</span>}</td><td className="num">{kr(k.amount)}</td></tr>)}</tbody></table>
      )}
      <p className="small muted">Kontrolluppgifter om utdelning (KU31) lämnas till Skatteverket senast den 31 januari året efter utbetalningen.</p>
    </div>
  );
}
