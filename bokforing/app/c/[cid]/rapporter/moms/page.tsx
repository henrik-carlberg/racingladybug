import { requireCompany } from '@/lib/server/auth';
import { sql } from '@/lib/db';
import { accountSums } from '@/lib/server/ledger';
import { vatReport } from '@/lib/vat';
import { Flash, type SP } from '@/components/ui';
import { kr, monthEnd, today } from '@/lib/format';
import { settleVat } from './actions';

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
  const [settled] = await sql<{ id: number; label: string }[]>`
    SELECT v.id, v.series || v.number AS label FROM vouchers v WHERE v.company_id = ${company.id} AND v.source_type = 'vat'
      AND v.date BETWEEN ${from} AND ${to} AND NOT EXISTS (SELECT 1 FROM vouchers r WHERE r.corrects_id = v.id)`;
  return (
    <>
      <h1>Momsrapport</h1>
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
      <p>{toPay >= 0 ? `Moms att betala: ${kr(toPay)}` : `Moms att få tillbaka: ${kr(-toPay)}`}</p>
      {settled ? <p className="muted">Momsen för perioden är avräknad i <a href={`/c/${company.id}/verifikationer/${settled.id}`}>{settled.label}</a>.</p> : (
        <form action={settleVat.bind(null, company.id)} className="card actions">
          <input type="hidden" name="from" value={from} /><input type="hidden" name="to" value={to} />
          <button>Bokför momsavräkning per {to}</button>
          <span className="muted small">Flyttar periodens moms från 26xx till 2650 Redovisningskonto för moms.</span>
        </form>
      )}
    </>
  );
}
