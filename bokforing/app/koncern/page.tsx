import Link from 'next/link';
import { allowedCompanies, requireUser } from '@/lib/server/auth';
import { Flash, type SP } from '@/components/ui';
import { saveLink } from './actions';
import { PrintButton } from '@/components/PrintButton';
import { kr, today } from '@/lib/format';
import { RESULT_GROUPS } from '@/lib/monthly';
import { BALANCE_GROUPS } from '@/lib/consolidation';
import { groupCandidates, groupReport } from '@/lib/services/consolidation';

export const dynamic = 'force-dynamic';

export default async function Group({ searchParams }: { searchParams: SP }) {
  const user = await requireUser();
  const sp = await searchParams;
  const t = today();
  const from = /^\d{4}-\d{2}-\d{2}$/.test(String(sp.from)) ? String(sp.from) : `${t.slice(0, 4)}-01-01`;
  const to = /^\d{4}-\d{2}-\d{2}$/.test(String(sp.to)) ? String(sp.to) : t;
  const raw = sp.c == null ? [] : Array.isArray(sp.c) ? sp.c : [sp.c];
  // Bara bolag vars åtkomstregler (IP, SSO, tvåstegskrav, utloggning) sessionen uppfyller
  const candidates = await allowedCompanies(await groupCandidates(user.id));
  const okIds = new Set(candidates.map((c) => c.id));
  const ids = (raw.length ? raw.map(Number) : candidates.map((c) => c.id)).filter((i) => okIds.has(i));
  const parentId = Number(sp.moder) || null;
  const r = ids.length >= 1 ? await groupReport(user.id, ids, from, to, parentId) : null;
  const qs = new URLSearchParams([['from', from], ['to', to], ...ids.map((i) => ['c', String(i)]), ...(parentId ? [['moder', String(parentId)]] : [])] as [string, string][]).toString();
  const back = `/koncern?${qs}`;
  const amt = (o: number | null) => (o == null ? '' : (o / 100).toFixed(2).replace('.', ','));
  return (
    <div className="center" style={{ maxWidth: 1100 }}>
      <div className="header">
        <h1>Koncernsammanställning</h1>
        <div className="actions" style={{ margin: 0 }}><Link className="btn secondary" href="/">Mina bolag</Link><PrintButton /></div>
      </div>
      <Flash searchParams={searchParams} />
      <form className="card stack">
        <div className="row">
          <label>Från<input type="date" name="from" defaultValue={from} /></label>
          <label>Till<input type="date" name="to" defaultValue={to} /></label>
        </div>
        <div className="row">{candidates.map((c) => <label key={c.id} className="check"><input type="checkbox" name="c" value={c.id} defaultChecked={ids.includes(c.id)} /> {c.name} <span className="small muted">{c.orgnr}</span></label>)}</div>
        <div className="row"><label style={{ flex: '0 0 320px' }}>Moderbolag<select name="moder" defaultValue={parentId ?? ''}><option value="">Inget (bara sammanställning)</option>{candidates.filter((c) => ids.includes(c.id)).map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}</select></label></div>
        <div><button className="secondary">Visa</button></div>
      </form>
      {r?.parentId && (
        <section className="card stack no-print">
          <b>Dotterbolag till {r.companies.find((c) => c.id === r.parentId)?.name}</b>
          <p className="small muted" style={{ margin: 0 }}>Aktierna i dotterbolaget (1310–1319 i moderbolaget) elimineras mot dotterbolagets eget kapital vid förvärvet. Skillnaden blir koncernmässig goodwill. Lämnas fälten tomma används moderbolagets konto 1310–1319 och dotterbolagets bundna egna kapital (passar för bolag som moderbolaget har bildat). Övervärden (t.ex. fastigheter) tas upp med uppskjuten skatt 20,6 %. Goodwill och övervärden skrivs av linjärt från förvärvsdagen. Internvinst i lager = koncerninternt köpta varor i dotterbolagets lager × säljarens marginal.</p>
          {r.companies.filter((c) => c.id !== r.parentId).map((c) => {
            const l = r.links.find((x) => x.subsidiaryId === c.id);
            return (
              <form key={c.id} action={saveLink.bind(null, back, r.parentId!, c.id)} className="row group-link" style={{ alignItems: 'end' }}>
                <div style={{ flex: '1 1 180px' }}><b>{c.name}</b><div className="small muted">{l ? 'Dotterbolag' : 'Inte kopplat'}</div></div>
                <label style={{ flex: '0 0 110px' }}>Ägarandel %<input name="ownership" inputMode="decimal" defaultValue={l ? String(l.ownership).replace('.', ',') : '100'} /></label>
                <label style={{ flex: '0 0 170px' }}>Anskaffningsvärde kr<input name="acquisition_cost" inputMode="decimal" defaultValue={amt(l?.acquisitionCost ?? null)} placeholder="Konto 1310" /></label>
                <label style={{ flex: '0 0 190px' }}>Eget kapital vid förvärv kr<input name="acquired_equity" inputMode="decimal" defaultValue={amt(l?.acquiredEquity ?? null)} placeholder="Bundet eget kapital" /></label>
                <label style={{ flex: '0 0 150px' }}>Förvärvsdag<input type="date" name="acquired_on" defaultValue={l?.acquiredOn ?? ''} /></label>
                <label style={{ flex: '0 0 150px' }}>Övervärde kr<input name="surplus" inputMode="decimal" defaultValue={amt(l?.surplus ?? null)} placeholder="T.ex. byggnad" /></label>
                <label style={{ flex: '0 0 110px' }}>År övervärde<input name="surplus_years" inputMode="numeric" defaultValue={l?.surplusYears ?? 10} /></label>
                <label style={{ flex: '0 0 110px' }}>År goodwill<input name="goodwill_years" inputMode="numeric" defaultValue={l?.goodwillYears ?? 5} /></label>
                <label style={{ flex: '0 0 170px' }}>Lager köpt inom koncernen kr<input name="intra_inventory" inputMode="decimal" defaultValue={amt(l?.intraInventory ?? null)} /></label>
                <label style={{ flex: '0 0 150px' }}>Dito vid periodens början kr<input name="intra_inventory_opening" inputMode="decimal" defaultValue={amt(l?.intraInventoryOpening ?? null)} /></label>
                <label style={{ flex: '0 0 120px' }}>Säljarens marginal %<input name="intra_margin" inputMode="decimal" defaultValue={l?.intraMargin ? String(l.intraMargin).replace('.', ',') : ''} /></label>
                <div style={{ flex: '0 0 auto' }}><button className="secondary">{l ? 'Spara' : 'Koppla som dotterbolag'}</button></div>
                {l && <div style={{ flex: '0 0 auto' }}><button className="link" name="remove" value="1">Ta bort koppling</button></div>}
              </form>
            );
          })}
        </section>
      )}
      {r && r.companies.length > 0 && (
        <>
          <p className="small muted">Bolagens bokföring summeras. Försäljning mellan bolagen (kund med samma organisationsnummer som ett annat valt bolag) och obetalda koncerninterna fakturor elimineras, liksom fordringar och skulder på koncernkontona (1320–1329, 1660–1669, 2360–2369, 2860–2869). Med ett moderbolag elimineras även utdelning från dotterbolag och aktier i dotterbolag mot eget kapital, med goodwill och minoritetsandel. Internvinster i lager elimineras med de uppgifter som anges per dotterbolag.</p>
          {r.warnings.map((w) => <p key={w} className="flash error">{w}</p>)}
          {r.analyses.length > 0 && (
            <div className="table-wrap"><table className="acquisition">
              <thead><tr><th>Förvärvsanalys</th><th className="num">Anskaffning</th><th className="num">Eget kapital</th><th className="num">Övervärde</th><th className="num">Uppskjuten skatt</th><th className="num">Goodwill</th><th className="num">Avskrivet i perioden</th><th className="num">Kvar per {to}</th></tr></thead>
              <tbody>{r.analyses.map((x) => <tr key={x.id} className="acq-row"><td>{x.name} ({x.ownership.toLocaleString('sv-SE')} %{x.acquiredOn ? `, ${x.acquiredOn}` : ''})</td><td className="num">{kr(x.cost)}</td><td className="num">{kr(x.equity)}</td><td className="num">{kr(x.a.surplus)}</td><td className="num">{kr(x.a.deferredTax)}</td><td className="num acq-gw">{kr(x.a.goodwill)}</td><td className="num acq-dep">{kr(x.a.period.gw + x.a.period.s)}</td><td className="num acq-left">{kr(x.a.remaining.gw + x.a.remaining.s)}</td></tr>)}</tbody>
            </table></div>
          )}
          {r.entries.length > 0 && (
            <div className="card small elims"><b>Elimineringar</b><ul style={{ margin: '.3rem 0 0' }}>{r.entries.map((e) => <li key={e.label}>{e.label}: {kr(e.amount)}</li>)}</ul></div>
          )}
          <h2>Resultaträkning {from} – {to}</h2>
          <div className="table-wrap"><table>
            <thead><tr><th></th>{r.perCompany.map((p) => <th key={p.id} className="num">{p.name}</th>)}<th className="num">Elimineringar</th><th className="num">Koncernen</th></tr></thead>
            <tbody>
              {RESULT_GROUPS.map((g) => (
                <tr key={g.key}><td>{g.label}</td>{r.perCompany.map((p) => <td key={p.id} className="num">{kr(p.r[g.key])}</td>)}<td className="num">{r.elimR[g.key] ? kr(r.elimR[g.key]) : ''}</td><td className="num"><b>{kr(r.result[g.key])}</b></td></tr>
              ))}
              <tr className="sum"><td><b>Resultat</b></td>{r.perCompany.map((p) => <td key={p.id} className="num">{kr(p.r.result)}</td>)}<td className="num">{r.consolidatedResult !== r.perCompany.reduce((a, p) => a + p.r.result, 0) ? kr(r.consolidatedResult - r.perCompany.reduce((a, p) => a + p.r.result, 0)) : ''}</td><td className="num"><b>{kr(r.consolidatedResult)}</b></td></tr>
              {r.minorityResult !== 0 && <tr><td>varav minoritetens andel</td>{r.perCompany.map((p) => <td key={p.id} />)}<td /><td className="num">{kr(r.minorityResult)}</td></tr>}
            </tbody>
          </table></div>
          <h2>Balansräkning {to}</h2>
          <div className="table-wrap"><table>
            <thead><tr><th></th>{r.perCompany.map((p) => <th key={p.id} className="num">{p.name}</th>)}<th className="num">Elimineringar</th><th className="num">Koncernen</th></tr></thead>
            <tbody>
              {BALANCE_GROUPS.map((g) => (
                <tr key={g.key}><td>{g.label}</td>{r.perCompany.map((p) => <td key={p.id} className="num">{kr(p.b[g.key])}</td>)}<td className="num">{r.elimB[g.key] ? kr(r.elimB[g.key]) : ''}</td><td className="num"><b>{kr(r.balance[g.key])}</b></td></tr>
              ))}
              {r.minority !== 0 && <tr><td>Minoritetsintresse</td>{r.perCompany.map((p) => <td key={p.id} />)}<td className="num">{kr(r.minority)}</td><td className="num"><b>{kr(r.minority)}</b></td></tr>}
            </tbody>
          </table></div>
          {(r.intraSales > 0 || r.intraOpen > 0) && <p className="small">Koncernintern försäljning {kr(r.intraSales)}, obetalt mellan bolagen {kr(r.intraOpen)}.</p>}
        </>
      )}
      {candidates.length === 0 && <p className="muted">Du har inga bolag att sammanställa.</p>}
    </div>
  );
}
