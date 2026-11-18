import Link from 'next/link';
import { requireCompany } from '@/lib/server/auth';
import { Flash, type SP } from '@/components/ui';
import { kr, today } from '@/lib/format';
import { addMonths, periodOf } from '@/lib/assets';
import { ACCRUAL_KINDS } from '@/lib/accruals';
import { listAccruals, vacationLiabilitySuggestion } from '@/lib/services/accruals';
import { listCostCenters } from '@/lib/services/dimensions';
import { fiscalYears } from '@/lib/server/ledger';
import { bookVacation, create, remove, run } from './actions';

export const dynamic = 'force-dynamic';

export default async function Accruals({ params, searchParams }: { params: Promise<{ cid: string }>; searchParams: SP }) {
  const { cid } = await params;
  const { company } = await requireCompany(cid);
  const t = today();
  const prevMonth = addMonths(periodOf(t), -1);
  const years = await fiscalYears(company.id);
  const fy = years.find((y) => y.start_date <= t && t <= y.end_date) ?? years[0];
  const asOf = String((await searchParams).asof ?? fy?.end_date ?? t);
  const [list, ccs, vac] = await Promise.all([listAccruals(company.id), listCostCenters(company.id, true), vacationLiabilitySuggestion(company.id, asOf)]);
  const due = list.reduce((s, a) => {
    const months = Math.max(0, Math.min(a.months, (Number(prevMonth.slice(0, 4)) - Number(a.first_period.slice(0, 4))) * 12 + Number(prevMonth.slice(5)) - Number(a.first_period.slice(5)) + 1));
    const planned = months >= a.months ? Number(a.amount) : Math.floor(Number(a.amount) / a.months) * months;
    return s + Math.max(0, planned - Number(a.booked));
  }, 0);
  const b = `/c/${company.id}`;
  return (
    <div>
      <h1>Periodiseringar och bokslutsposter</h1>
      <Flash searchParams={searchParams} />
      <p className="muted">Fördela kostnader och intäkter över de månader de gäller, t.ex. en årsförsäkring eller en hyra som betalats i förskott (förutbetald kostnad, 1790)
        eller ett supportavtal som fakturerats för ett år (förutbetald intäkt, 2990). Varje månad bokförs sin andel mot resultatkontot.</p>

      <form action={run.bind(null, company.id)} className="card row" style={{ alignItems: 'end' }}>
        <label style={{ flex: '0 0 180px' }}>Bokför till och med<input type="month" name="period" defaultValue={prevMonth} required /></label>
        <div style={{ flex: '0 0 auto' }}><button>Bokför periodiseringar</button></div>
        <span className="small muted">{due ? `${kr(due)} kr återstår att bokföra till och med ${prevMonth}` : `Allt är bokfört till och med ${prevMonth}`}</span>
      </form>

      <div className="table-wrap">
        <table>
          <thead><tr><th>Beskrivning</th><th>Typ</th><th>Konto</th><th>Period</th><th className="num">Belopp</th><th className="num">Bokfört</th><th className="num">Kvar</th><th></th></tr></thead>
          <tbody>
            {list.map((a) => (
              <tr key={a.id}>
                <td>{a.description}{a.source_voucher_id && <> <Link className="small" href={`${b}/verifikationer/${a.source_voucher_id}`}>omföring</Link></>}</td>
                <td>{ACCRUAL_KINDS[a.kind].label}</td>
                <td>{a.result_account} / {a.balance_account}</td>
                <td>{a.first_period} – {addMonths(a.first_period, a.months - 1)} ({a.months} mån)</td>
                <td className="num">{kr(a.amount)}</td><td className="num">{kr(a.booked)}</td><td className="num">{kr(Number(a.amount) - Number(a.booked))}</td>
                <td>{!Number(a.booked) && <form action={remove.bind(null, company.id, a.id)}><button className="link">Ta bort</button></form>}</td>
              </tr>
            ))}
            {list.length === 0 && <tr><td colSpan={8} className="muted">Inga periodiseringar.</td></tr>}
          </tbody>
        </table>
      </div>

      <h2>Ny periodisering</h2>
      <form action={create.bind(null, company.id)} className="card stack">
        <div className="row">
          <label style={{ flex: '2 1 260px' }}>Beskrivning<input name="description" required placeholder="T.ex. Företagsförsäkring 2027" /></label>
          <label>Typ<select name="kind">{Object.entries(ACCRUAL_KINDS).map(([k, v]) => <option key={k} value={k}>{v.label} ({v.balance})</option>)}</select></label>
        </div>
        <div className="row">
          <label>Belopp exkl. moms<input name="amount" inputMode="decimal" required /></label>
          <label>Kostnads- eller intäktskonto<input name="result_account" inputMode="numeric" required placeholder="T.ex. 6310" /></label>
          <label>Första månad<input type="month" name="first_period" defaultValue={periodOf(t)} required /></label>
          <label>Antal månader<input name="months" inputMode="numeric" defaultValue="12" required /></label>
          {ccs.length > 0 && <label>Kostnadsställe<select name="cost_center_id"><option value="">–</option>{ccs.map((c) => <option key={c.id} value={c.id}>{c.code} {c.name}</option>)}</select></label>}
        </div>
        <div className="row" style={{ alignItems: 'end' }}>
          <label className="row" style={{ alignItems: 'center', gap: '.5rem', flex: '1 1 320px' }}><input type="checkbox" name="transfer" defaultChecked style={{ width: 'auto' }} />
            <span>Flytta beloppet från resultatkontot till balanskontot (om fakturan redan har bokförts som kostnad eller intäkt)</span></label>
          <label style={{ flex: '0 0 180px' }}>Datum för omföring<input type="date" name="transfer_date" defaultValue={t} /></label>
        </div>
        <div><button>Lägg upp periodisering</button></div>
      </form>

      <h2>Semesterlöneskuld</h2>
      <form className="row card" style={{ alignItems: 'end' }}>
        <label style={{ flex: '0 0 180px' }}>Per datum<input type="date" name="asof" defaultValue={asOf} /></label>
        <div style={{ flex: '0 0 auto' }}><button className="secondary">Beräkna</button></div>
        <span className="small muted">Outtagna semesterdagar × 4,6 % av månadslönen (sammalöneregeln) plus arbetsgivaravgifter efter ålder.</span>
      </form>
      {vac.rows.length === 0 ? <p className="muted">Inga aktiva anställda.</p> : (
        <>
          <div className="table-wrap">
            <table>
              <thead><tr><th>Anställd</th><th className="num">Dagar kvar</th><th className="num">Månadslön</th><th className="num">Skuld</th><th className="num">Avgifter</th></tr></thead>
              <tbody>
                {vac.rows.map((r) => <tr key={r.name}><td>{r.name}</td><td className="num">{r.daysLeft}</td><td className="num">{kr(r.monthly)}</td><td className="num">{kr(r.liability)}</td><td className="num">{kr(r.fee)}</td></tr>)}
                <tr><td colSpan={3}><b>Beräknat</b></td><td className="num"><b>{kr(vac.liability)}</b></td><td className="num"><b>{kr(vac.fee)}</b></td></tr>
                <tr><td colSpan={3}>Bokfört (2920 / 2940)</td><td className="num">{kr(vac.booked.liability)}</td><td className="num">{kr(vac.booked.fee)}</td></tr>
                <tr><td colSpan={3}>Justering</td><td className="num">{kr(vac.adjust.liability)}</td><td className="num">{kr(vac.adjust.fee)}</td></tr>
              </tbody>
            </table>
          </div>
          {(vac.adjust.liability !== 0 || vac.adjust.fee !== 0) && (
            <form action={bookVacation.bind(null, company.id)} className="card actions">
              <input type="hidden" name="date" value={asOf} />
              <button>Bokför justeringen per {asOf}</button>
              <span className="small muted">7290 mot 2920 och 7519 mot 2940. Kontrollera dagarna under Frånvaro först.</span>
            </form>
          )}
        </>
      )}
    </div>
  );
}
