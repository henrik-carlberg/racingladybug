import Link from 'next/link';
import { requireCompany } from '@/lib/server/auth';
import { sql } from '@/lib/db';
import { Flash, type SP } from '@/components/ui';
import { kr, today } from '@/lib/format';
import { overview } from '@/lib/services/commission';
import { assign, invoiceSeller, removeRule, rule, seller, settle, tier, transfer } from './actions';

export const dynamic = 'force-dynamic';

export default async function Commission({ params, searchParams }: { params: Promise<{ cid: string }>; searchParams: SP }) {
  const { cid } = await params;
  const sp = await searchParams;
  const ctx = await requireCompany(cid, { perm: 'payroll' });
  const id = ctx.company.id;
  const prev = (() => { const d = new Date(`${today().slice(0, 7)}-01T00:00:00Z`); d.setUTCMonth(d.getUTCMonth() - 1); return d.toISOString().slice(0, 7); })();
  const period = /^\d{4}-\d{2}$/.test(String(sp.period)) ? String(sp.period) : prev;
  const o = await overview(id, period);
  const employees = await sql<{ id: number; name: string }[]>`SELECT id, first_name || ' ' || last_name AS name FROM employees WHERE company_id = ${id} AND active ORDER BY 2`;
  const suppliers = await sql<{ id: number; name: string }[]>`SELECT id, name FROM suppliers WHERE company_id = ${id} ORDER BY name`;
  const shift = (n: number) => { const d = new Date(`${period}-01T00:00:00Z`); d.setUTCMonth(d.getUTCMonth() + n); return d.toISOString().slice(0, 7); };
  return (
    <div style={{ maxWidth: 1100 }}>
      <div className="header"><h1>Provisioner {period}</h1><div className="row"><Link href={`?period=${shift(-1)}`}>← {shift(-1)}</Link><Link href={`?period=${shift(1)}`}>{shift(1)} →</Link></div></div>
      <p className="muted">Provision på betalda fakturor (exkl. moms) per säljare. Krediteringar dras av i den period de bokförs. Anställdas provision läggs på lönespecen, agenter får en självfaktura.</p>
      <Flash searchParams={searchParams} />
      <div className="table-wrap"><table className="commission">
        <thead><tr><th>Säljare</th><th className="num">Underlag</th><th className="num">Provision</th><th className="num">Bonus</th><th className="num">Att betala</th><th>Status</th></tr></thead>
        <tbody>{o.calc.map((c) => {
          const run = o.runs.find((r) => r.seller_id === c.seller.id);
          return (
            <tr key={c.seller.id} className="seller-row"><td><b>{c.seller.name}</b><div className="small muted">{c.seller.kind === 'agent' ? 'Agent' : 'Anställd'} · {c.seller.base_rate} %</div>
              {c.details.length > 0 && <details><summary className="small">{c.details.length} fakturor</summary><ul className="small">{c.details.map((d, i) => <li key={i}>{d.invoice} {d.customer}: {kr(d.net)} → {kr(d.commission)}</li>)}</ul></details>}</td>
              <td className="num basis">{kr(c.basis)}</td><td className="num comm">{kr(c.commission)}</td><td className="num bonus">{kr(c.bonus)}</td><td className="num total">{kr(c.total)}</td>
              <td>{!run ? <span className="muted">Inte avräknad</span> : run.status === 'transferred' ? <span className="badge ok transferred">{run.payslip_id ? 'På lönespecen' : 'Självfaktura skapad'}</span>
                : <form action={transfer.bind(null, id, run.id, period)}><button className="secondary">{c.seller.kind === 'agent' ? 'Skapa självfaktura' : 'Lägg på lönen'} ({kr(run.total)})</button></form>}</td></tr>
          );
        })}</tbody>
      </table></div>
      <form action={settle.bind(null, id)} className="card row"><input type="hidden" name="period" value={period} /><span style={{ flex: '1 1 300px' }}>Spara avräkningen för {period}. Den räknas om tills den är överförd.</span><button>Avräkna {period}</button></form>

      <h2>Säljare</h2>
      {o.sellers.map((s) => (
        <div key={s.id} className="card stack seller">
          <div className="row"><b>{s.name}</b><span className="muted">{s.kind === 'agent' ? 'Agent (självfaktura)' : 'Anställd (lön)'} · grund {s.base_rate} %{s.target ? ` · mål ${kr(s.target)} ger ${kr(s.target_bonus ?? 0)}` : ''}</span></div>
          <div className="small">Bonustrappa: {o.tiers.filter((t) => t.seller_id === s.id).map((t) => `över ${kr(t.threshold)}: +${t.rate_pct} %`).join(' · ') || 'ingen'}</div>
          <form action={tier.bind(null, id, s.id)} className="row"><label>Över (kr/mån)<input name="threshold" inputMode="decimal" required /></label><label>Bonus %<input name="rate_pct" inputMode="decimal" required /></label><button className="secondary">Lägg till steg</button></form>
        </div>
      ))}
      <form action={seller.bind(null, id)} className="card stack">
        <b>Ny säljare</b>
        <div className="row"><label>Namn<input name="name" required /></label><label>Typ<select name="kind"><option value="employee">Anställd</option><option value="agent">Agent</option></select></label>
          <label>Anställd<select name="employee_id"><option value="">–</option>{employees.map((e) => <option key={e.id} value={e.id}>{e.name}</option>)}</select></label>
          <label>Agent (leverantör)<select name="supplier_id"><option value="">–</option>{suppliers.map((e) => <option key={e.id} value={e.id}>{e.name}</option>)}</select></label></div>
        <div className="row"><label>Grundprovision %<input name="base_rate" inputMode="decimal" defaultValue="0" /></label><label>Månadsmål (kr)<input name="target" inputMode="decimal" /></label>
          <label>Bonus vid mål (kr)<input name="target_bonus" inputMode="decimal" /></label><label className="check"><input type="checkbox" name="agent_vat" defaultChecked /> Agenten är momsregistrerad</label></div>
        <div><button>Lägg upp säljare</button></div>
      </form>

      <h2>Regler</h2>
      <ul className="rules">{o.rules.map((r) => <li key={r.id} className="rule">{r.seller ?? 'Alla säljare'}: {r.scope === 'customer' ? `kund ${r.customer}` : `konto ${r.account}`} → {r.rate_pct} % <form action={removeRule.bind(null, id, r.id)} style={{ display: 'inline' }}><button className="secondary">Ta bort</button></form></li>)}</ul>
      <form action={rule.bind(null, id)} className="card row">
        <label>Säljare<select name="seller_id"><option value="">Alla</option>{o.sellers.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}</select></label>
        <label>Gäller<select name="scope"><option value="customer">Kund</option><option value="account">Intäktskonto</option></select></label>
        <label>Kund<select name="customer_id"><option value="">–</option>{o.customers.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}</select></label>
        <label>Konto<input name="account" inputMode="numeric" style={{ width: 80 }} /></label><label>Provision %<input name="rate_pct" inputMode="decimal" required style={{ width: 80 }} /></label>
        <button className="secondary">Spara regel</button>
      </form>
      <p className="small muted">Mest specifika regeln gäller: säljarens kundregel, kundregel, säljarens kontoregel, kontoregel, och sist säljarens grundprovision.</p>

      <h2>Säljare per kund och faktura</h2>
      <div className="row" style={{ alignItems: 'flex-start' }}>
        <form action={assign.bind(null, id)} className="card row" style={{ flex: '1 1 400px' }}>
          <label>Kund<select name="customer_id">{o.customers.map((c) => <option key={c.id} value={c.id}>{c.name}{c.seller_id ? ` (${o.sellers.find((s) => s.id === c.seller_id)?.name})` : ''}</option>)}</select></label>
          <label>Säljare<select name="seller_id"><option value="">Ingen</option>{o.sellers.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}</select></label>
          <button className="secondary">Koppla</button>
        </form>
        <form action={invoiceSeller.bind(null, id)} className="card row" style={{ flex: '1 1 300px' }}>
          <label>Fakturanummer<input name="invoice_number" inputMode="numeric" required /></label>
          <label>Säljare<select name="seller_id">{o.sellers.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}</select></label>
          <button className="secondary">Ändra på fakturan</button>
        </form>
      </div>
    </div>
  );
}
