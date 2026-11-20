import Link from 'next/link';
import { requireCompany } from '@/lib/server/auth';
import { sql } from '@/lib/db';
import { Flash, type SP } from '@/components/ui';
import { kr, today } from '@/lib/format';
import { DEFAULT_COMPONENTS } from '@/lib/property';
import { overview } from '@/lib/services/property';
import { components, deposit, depositReturn, index, lease, premise, premiseVat, property, rents } from './actions';

export const dynamic = 'force-dynamic';
const KIND: Record<string, string> = { lokal: 'Lokal', bostad: 'Bostad', garage: 'Garage/p-plats', forrad: 'Förråd' };
const ST: Record<string, string> = { draft: 'Utkast', booked: 'Obetald', paid: 'Betald', credited: 'Krediterad' };

export default async function Property({ params, searchParams }: { params: Promise<{ cid: string }>; searchParams: SP }) {
  const { cid } = await params;
  const ctx = await requireCompany(cid, { perm: 'ledger' });
  const id = ctx.company.id;
  const o = await overview(id);
  const customers = await sql<{ id: number; name: string }[]>`SELECT id, name FROM customers WHERE company_id = ${id} ORDER BY name`;
  const t0 = today();
  const nextMonth = (() => { const [y, m] = t0.split('-').map(Number); return m === 12 ? `${y + 1}-01` : `${y}-${String(m + 1).padStart(2, '0')}`; })();
  return (
    <div style={{ maxWidth: 1100 }}>
      <h1>Fastighet och uthyrning</h1>
      <p className="muted">Fastigheter, lokaler och hyresavtal. Hyresavierna skapas per månad eller kvartal med OCR och bokförs direkt; hyran räknas upp med index och moms läggs på för lokaler med frivillig skattskyldighet.</p>
      <Flash searchParams={searchParams} />

      {o.properties.map((p) => {
        const prem = o.premises.filter((x) => x.property_id === p.id);
        const comps = o.components.filter((c) => c.property_id === p.id);
        return (
          <section key={p.id} className="card stack property" style={{ marginBottom: 24 }}>
            <div className="header"><h2 style={{ margin: 0 }}>{p.name}</h2><span className="muted">{p.designation} {p.address}</span></div>
            <div className="small">Avdragsrätt för ingående moms på gemensamma kostnader: <b className="deductible">{o.share.get(p.id)} %</b> (momspliktig uthyrd yta)</div>
            <div className="table-wrap"><table className="premises">
              <thead><tr><th>Lokal</th><th>Typ</th><th className="num">Yta m²</th><th>Moms</th><th>Hyresgäst</th><th className="num">Årshyra nu</th><th></th></tr></thead>
              <tbody>{prem.map((x) => {
                const l = o.leases.filter((l) => l.premise_id === x.id && l.start_date <= t0 && (!l.end_date || l.end_date >= t0))[0];
                return (
                  <tr key={x.id} className="premise"><td>{x.name}</td><td>{KIND[x.kind]}</td><td className="num">{x.area}</td>
                    <td>{x.vat_liable ? `Frivilligt skattskyldig från ${x.vat_from}` : 'Momsfri'}</td><td>{l?.tenant ?? <span className="muted">Vakant</span>}</td>
                    <td className="num">{l ? kr(l.current) : ''}</td>
                    <td>{x.kind !== 'bostad' && <form action={premiseVat.bind(null, id, x.id)} className="row">
                      {!x.vat_liable && <><input type="hidden" name="vat_liable" value="on" /><input type="date" name="vat_from" defaultValue={t0} aria-label="Momsplikt från" /></>}
                      <button className="secondary">{x.vat_liable ? 'Ta bort momsplikt' : 'Frivillig skattskyldighet'}</button></form>}</td></tr>
                );
              })}</tbody>
            </table></div>
            <form action={premise.bind(null, id, p.id)} className="row">
              <label>Ny lokal<input name="name" required /></label>
              <label>Typ<select name="kind">{Object.entries(KIND).map(([k, v]) => <option key={k} value={k}>{v}</option>)}</select></label>
              <label>Yta m²<input name="area" inputMode="decimal" /></label>
              <label className="check"><input type="checkbox" name="vat_liable" /> Frivillig skattskyldighet</label>
              <label>Momsplikt från<input type="date" name="vat_from" defaultValue={t0} /></label>
              <button className="secondary">Lägg till lokal</button>
            </form>
            <details open={comps.length > 0}>
              <summary>Komponentavskrivning av byggnaden</summary>
              {comps.length ? (<>
                <p className="small">Anskaffningsvärde {kr(p.cost)}, varav mark {kr(p.land)} (1130, skrivs inte av).</p>
                <table className="components"><thead><tr><th>Komponent</th><th className="num">Värde</th><th className="num">År</th><th className="num">Per år</th><th className="num">Avskrivet</th></tr></thead>
                  <tbody>{comps.map((c) => <tr key={c.id} className="component"><td>{c.name}</td><td className="num">{kr(c.cost)}</td><td className="num">{c.life_months / 12}</td><td className="num">{kr(Math.round(c.cost / (c.life_months / 12)))}</td><td className="num">{kr(c.booked)}</td></tr>)}</tbody></table>
                <p className="small muted">Avskrivningarna bokförs varje månad från <Link href={`/c/${id}/anlaggningar`}>anläggningsregistret</Link>.</p>
              </>) : (
                <form action={components.bind(null, id, p.id)} className="stack">
                  <div className="row"><label>Anskaffningsvärde (kr)<input name="cost" inputMode="decimal" required /></label><label>Varav mark (kr)<input name="land" inputMode="decimal" /></label><label>Anskaffad<input type="date" name="acquired_on" defaultValue={t0} /></label></div>
                  {DEFAULT_COMPONENTS.map((c, i) => <div key={i} className="row"><label style={{ flex: '2 1 240px' }}>Komponent<input name={`comp_name_${i}`} defaultValue={c.name} /></label><label>Andel %<input name={`comp_pct_${i}`} defaultValue={c.pct} inputMode="decimal" /></label><label>År<input name={`comp_years_${i}`} defaultValue={c.years} type="number" /></label></div>)}
                  <div><button className="secondary">Lägg upp komponenterna</button></div>
                  <p className="small muted" style={{ margin: 0 }}>K3 kräver komponentavskrivning när komponenterna har väsentligt olika nyttjandeperiod. Andelarna ska summera till 100 %.</p>
                </form>)}
            </details>
          </section>
        );
      })}
      <form action={property.bind(null, id)} className="card row">
        <label>Ny fastighet<input name="name" required /></label><label>Fastighetsbeteckning<input name="designation" /></label><label style={{ flex: '2 1 200px' }}>Adress<input name="address" /></label>
        <button className="secondary">Lägg upp fastighet</button>
      </form>

      <h2>Hyresavtal</h2>
      <div className="table-wrap"><table className="leases">
        <thead><tr><th>Hyresgäst</th><th>Lokal</th><th>Period</th><th className="num">Bashyra/år</th><th className="num">Hyra {t0.slice(0, 4)}</th><th>Avisering</th><th>Deposition</th></tr></thead>
        <tbody>{o.leases.map((l) => {
          const x = o.premises.find((p) => p.id === l.premise_id);
          return (
            <tr key={l.id} className="lease"><td>{l.tenant}</td><td>{x?.name}</td><td>{l.start_date} – {l.end_date ?? 'tills vidare'}</td><td className="num">{kr(l.base_rent)}</td>
              <td className="num lease-rent">{kr(l.current)}{l.index_year && <div className="small muted">index {l.index_share} % från {l.index_year}</div>}</td>
              <td>{l.billing === 'month' ? 'Månadsvis' : 'Kvartalsvis'}</td>
              <td>{l.deposit > 0 && (!l.deposit_voucher_id ? <form action={deposit.bind(null, id, l.id)} className="row"><span>{kr(l.deposit)}</span><button className="secondary">Mottagen</button></form>
                : !l.deposit_returned_voucher_id ? <form action={depositReturn.bind(null, id, l.id)} className="row"><span className="deposit-held">{kr(l.deposit)} innestående</span><label>Kvarhålls (kr)<input name="retained" inputMode="decimal" style={{ width: 90 }} /></label><button className="secondary">Återbetala</button></form>
                : <span className="muted">Återbetald</span>)}</td></tr>
          );
        })}</tbody>
      </table></div>
      {o.premises.length > 0 && <form action={lease.bind(null, id)} className="card stack">
        <b>Nytt hyresavtal</b>
        <div className="row">
          <label>Lokal<select name="premise_id">{o.premises.map((p) => <option key={p.id} value={p.id}>{o.properties.find((x) => x.id === p.property_id)?.name}: {p.name}</option>)}</select></label>
          <label>Hyresgäst<select name="customer_id">{customers.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}</select></label>
          <label>Tillträde<input type="date" name="start_date" defaultValue={t0} required /></label><label>Till och med<input type="date" name="end_date" /></label>
        </div>
        <div className="row">
          <label>Årshyra exkl. moms (kr)<input name="base_rent" inputMode="decimal" required /></label>
          <label>Avisering<select name="billing"><option value="quarter">Kvartalsvis</option><option value="month">Månadsvis</option></select></label>
          <label>Indexbasår<input name="index_year" type="number" placeholder="t.ex. 2024" /></label><label>Indexandel %<input name="index_share" defaultValue="100" inputMode="decimal" /></label>
          <label>Deposition (kr)<input name="deposit" inputMode="decimal" /></label>
        </div>
        <div><button>Lägg upp avtalet</button></div>
      </form>}

      <div className="row" style={{ alignItems: 'flex-start' }}>
        <form action={rents.bind(null, id)} className="card stack" style={{ flex: '1 1 320px' }}>
          <b>Hyresavier</b>
          <label>Avser månad<input name="month" defaultValue={nextMonth} pattern="\d{4}-\d{2}" /></label>
          <p className="small muted" style={{ margin: 0 }}>Månadsavtal aviseras varje månad, kvartalsavtal i januari, april, juli och oktober. Avier som redan skapats för perioden hoppas över.</p>
          <div><button>Skapa hyresavier</button></div>
        </form>
        <div className="card stack" style={{ flex: '1 1 320px' }}>
          <b>Index (KPI oktober)</b>
          {o.index.map(([y, v]) => <div key={y} className="row index-row"><span>{y}</span><b>{v.toLocaleString('sv-SE')}</b></div>)}
          <form action={index.bind(null, id)} className="row"><label>År<input name="year" type="number" required /></label><label>Värde<input name="value" inputMode="decimal" required /></label><button className="secondary">Spara</button></form>
          <p className="small muted" style={{ margin: 0 }}>Hyran för ett år räknas upp med indexet för oktober året före, jämfört med basårets index. Hyran blir aldrig lägre än bashyran.</p>
        </div>
      </div>
      {o.invoices.length > 0 && (<>
        <h2>Utsända avier</h2>
        <div className="table-wrap"><table className="rent-invoices">
          <thead><tr><th>Period</th><th>Hyresgäst</th><th className="num">Hyra</th><th className="num">Att betala</th><th>Faktura</th><th>OCR</th><th>Status</th></tr></thead>
          <tbody>{o.invoices.map((i) => <tr key={`${i.lease_id}-${i.period}`} className="rent-invoice"><td>{i.period}</td><td>{o.leases.find((l) => l.id === i.lease_id)?.tenant}</td><td className="num">{kr(i.rent)}</td><td className="num">{kr(i.total)}</td>
            <td>{i.invoice_id && <Link href={`/c/${id}/fakturor/${i.invoice_id}`}>{i.invoice_number}</Link>}</td><td>{i.ocr}</td><td>{ST[i.status ?? ''] ?? i.status}</td></tr>)}</tbody>
        </table></div>
      </>)}
    </div>
  );
}
