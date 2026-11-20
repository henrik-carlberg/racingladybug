import { requireCompany } from '@/lib/server/auth';
import { sql } from '@/lib/db';
import { accountSums } from '@/lib/server/ledger';
import { vatReport } from '@/lib/vat';
import { vatChecks } from '@/lib/services/tax-planning';
import { Flash, type SP } from '@/components/ui';
import { kr, monthEnd, today } from '@/lib/format';
import { correctVat, settleVat } from './actions';
import { correctionStatus } from '@/lib/services/vat-correction';
import { prepareVat } from '../../inlamning/actions';
import { Help } from '@/components/Help';

export const dynamic = 'force-dynamic';

function defaultPeriod(kind: 'month' | 'quarter' | 'year', t: string) {
  const [y, m] = t.split('-').map(Number);
  // Föregående avslutade period
  if (kind === 'month') { const pm = m === 1 ? 12 : m - 1; const py = m === 1 ? y - 1 : y; const p = `${py}-${String(pm).padStart(2, '0')}`; return [`${p}-01`, monthEnd(p)]; }
  if (kind === 'quarter') {
    let q = Math.floor((m - 1) / 3) - 1, qy = y; if (q < 0) { q = 3; qy--; }
    const sm = q * 3 + 1;
    return [`${qy}-${String(sm).padStart(2, '0')}-01`, monthEnd(`${qy}-${String(sm + 2).padStart(2, '0')}`)];
  }
  return [`${y - 1}-01-01`, `${y - 1}-12-31`];
}

export default async function Vat({ params, searchParams }: { params: Promise<{ cid: string }>; searchParams: SP }) {
  const { cid } = await params;
  const { company } = await requireCompany(cid);
  const sp = await searchParams;
  const [df, dt] = defaultPeriod(company.vat_period, today());
  const from = String(sp.from ?? df), to = String(sp.to ?? dt);
  const sums = await accountSums(company.id, from, to, { excludeVatSettlements: true });
  const { boxes, toPay } = vatReport(sums);
  const checks = await vatChecks(company.id, from, to);
  const corr = await correctionStatus(company.id, from, to);
  const [settled] = await sql<{ id: number; label: string }[]>`
    SELECT v.id, v.series || v.number AS label FROM vouchers v WHERE v.company_id = ${company.id} AND v.source_type = 'vat'
      AND v.date BETWEEN ${from} AND ${to} AND NOT EXISTS (SELECT 1 FROM vouchers r WHERE r.corrects_id = v.id)`;
  return (
    <>
      <h1>Momsrapport <Help term="moms" /></h1>
      <Flash searchParams={searchParams} />
      <form className="card row">
        <label>Från<input type="date" name="from" defaultValue={from} /></label>
        <label>Till<input type="date" name="to" defaultValue={to} /></label>
        <div style={{ flex: '0 0 auto' }}><button className="secondary">Visa</button></div>
      </form>
      <p className="muted small">Momsredovisning per {company.vat_period === 'month' ? 'månad' : company.vat_period === 'quarter' ? 'kvartal' : 'år'}. Fyll i rutorna i Skatteverkets e-tjänst Momsdeklaration. Belopp i hela kronor.</p>
      <table>
        <thead><tr><th>Ruta</th><th>Beskrivning</th><th className="num">Belopp (kr)</th></tr></thead>
        <tbody>
          {boxes.filter((b) => b.amount !== 0 || ['05', '10', '48', '49'].includes(b.box)).map((b) => (
            <tr key={b.box} className={b.box === '49' ? 'sum' : undefined}>
              <td>{b.box}</td><td>{b.label}</td><td className="num">{kr(Math.trunc(b.amount / 100) * 100).replace(/,00$/, '')}</td>
            </tr>
          ))}
        </tbody>
      </table>
      <section className="vat-checks">
        <h2>Avstämning ruta för ruta</h2>
        <ul className="stack" style={{ listStyle: 'none', padding: 0 }}>{checks.checks.map((c) => (
          <li key={c.key} className={`card vat-check ${c.ok ? 'ok' : 'warn'}`}><b>{c.ok ? '✅' : '⚠️'} {c.title}</b><div className="small">{c.detail}</div></li>
        ))}</ul>
        {!checks.filed && <p className="small muted">När deklarationen är inlämnad jämförs bokföringen med den – ändringar efteråt visas här.</p>}
      </section>
      <p>{toPay >= 0 ? `Moms att betala: ${kr(toPay)}` : `Moms att få tillbaka: ${kr(-toPay)}`}</p>
      <form action={prepareVat.bind(null, company.id)} className="card actions">
        <input type="hidden" name="from" value={from} /><input type="hidden" name="to" value={to} />
        <button className="secondary">Förbered momsdeklaration för inlämning</button>
        <span className="muted small">Skapar en eSKD-fil för Skatteverket som du kan lämna in direkt eller via e-tjänsten.</span>
      </form>
      {corr && (corr.needed ? (
        <section className="card stack vat-correction">
          <h2 style={{ margin: 0, fontSize: '1.05rem' }}>Perioden är deklarerad – bokföringen har ändrats sedan dess</h2>
          <table><thead><tr><th>Ruta</th><th>Beskrivning</th><th className="num">Deklarerat</th><th className="num">Nu</th><th className="num">Skillnad</th></tr></thead>
            <tbody>{corr.rows.map((r) => <tr key={r.box} className="corr-row" data-box={r.box}><td>{r.box}</td><td>{r.label}</td><td className="num">{kr(r.declared)}</td><td className="num">{kr(r.current)}</td><td className="num">{kr(r.diff)}</td></tr>)}</tbody></table>
          <p style={{ margin: 0 }}>{corr.toPayDiff >= 0 ? <>Rättelsen ger <b className="corr-diff">{kr(corr.toPayDiff)}</b> kr mer att betala.</> : <>Rättelsen ger <b className="corr-diff">{kr(-corr.toPayDiff)}</b> kr tillbaka.</>}
            {corr.daysLate > 0 && corr.toPayDiff > 0 ? ` Momsen förföll ${corr.due} – Skatteverket debiterar kostnadsränta från förfallodagen (${corr.daysLate} dagar hittills).` : corr.toPayDiff < 0 ? ' Du får intäktsränta på det som betalats för mycket.' : ''}</p>
          <form action={correctVat.bind(null, company.id)} className="row">
            <input type="hidden" name="from" value={from} /><input type="hidden" name="to" value={to} />
            <label>Bokför rättelsen per<input type="date" name="date" defaultValue={today()} /></label>
            <div style={{ flex: '0 0 auto' }}><button>Bokför rättelse och förbered ny deklaration</button></div>
          </form>
          <p className="small muted" style={{ margin: 0 }}>En rättelse lämnas som en ny, fullständig momsdeklaration för perioden. Ändringen förs från momskontona till 2650 med dagens datum så att låsta perioder inte påverkas.</p>
        </section>
      ) : <p className="small muted vat-declared">Perioden är deklarerad{corr.corrections ? ` och rättad ${corr.corrections} gång${corr.corrections > 1 ? 'er' : ''}` : ''} – bokföringen stämmer med deklarationen.</p>)}
      {settled ? <p className="muted">Momsen för perioden är avräknad i <a href={`/c/${company.id}/verifikationer/${settled.id}`}>{settled.label}</a>.</p> : (
        <form action={settleVat.bind(null, company.id)} className="card actions">
          <input type="hidden" name="from" value={from} /><input type="hidden" name="to" value={to} />
          <button>Bokför momsavräkning per {to}</button><Help term="momsavrakning" />
          <span className="muted small">Flyttar periodens moms från 26xx till 2650 Redovisningskonto för moms.</span>
        </form>
      )}
    </>
  );
}
