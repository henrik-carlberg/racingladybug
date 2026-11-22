import Link from 'next/link';
import { requireCompany } from '@/lib/server/auth';
import { Flash, type SP } from '@/components/ui';
import { kr, today } from '@/lib/format';
import { deferrals, interestPreview } from '@/lib/services/tax-interest';
import { addDeferralAction, bookAction, endDeferralAction, rateAction, showAction } from './actions';

export const dynamic = 'force-dynamic';

const STATUS = { active: 'Pågår', soon: 'Går snart ut', expired: 'Har gått ut – betala', ended: 'Avslutat' } as const;
const pct = (v: number) => `${(v / 100).toLocaleString('sv-SE')} %`;

export default async function TaxInterest({ params, searchParams }: { params: Promise<{ cid: string }>; searchParams: SP }) {
  const { cid } = await params;
  const sp = await searchParams;
  const { company } = await requireCompany(cid, { perm: 'ledger' });
  const id = company.id;
  const t = today();
  const prev = new Date(Date.UTC(Number(t.slice(0, 4)), Number(t.slice(5, 7)) - 2, 1)).toISOString().slice(0, 7);
  const period = typeof sp.period === 'string' && /^\d{4}-(0[1-9]|1[0-2])$/.test(sp.period) ? sp.period : prev;
  const p = await interestPreview(id, period);
  const defs = await deferrals(id);
  return (
    <div style={{ maxWidth: 900 }}>
      <h1>Ränta och anstånd på skattekontot</h1>
      <p className="small"><Link href={`/c/${id}/skattekonto`}>← Skattekontot</Link></p>
      <Flash searchParams={searchParams} />
      <h2>Ränta</h2>
      <p className="small">Räntan räknas dag för dag på saldot på skattekontot (1630 plus beviljade anstånd). Kostnadsräntan är inte avdragsgill (8423) och intäktsräntan är skattefri (8314).
        Om du läser in skattekontofilen och bokför Skatteverkets räntor därifrån behöver du inte bokföra räntan här.</p>
      <div className="row" style={{ alignItems: 'end', gap: '1rem' }}>
        <form action={showAction.bind(null, id)} className="row" style={{ alignItems: 'end' }}><label>Månad<input type="month" name="period" defaultValue={period} /></label><button className="secondary">Visa</button></form>
        <form action={rateAction.bind(null, id, period)} className="row" style={{ alignItems: 'end' }}><label>Basränta (%)<input name="base_rate" defaultValue={(p.base / 100).toString().replace('.', ',')} style={{ width: '6rem' }} /></label><button className="secondary">Spara</button></form>
      </div>
      <div className="grid" style={{ marginTop: '1rem' }}>
        <div className="card stat"><div className="label">Kostnadsränta ({pct(p.rates.cost)})</div><div className="value ti-cost">{kr(p.cost)}</div></div>
        <div className="card stat"><div className="label">Intäktsränta ({pct(p.rates.income)})</div><div className="value ti-income">{kr(p.income)}</div></div>
        <div className="card stat"><div className="label">Lägsta saldo i månaden</div><div className="value ti-lowest">{kr(p.lowest)}</div></div>
      </div>
      <p className="small muted">Låg kostnadsränta på anståndsbelopp: {pct(p.rates.low)}.</p>
      {p.booked ? <p className="ti-booked">Räntan för {period} är bokförd – <Link href={`/c/${id}/verifikationer/${p.booked.voucher_id}`}>verifikation</Link>.</p>
        : p.imported ? <p className="ti-booked">Räntan för {period} är bokförd från skattekontofilen.</p>
        : !p.ended ? <p className="muted">Räntan kan bokföras när månaden är slut.</p>
        : (p.cost || p.income) ? <form action={bookAction.bind(null, id, period)}><button>Bokför räntan för {period}</button> <span className="small muted">Bokförs {period}-sista dagen: {p.cost ? 'debet 8423, kredit 1630' : ''}{p.cost && p.income ? ' och ' : ''}{p.income ? 'debet 1630, kredit 8314' : ''}.</span></form>
        : <p className="muted">Ingen ränta för månaden.</p>}

      <h2>Anstånd med inbetalning</h2>
      <p className="small">När Skatteverket beviljar anstånd tillgodoförs beloppet skattekontot fram till slutdagen. Skulden finns kvar i bokföringen, och på beloppet tas låg kostnadsränta ut.
        Du får en påminnelse två veckor innan anståndet går ut.</p>
      <table className="td-list"><thead><tr><th>Belopp</th><th>Från</th><th>Till</th><th>Notering</th><th>Status</th><th></th></tr></thead>
        <tbody>{defs.map((d) => (
          <tr key={d.id} className="td-row" data-status={d.status}><td className="num">{kr(d.amount)}</td><td>{d.start}</td><td>{d.end}</td><td>{d.note}</td>
            <td>{d.status === 'expired' ? <span className="badge danger">{STATUS[d.status]}</span> : d.status === 'soon' ? <span className="badge warn">{STATUS[d.status]}</span> : STATUS[d.status]}{d.ended && ` ${d.ended}`}</td>
            <td>{!d.ended && <form action={endDeferralAction.bind(null, id, period, d.id)} className="row" style={{ gap: '.25rem' }}><input type="date" name="date" defaultValue={t} /><button className="link">Avsluta</button></form>}</td></tr>))}
          {!defs.length && <tr><td colSpan={6} className="muted">Inga anstånd.</td></tr>}</tbody></table>
      <form action={addDeferralAction.bind(null, id, period)} className="card row" style={{ alignItems: 'end', marginTop: '1rem' }}>
        <label>Belopp (kr)<input name="amount" inputMode="decimal" required /></label>
        <label>Från<input type="date" name="start_date" defaultValue={t} required /></label>
        <label>Till<input type="date" name="end_date" required /></label>
        <label style={{ flex: '1 1 200px' }}>Notering<input name="note" maxLength={300} placeholder="T.ex. anstånd med moms enligt beslut" /></label>
        <button>Registrera anstånd</button>
      </form>
    </div>
  );
}
