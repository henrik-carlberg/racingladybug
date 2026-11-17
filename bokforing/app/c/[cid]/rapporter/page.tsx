import { sql } from '@/lib/db';
import { requireCompany } from '@/lib/server/auth';
import { accountSums, fiscalYears, openingBalances } from '@/lib/server/ledger';
import { type SP } from '@/components/ui';
import { kr, today } from '@/lib/format';
import { PrintButton } from '@/components/PrintButton';

export const dynamic = 'force-dynamic';

const RESULT_GROUPS: [string, number, number][] = [
  ['Nettoomsättning', 3000, 3799], ['Övriga rörelseintäkter', 3800, 3999],
  ['Varor, material och tjänster', 4000, 4999], ['Övriga externa kostnader', 5000, 6999],
  ['Personalkostnader', 7000, 7699], ['Avskrivningar', 7700, 7899], ['Övriga rörelsekostnader', 7900, 7999],
  ['Finansiella intäkter', 8000, 8399], ['Finansiella kostnader', 8400, 8499],
  ['Bokslutsdispositioner', 8800, 8899], ['Skatter', 8900, 8989],
];
const BALANCE_GROUPS: [string, number, number][] = [
  ['Anläggningstillgångar', 1000, 1399], ['Varulager', 1400, 1499], ['Kortfristiga fordringar', 1500, 1799], ['Kassa och bank', 1800, 1999],
  ['Eget kapital', 2000, 2099], ['Obeskattade reserver', 2100, 2199], ['Avsättningar', 2200, 2299], ['Långfristiga skulder', 2300, 2399], ['Kortfristiga skulder', 2400, 2999],
];

export default async function Reports({ params, searchParams }: { params: Promise<{ cid: string }>; searchParams: SP }) {
  const { cid } = await params;
  const { company } = await requireCompany(cid);
  const sp = await searchParams;
  const years = await fiscalYears(company.id);
  const fy = years.find((y) => String(y.id) === sp.fy) ?? years.find((y) => y.start_date <= today() && today() <= y.end_date) ?? years[0];
  if (!fy) return <p>Inget räkenskapsår.</p>;
  const to = String(sp.to ?? (fy.end_date < today() ? fy.end_date : today()));
  const from = String(sp.from ?? fy.start_date);
  const sums = await accountSums(company.id, from, to);
  const ib = await openingBalances(company.id, fy.start_date);
  const ub = new Map(ib);
  for (const [n, v] of await accountSums(company.id, fy.start_date, to)) if (n < 3000) ub.set(n, (ub.get(n) ?? 0) + v);
  const names = new Map((await sql<{ number: number; name: string }[]>`SELECT number, name FROM accounts WHERE company_id = ${company.id}`).map((a) => [a.number, a.name]));
  const inRange = (m: Map<number, number>, a: number, b: number) => [...m].filter(([n, v]) => n >= a && n <= b && v !== 0).sort((x, y) => x[0] - y[0]);
  const result = -[...sums].filter(([n]) => n >= 3000 && n <= 8989).reduce((s, [, v]) => s + v, 0);
  const assets = inRange(ub, 1000, 1999).reduce((s, [, v]) => s + v, 0);
  const liab = -inRange(ub, 2000, 2999).reduce((s, [, v]) => s + v, 0);
  return (
    <>
      <div className="header">
        <h1>Resultat- och balansräkning</h1>
        <div className="no-print"><PrintButton /></div>
      </div>
      <form className="card row no-print">
        <label>Räkenskapsår<select name="fy" defaultValue={fy.id}>{years.map((y) => <option key={y.id} value={y.id}>{y.start_date} – {y.end_date}</option>)}</select></label>
        <label>Från<input type="date" name="from" defaultValue={from} /></label>
        <label>Till<input type="date" name="to" defaultValue={to} /></label>
        <div style={{ flex: '0 0 auto' }}><button className="secondary">Visa</button></div>
      </form>
      <p className="muted small">{company.name}, {company.orgnr}. Resultat {from} – {to}. Balans per {to}.</p>

      <h2>Resultaträkning</h2>
      <table>
        <tbody>
          {RESULT_GROUPS.map(([label, a, b]) => {
            const rows = inRange(sums, a, b);
            if (rows.length === 0) return null;
            // Intäkter visas positivt, kostnader negativt
            const total = -rows.reduce((s, [, v]) => s + v, 0);
            return [
              <tr key={label}><th colSpan={2}>{label}</th><th className="num">{kr(total)}</th></tr>,
              ...rows.map(([n, v]) => <tr key={n}><td>{n}</td><td>{names.get(n)}</td><td className="num">{kr(-v)}</td></tr>),
            ];
          })}
          <tr className="sum"><td colSpan={2}>Beräknat resultat</td><td className="num">{kr(result)}</td></tr>
        </tbody>
      </table>

      <h2>Balansräkning</h2>
      <table>
        <thead><tr><th>Konto</th><th>Namn</th><th className="num">Ingående balans</th><th className="num">Utgående balans</th></tr></thead>
        <tbody>
          {BALANCE_GROUPS.map(([label, a, b]) => {
            const accs = [...new Set([...inRange(ib, a, b), ...inRange(ub, a, b)].map(([n]) => n))].sort((x, y) => x - y);
            if (accs.length === 0) return null;
            const sign = a < 2000 ? 1 : -1;
            return [
              <tr key={label}><th colSpan={4}>{label}</th></tr>,
              ...accs.map((n) => <tr key={n}><td>{n}</td><td>{names.get(n)}</td><td className="num">{kr(sign * (ib.get(n) ?? 0))}</td><td className="num">{kr(sign * (ub.get(n) ?? 0))}</td></tr>),
            ];
          })}
          <tr className="sum"><td colSpan={3}>Summa tillgångar</td><td className="num">{kr(assets)}</td></tr>
          <tr className="sum"><td colSpan={3}>Summa eget kapital och skulder (före årets resultat)</td><td className="num">{kr(liab)}</td></tr>
          <tr className="sum"><td colSpan={3}>Årets resultat hittills</td><td className="num">{kr(assets - liab)}</td></tr>
        </tbody>
      </table>
    </>
  );
}
