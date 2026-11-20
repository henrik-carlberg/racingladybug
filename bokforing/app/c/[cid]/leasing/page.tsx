import Link from 'next/link';
import { requireCompany } from '@/lib/server/auth';
import { Flash, type SP } from '@/components/ui';
import { kr, today } from '@/lib/format';
import { KIND_LABEL } from '@/lib/leasing';
import { overview } from '@/lib/services/leasing';
import { book, create, end } from './actions';

export const dynamic = 'force-dynamic';

export default async function Leasing({ params, searchParams }: { params: Promise<{ cid: string }>; searchParams: SP }) {
  const { cid } = await params;
  const ctx = await requireCompany(cid, { perm: 'ledger' });
  const id = ctx.company.id;
  const o = await overview(id);
  const t0 = today();
  return (
    <div style={{ maxWidth: 1100 }}>
      <h1>Leasing</h1>
      <p className="muted">Leasade bilar, maskiner och lokaler. Avgifterna bokförs automatiskt varje månad när de dras från banken. Enligt K2 är all leasing operationell; enligt K3 kan avtal som i praktiken är ett köp redovisas som tillgång och skuld (finansiell leasing).</p>
      <Flash searchParams={searchParams} />
      <div className="grid">
        <div className="card stat"><div className="label">Inom ett år</div><div className="value lease-within1">{kr(o.note.within1)}</div></div>
        <div className="card stat"><div className="label">1–5 år</div><div className="value lease-1to5">{kr(o.note.oneTo5)}</div></div>
        <div className="card stat"><div className="label">Senare än 5 år</div><div className="value">{kr(o.note.over5)}</div></div>
        <div className="card stat"><div className="label">Kostnad i år</div><div className="value lease-cost">{kr(o.note.yearCost)}</div></div>
      </div>
      <p className="small muted">Framtida avgifter för operationella avtal – samma uppgift som står i årsredovisningens not om leasingavtal.</p>

      <div className="table-wrap"><table className="leasing">
        <thead><tr><th>Avtal</th><th>Typ</th><th>Period</th><th className="num">Avgift/mån</th><th>Redovisning</th><th className="num">Bokförda</th><th className="num">Leasingskuld</th><th></th></tr></thead>
        <tbody>{o.rows.map((c) => (
          <tr key={c.id} className="lease-row"><td><b>{c.name}</b><div className="small muted">{c.lessor}</div></td><td>{KIND_LABEL[c.kind]}</td><td>{c.start_date.slice(0, 7)} – {c.end}{c.ended_on && <div className="small muted">avslutat {c.ended_on}</div>}</td>
            <td className="num">{kr(c.fee)}</td>
            <td className="treatment">{c.treatment === 'financial' ? 'Finansiell' : 'Operationell'}{c.treatment === 'operational' && c.suggestion.financial && <div className="small" style={{ color: 'var(--warn)' }}>Kan vara finansiell: {c.suggestion.reasons.join(', ')}</div>}
              {c.asset_id && <div className="small"><Link href={`/c/${id}/anlaggningar`}>i anläggningsregistret</Link></div>}</td>
            <td className="num booked">{c.booked} av {c.months}</td><td className="num">{c.debt != null ? kr(c.debt) : ''}</td>
            <td>{!c.ended_on && <form action={end.bind(null, id, c.id)} className="row"><input type="date" name="ended_on" defaultValue={t0} aria-label="Avslutas" /><button className="secondary">Avsluta</button></form>}</td></tr>
        ))}</tbody>
      </table></div>
      <form action={book.bind(null, id)} className="card row"><label>Bokför avgifter till och med<input name="upto" defaultValue={t0.slice(0, 7)} pattern="\d{4}-\d{2}" /></label><button className="secondary">Bokför förfallna avgifter</button>
        <span className="small muted">Görs också automatiskt varje dag.</span></form>

      <form action={create.bind(null, id)} className="card stack">
        <b>Nytt leasingavtal</b>
        <div className="row"><label style={{ flex: '2 1 200px' }}>Benämning<input name="name" required placeholder="t.ex. Volvo XC60 ABC123" /></label>
          <label>Typ<select name="kind">{Object.entries(KIND_LABEL).map(([k, v]) => <option key={k} value={k}>{v}</option>)}</select></label><label>Leasegivare<input name="lessor" /></label></div>
        <div className="row"><label>Start<input type="date" name="start_date" defaultValue={t0} required /></label><label>Löptid (mån)<input name="months" type="number" min={1} defaultValue={36} required /></label>
          <label>Avgift/mån exkl. moms (kr)<input name="fee" inputMode="decimal" required /></label><label>Moms<select name="vat_rate" defaultValue="25"><option value="25">25 %</option><option value="0">0 %</option></select></label>
          <label>Restvärde (kr)<input name="residual" inputMode="decimal" /></label></div>
        <div className="row"><label>Ränta i avtalet (%)<input name="rate_pct" inputMode="decimal" /></label><label>Verkligt värde (kr)<input name="fair_value" inputMode="decimal" /></label>
          <label>Ekonomisk livslängd (mån)<input name="life_months" type="number" /></label><label className="check"><input type="checkbox" name="transfer" /> Äganderätten övergår</label></div>
        <div className="row"><label>Redovisning<select name="treatment"><option value="operational">Operationell (kostnad)</option>{o.framework === 'K3' && <option value="financial">Finansiell (tillgång och skuld, K3)</option>}</select></label>
          <label>Dras från konto<input name="bank_account" defaultValue="1930" /></label></div>
        <p className="small muted" style={{ margin: 0 }}>För personbilar är halva momsen på leasingavgiften avdragsgill. Ränta, verkligt värde och livslängd används för att föreslå klassning enligt K3 kap. 20.</p>
        <div><button>Lägg upp avtalet</button></div>
      </form>
    </div>
  );
}
