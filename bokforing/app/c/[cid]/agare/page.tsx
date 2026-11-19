import Link from 'next/link';
import { sql } from '@/lib/db';
import { requireCompany } from '@/lib/server/auth';
import { Flash, EmptyState, type SP } from '@/components/ui';
import { Help } from '@/components/Help';
import { PayoutCalculator } from '@/components/PayoutCalculator';
import { kr, today } from '@/lib/format';
import { defaultParams, k10, stateThresholdFor } from '@/lib/k10';
import { dividendStatus, k10Basis, ku31, listOwners } from '@/lib/services/owners';
import { decide, pay, removeOwner, saveOwner } from './actions';

export const dynamic = 'force-dynamic';

export default async function Owners({ params, searchParams }: { params: Promise<{ cid: string }>; searchParams: SP }) {
  const { cid } = await params;
  const { company } = await requireCompany(cid, { perm: 'ledger' });
  const b = `/c/${company.id}`;
  if (company.company_type !== 'AB') {
    return <div style={{ maxWidth: 760 }}><h1>Ägare och utdelning</h1><EmptyState icon="briefcase" title="Gäller aktiebolag">I en enskild firma tar du ut pengar som eget uttag och beskattas för hela vinsten. 3:12-reglerna och utdelning gäller aktiebolag.</EmptyState></div>;
  }
  const sp = await searchParams;
  const year = Number(sp.year) || Number(today().slice(0, 4));
  const owners = await listOwners(company.id);
  const params0 = defaultParams(year);
  const k10s = await Promise.all(owners.map(async (o) => ({ o, basis: await k10Basis(company.id, year, o) })));
  const results = k10s.map(({ o, basis }) => ({ o, basis, r: k10(params0, { share: o.share_pct, costBasis: o.cost_basis, savedSpace: o.saved_space, ...basis }) }));
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

      <h2>Gränsbelopp (K10) för inkomstår {year}</h2>
      <div className="actions">{[year - 1, year, year + 1].map((y) => <Link key={y} className={`btn ${y === year ? '' : 'secondary'}`} href={`${b}/agare?year=${y}`}>{y}</Link>)}</div>
      {results.map(({ o, basis, r }) => (
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
            <tr><td>Sparat utdelningsutrymme{params0.newRules ? '' : ' (uppräknat)'}</td><td className="num">{kr(r.savedUplifted)}</td></tr>
            <tr className="sum"><td>Gränsbelopp</td><td className="num">{kr(r.limit)}</td></tr>
          </tbody></table>
          {r.notes.map((n) => <p key={n} className="small muted" style={{ margin: '.25rem 0' }}>{n}</p>)}
        </section>
      ))}
      {owners.length > 0 && <p className="small muted">Inkomstbasbelopp {params0.ibb.toLocaleString('sv-SE')} kr, statslåneränta {String(params0.slr).replace('.', ',')} %. Kontrollera beloppen mot Skatteverkets K10-blankett för inkomståret innan du deklarerar.</p>}

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
