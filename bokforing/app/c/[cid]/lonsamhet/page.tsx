import { requireCompany } from '@/lib/server/auth';
import { Flash, type SP } from '@/components/ui';
import { kr } from '@/lib/format';
import { overview } from '@/lib/services/profitability';
import { simulate } from '@/lib/profitability';
import { settingsAction } from './actions';

export const dynamic = 'force-dynamic';
const pct = (n: number | null) => (n == null ? '–' : `${n.toLocaleString('sv-SE')} %`);

export default async function Profitability({ params, searchParams }: { params: Promise<{ cid: string }>; searchParams: SP }) {
  const { cid } = await params;
  const sp = await searchParams;
  const { company } = await requireCompany(cid, { perm: 'invoicing' });
  const o = await overview(company.id);
  const price = Math.max(-50, Math.min(100, Number(String(sp.pris ?? '0').replace(',', '.')) || 0));
  const late = Math.max(0, Math.min(100, Number(String(sp.sen ?? '0').replace(',', '.')) || 0));
  const simCustomer = o.customers.find((c) => String(c.id) === String(sp.kund ?? ''));
  const sim = simCustomer ? simulate(simCustomer, price, late) : null;
  return (
    <div style={{ maxWidth: 1150 }}>
      <h1>Kund- och produktlönsamhet</h1>
      <Flash searchParams={searchParams} />
      <p className="small">Täckningsbidrag per kund och artikel de senaste tolv månaderna: fakturerat exklusive moms minus varukostnad (lageruttag på kundorder), nedlagd tid gånger timkostnaden, kundförluster (avskrivna fordringar)
        och räntekostnaden för att kunden betalar efter förfallodagen. Kunder med negativt täckningsbidrag flaggas – prova vad ett höjt pris eller bättre betalningsvanor skulle ge.</p>
      {o.unprofitable.length > 0 && <div className="card warn pr-unprofitable">Olönsamma kunder: {o.unprofitable.map((c) => <span key={c.id} data-name={c.name}>{c.name} ({kr(c.contribution)} kr) </span>)}</div>}
      <h2>Kunder</h2>
      <table className="pr-customers"><thead><tr><th>#</th><th>Kund</th><th className="num">Fakturerat</th><th className="num">Varukostnad</th><th className="num">Tid</th><th className="num">Kundförluster</th><th className="num">Sena betalningar</th><th className="num">Täckningsbidrag</th><th className="num">TG</th><th className="num">Snitt dagar sen</th></tr></thead>
        <tbody>{o.customers.map((c, i) => <tr key={c.id} className="pr-row" data-name={c.name} data-negative={c.contribution < 0 ? '1' : '0'}><td>{i + 1}</td><td>{c.name}</td><td className="num">{kr(c.revenue)}</td><td className="num">{kr(c.goods)}</td><td className="num">{kr(c.time)}</td>
          <td className="num">{kr(c.losses)}</td><td className="num">{kr(c.late)}</td><td className="num pr-tb">{kr(c.contribution)}</td><td className="num">{pct(c.margin)}</td><td className="num">{c.avgDaysLate}</td></tr>)}
          {!o.customers.length && <tr><td colSpan={10} className="muted">Inga fakturor de senaste tolv månaderna.</td></tr>}</tbody></table>

      <h2>Simulera</h2>
      <form className="row card" method="get">
        <label>Kund<select name="kund" defaultValue={String(sp.kund ?? '')}><option value="">–</option>{o.customers.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}</select></label>
        <label>Prisförändring %<input name="pris" inputMode="decimal" defaultValue={String(price)} style={{ width: '5rem' }} /></label>
        <label>Minskad försening %<input name="sen" inputMode="decimal" defaultValue={String(late)} style={{ width: '5rem' }} /></label>
        <div><button>Simulera</button></div>
      </form>
      {sim && simCustomer && <p className="pr-sim">{simCustomer.name}: täckningsbidraget blir <strong className="pr-sim-tb">{kr(sim.contribution)}</strong> kr ({sim.change >= 0 ? '+' : ''}{kr(sim.change)} kr) med {price.toLocaleString('sv-SE')} % pris och {late.toLocaleString('sv-SE')} % kortare försening.</p>}

      <h2>Artiklar</h2>
      <table className="pr-products"><thead><tr><th>Artikel</th><th className="num">Antal</th><th className="num">Försäljning</th><th className="num">Varukostnad</th><th className="num">Täckningsbidrag</th><th className="num">TG</th></tr></thead>
        <tbody>{o.products.map((p) => <tr key={p.id} className="pr-prow" data-name={p.name}><td>{p.name}</td><td className="num">{p.qty.toLocaleString('sv-SE')}</td><td className="num">{kr(p.revenue)}</td><td className="num">{kr(p.cost)}</td><td className="num pr-ptb">{kr(p.contribution)}</td><td className="num">{pct(p.margin)}</td></tr>)}
          {!o.products.length && <tr><td colSpan={6} className="muted">Inga fakturerade kundorder med artiklar.</td></tr>}</tbody></table>

      <h2>Antaganden</h2>
      <form action={settingsAction.bind(null, company.id)} className="row card">
        <label>Timkostnad (kr/h)<input name="hour_cost" inputMode="decimal" defaultValue={String(o.settings.hour_cost / 100)} required /></label>
        <label>Räntekostnad %<input name="interest_pct" inputMode="decimal" defaultValue={String(o.settings.interest_pct)} required /></label>
        <div><button>Spara antaganden</button></div>
      </form>
    </div>
  );
}
