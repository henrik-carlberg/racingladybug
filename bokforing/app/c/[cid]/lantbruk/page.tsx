import { requireCompany } from '@/lib/server/auth';
import { Flash, type SP } from '@/components/ui';
import { kr, today } from '@/lib/format';
import { overview } from '@/lib/services/farming';
import { bookAction, countAction, payAction, subsidyAction, typeAction } from './actions';

export const dynamic = 'force-dynamic';
const STATUS: Record<string, string> = { applied: 'Sökt', booked: 'Fordran bokförd', paid: 'Utbetalt' };

export default async function Farming({ params, searchParams }: { params: Promise<{ cid: string }>; searchParams: SP }) {
  const { cid } = await params;
  const { company } = await requireCompany(cid, { perm: 'ledger' });
  const id = company.id;
  const o = await overview(id);
  const t = today();
  return (
    <div style={{ maxWidth: 1000 }}>
      <h1>Lantbruk</h1>
      <Flash searchParams={searchParams} />
      <p className="small">EU-stöd och ersättningar (t.ex. gårdsstöd och miljöersättningar) tas upp som fordran (1684) och intäkt (3981) det år stödet avser – med beviljat belopp, eller sökt belopp som uppskattning i bokslutet. Utbetalningen löser upp fordran, och en skillnad justerar intäkten.
        Djurinventeringen värderas per djurslag (Skatteverkets schablonvärden eller eget värde) och lagerförändringen bokförs mot 1450/4950.</p>
      <h2>Stöd och ersättningar</h2>
      <div className="row"><div className="card stat"><div className="label">Fordran 1684</div><div className="value fm-receivable">{kr(o.receivable)}</div></div></div>
      <table className="fm-subsidies"><thead><tr><th>Stöd</th><th>År</th><th className="num">Sökt</th><th className="num">Bokfört</th><th className="num">Utbetalt</th><th>Status</th><th></th></tr></thead>
        <tbody>{o.subsidies.map((s) => <tr key={s.id} className="fm-row" data-kind={s.kind} data-status={s.status}><td>{s.kind}</td><td>{s.year}</td><td className="num">{kr(s.applied)}</td><td className="num">{s.booked ? kr(s.booked) : ''}</td><td className="num">{s.paid ? kr(s.paid) : ''}</td>
          <td className="small">{STATUS[s.status]}{s.paid_on && ` ${s.paid_on}`}</td>
          <td>{s.status === 'applied' && <form action={bookAction.bind(null, id, s.id)} className="row" style={{ gap: '.25rem' }}><input name="amount" placeholder="Beviljat (tomt = sökt)" inputMode="decimal" style={{ width: '9rem' }} /><button className="link">Bokför fordran</button></form>}
            {s.status !== 'paid' && <form action={payAction.bind(null, id, s.id)} className="row" style={{ gap: '.25rem' }}><input name="amount" placeholder="Utbetalt" inputMode="decimal" style={{ width: '7rem' }} /><input type="date" name="date" defaultValue={t} /><button className="link">Utbetalt</button></form>}</td></tr>)}
          {!o.subsidies.length && <tr><td colSpan={7} className="muted">Inga stöd ännu.</td></tr>}</tbody></table>
      <form action={subsidyAction.bind(null, id)} className="row">
        <label>Stöd<input name="kind" required placeholder="t.ex. Gårdsstöd" /></label>
        <label>Stödår<input name="year" type="number" defaultValue={Number(t.slice(0, 4))} style={{ width: '6rem' }} /></label>
        <label>Sökt belopp (kr)<input name="applied" inputMode="decimal" required style={{ width: '8rem' }} /></label>
        <button>Registrera ansökan</button>
      </form>

      <h2>Djurinventering</h2>
      {o.types.length > 0 && <form action={countAction.bind(null, id)} className="card stack">
        <table><thead><tr><th>Djurslag</th><th className="num">Värde per djur</th><th>Antal</th></tr></thead>
          <tbody>{o.types.map((x) => <tr key={x.id}><td>{x.name}</td><td className="num">{kr(x.value_per_head)}</td><td><input name={`heads_${x.id}`} inputMode="numeric" style={{ width: '5rem' }} aria-label={`Antal ${x.name}`} /></td></tr>)}</tbody></table>
        <div className="row"><label>Inventeringsdag<input type="date" name="date" defaultValue={t} required /></label><button>Värdera och bokför</button></div>
      </form>}
      <table className="fm-valuations"><thead><tr><th>Datum</th><th>Djur</th><th className="num">Värde</th><th className="num">Förändring</th></tr></thead>
        <tbody>{o.valuations.map((v) => <tr key={v.date}><td>{v.date}</td><td className="small">{v.counts.map((c) => `${c.heads} ${c.type}`).join(', ')}</td><td className="num fm-value">{kr(v.value)}</td><td className="num fm-change">{kr(v.change)}</td></tr>)}
          {!o.valuations.length && <tr><td colSpan={4} className="muted">Ingen inventering ännu.</td></tr>}</tbody></table>
      <form action={typeAction.bind(null, id)} className="row">
        <label>Djurslag<input name="name" required placeholder="t.ex. Mjölkkor" /></label>
        <label>Värde per djur (kr)<input name="value_per_head" inputMode="decimal" style={{ width: '7rem' }} /></label>
        <button className="secondary">Spara djurslag</button>
      </form>
    </div>
  );
}
