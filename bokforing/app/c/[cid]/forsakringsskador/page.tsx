import { requireCompany } from '@/lib/server/auth';
import { Flash, type SP } from '@/components/ui';
import { kr, today } from '@/lib/format';
import { overview } from '@/lib/services/damage-claims';
import { assessAction, payAction, reportAction } from './actions';

export const dynamic = 'force-dynamic';

const STATUS: Record<string, string> = { reported: 'Anmäld – väntar på besked', assessed: 'Beviljad – väntar på utbetalning', paid: 'Utbetald', denied: 'Ingen ersättning' };
const KIND: Record<string, string> = { asset: 'Anläggningstillgång', inventory: 'Lager', other: 'Övrigt' };

export default async function Claims({ params, searchParams }: { params: Promise<{ cid: string }>; searchParams: SP }) {
  const { cid } = await params;
  const { company } = await requireCompany(cid, { perm: 'ledger' });
  const id = company.id;
  const { claims, assets, products, receivable } = await overview(id);
  const t = today();
  return (
    <div style={{ maxWidth: 1050 }}>
      <h1>Försäkringsskador</h1>
      <Flash searchParams={searchParams} />
      <p className="small">Följ en skada från anmälan till utbetalning. En förstörd anläggningstillgång utrangeras (bokfört värde till 7973) och förstörda varor skrivs bort ur lagret (4960/1460) när skadan anmäls.
        När försäkringsbolaget lämnat besked bokförs ersättningen – värderingen minus självrisken – som fordran på 1689 mot intäkt på 3994. För inventarier och byggnader kan ersättningen sättas av till ersättningsfond i bokslutet.</p>
      <p className="small">Beviljad ersättning som inte är utbetald: <span className="dc-receivable">{kr(receivable)}</span> kr</p>
      <table className="dc-list"><thead><tr><th>Skada</th><th>Datum</th><th>Avser</th><th>Försäkringsbolag</th><th className="num">Bortskrivet</th><th className="num">Ersättning</th><th>Status</th><th></th></tr></thead>
        <tbody>{claims.map((c) => (
          <tr key={c.id} className="dc-row" data-status={c.status} data-description={c.description}><td>{c.description}</td><td>{c.damage_date}</td><td className="small">{KIND[c.kind]}{c.asset && `: ${c.asset}`}{c.items && `: ${c.items}`}</td>
            <td className="small">{c.insurer}{c.claim_ref && ` (${c.claim_ref})`}</td><td className="num dc-written">{kr(c.written_off)}</td>
            <td className="num dc-comp">{c.compensation != null ? kr(c.compensation) : ''}{c.deductible ? <div className="small muted">självrisk {kr(c.deductible)}</div> : null}</td>
            <td className="small">{STATUS[c.status]}{c.paid_on && ` ${c.paid_on}`}{c.fund_claim_id && <div>Kan sättas av till ersättningsfond</div>}</td>
            <td>{c.status === 'reported' && <form action={assessAction.bind(null, id, c.id)} className="stack" style={{ gap: '.25rem' }}>
              <div className="row" style={{ gap: '.25rem' }}><input name="assessed" placeholder="Värdering" inputMode="decimal" style={{ width: '7rem' }} /><input name="deductible" placeholder="Självrisk" inputMode="decimal" style={{ width: '6rem' }} /></div>
              <div className="row" style={{ gap: '.25rem' }}><input type="date" name="date" defaultValue={t} /><label className="small"><input type="checkbox" name="denied" /> Ingen ersättning</label><button className="link">Registrera besked</button></div></form>}
              {c.status === 'assessed' && <form action={payAction.bind(null, id, c.id)} className="row" style={{ gap: '.25rem' }}><input type="date" name="date" defaultValue={t} /><button className="link">Utbetald</button></form>}</td></tr>))}
          {!claims.length && <tr><td colSpan={8} className="muted">Inga skador.</td></tr>}</tbody></table>

      <h2>Anmäl skada</h2>
      <form action={reportAction.bind(null, id)} className="card stack">
        <div className="row">
          <label>Vad som hänt<input name="description" required maxLength={300} /></label>
          <label>Skadedatum<input type="date" name="damage_date" defaultValue={t} required /></label>
          <label>Försäkringsbolag<input name="insurer" /></label>
          <label>Skadenummer<input name="claim_ref" /></label>
        </div>
        <div className="row">
          <label>Avser<select name="kind"><option value="asset">Förstörd anläggningstillgång</option><option value="inventory">Förstörda varor i lager</option><option value="other">Övrigt (reparation, avbrott m.m.)</option></select></label>
          <label>Tillgång<select name="asset_id"><option value="">–</option>{assets.map((a) => <option key={a.id} value={a.id}>{a.name}</option>)}</select></label>
          <label>Artikel<select name="product_id"><option value="">–</option>{products.map((p) => <option key={p.id} value={p.id}>{p.label}</option>)}</select></label>
          <label>Antal<input name="quantity" inputMode="decimal" style={{ width: '5rem' }} /></label>
        </div>
        <div><button>Anmäl skada</button></div>
      </form>
    </div>
  );
}
