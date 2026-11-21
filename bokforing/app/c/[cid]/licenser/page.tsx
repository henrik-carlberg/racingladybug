import { requireCompany } from '@/lib/server/auth';
import { Flash, type SP } from '@/components/ui';
import { kr, today } from '@/lib/format';
import { overview } from '@/lib/services/royalty';
import { addAgreement, pay, report } from './actions';

export const dynamic = 'force-dynamic';

/** Licensintäkter och royalty med avräkning av utländsk källskatt */
export default async function Licenses({ params, searchParams }: { params: Promise<{ cid: string }>; searchParams: SP }) {
  const { cid } = await params;
  const { company } = await requireCompany(cid, { perm: 'ledger' });
  const o = await overview(company.id);
  return (
    <div style={{ maxWidth: 1000 }}>
      <h1>Licensintäkter och royalty</h1>
      <Flash searchParams={searchParams} />
      <p className="small">Royalty räknas på licenstagarens rapporterade försäljning, lägst den garanterade minimiavgiften, och bokförs på 3920. Svenska licenstagare faktureras med 25 % moms;
        till utländska företag är det en tjänsteexport utan svensk moms. Utländsk källskatt som licenstagaren drar av kan avräknas mot svensk skatt, högst med den svenska skatten på inkomsten.
        Det som har dragits utöver skatteavtalets sats ska i stället återsökas i källstaten.</p>
      {o.agreements.map((a) => (
        <section key={a.id} className="card stack lic-agreement" data-licensee={a.licensee} style={{ marginBottom: '1rem' }}>
          <h3 style={{ margin: 0 }}>{a.licensee} <span className="small muted">{a.country}, {a.rate} %{a.minimum ? `, minst ${kr(a.minimum)} kr per period` : ''}{a.treaty_rate != null ? `, avtalssats ${a.treaty_rate} %` : ''}</span></h3>
          <table><tbody>{o.reports.filter((r) => r.agreement_id === a.id).map((r) => (
            <tr key={r.id} className="lic-report" data-period={r.period}><td>{r.period}</td><td className="num">{kr(r.sales)}</td><td className="num lic-amount">{kr(r.amount)}</td>
              <td>{r.paid_on ? <span className="lic-paid">Betald {r.paid_on}{r.withheld ? `, källskatt ${kr(r.withheld)}` : ''}</span> : (
                <form action={pay.bind(null, company.id, r.id)} className="row" style={{ gap: '.25rem' }}>
                  <input type="date" name="date" defaultValue={today()} />{a.country !== 'SE' && <input name="withheld" placeholder="Källskatt kr" style={{ width: '7rem' }} />}<button className="secondary">Inbetald</button></form>)}</td></tr>
          ))}</tbody></table>
          <form action={report.bind(null, company.id, a.id)} className="row">
            <label>Period<input name="period" required maxLength={20} placeholder="2026 Q1" style={{ width: '7rem' }} /></label>
            <label>Licenstagarens försäljning (kr)<input name="sales" required style={{ width: '9rem' }} /></label>
            <label>Datum<input type="date" name="date" defaultValue={today()} /></label>
            <div style={{ flex: '0 0 auto' }}><button>Bokför royalty</button></div>
          </form>
        </section>
      ))}
      {o.credits.length > 0 && <><h2>Avräkning av utländsk skatt</h2>
        <table className="lic-credits"><thead><tr><th>Licenstagare</th><th className="num">Royalty</th><th className="num">Källskatt</th><th className="num">Avräkningsbar</th><th className="num">Återsök i källstaten</th></tr></thead>
          <tbody>{o.credits.map((c) => <tr key={c.licensee} className="lic-credit" data-licensee={c.licensee}><td>{c.licensee} ({c.country})</td><td className="num">{kr(c.gross)}</td><td className="num">{kr(c.withheld)}</td>
            <td className="num lic-creditable">{kr(c.creditable)}</td><td className="num lic-reclaim">{kr(c.reclaim)}</td></tr>)}</tbody></table>
        <p className="small muted">Avräkningen görs i inkomstdeklarationen (begäran om avräkning av utländsk skatt). Den bokförda källskatten ligger på 8910.</p></>}
      <form action={addAgreement.bind(null, company.id)} className="card row" style={{ marginTop: '1rem' }}>
        <label>Licenstagare<input name="licensee" required maxLength={200} /></label>
        <label>Land<input name="country" required maxLength={2} defaultValue="SE" style={{ width: '4rem' }} /></label>
        <label>Royalty %<input name="rate" required style={{ width: '5rem' }} /></label>
        <label>Minimiavgift per period (kr)<input name="minimum" defaultValue="0" style={{ width: '8rem' }} /></label>
        <label>Avtalssats källskatt %<input name="treaty_rate" style={{ width: '5rem' }} /></label>
        <div style={{ flex: '0 0 auto' }}><button>Spara licensavtal</button></div>
      </form>
    </div>
  );
}
