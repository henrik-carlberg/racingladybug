import Link from 'next/link';
import { requireCompany } from '@/lib/server/auth';
import { Flash, type SP } from '@/components/ui';
import { kr, today } from '@/lib/format';
import { overview } from '@/lib/services/board-fees';
import { addMember, payFee } from './actions';

export const dynamic = 'force-dynamic';

/** Styrelsearvoden per stämmoperiod: lön eller faktura, F-skatt och skatteavdrag */
export default async function BoardFees({ params, searchParams }: { params: Promise<{ cid: string }>; searchParams: SP }) {
  const { cid } = await params;
  const { company } = await requireCompany(cid, { perm: 'payroll' });
  const o = await overview(company.id);
  const t = today();
  return (
    <div style={{ maxWidth: 1000 }}>
      <h1>Styrelsearvoden</h1>
      <p className="small"><Link href={`/c/${company.id}/lon`}>← Lön</Link></p>
      <Flash searchParams={searchParams} />
      <p className="small">Styrelsearvode är normalt lön: det betalas i lönekörningen med skatteavdrag och arbetsgivaravgifter och redovisas i arbetsgivardeklarationen. Det får faktureras bara om uppdraget utförs i ledamotens
        näringsverksamhet och mottagaren har F-skatt. Saknas F-skatt dras 30 % skatt, och för fysiska personer betalas arbetsgivaravgifter (utom när ersättningen understiger 1 000 kr på ett år).</p>
      <table className="bf-members"><thead><tr><th>Ledamot</th><th>Stämmoperiod</th><th className="num">Arvode</th><th className="num">Utbetalt</th><th>Hantering</th><th></th></tr></thead>
        <tbody>{o.rows.map((m) => (
          <tr key={m.id} className="bf-row" data-name={m.name}><td>{m.name} <span className="small muted">{m.role}</span></td><td>{m.period}</td><td className="num">{kr(m.annual_fee)}</td><td className="num bf-paid">{kr(m.paid)}</td>
            <td className="small bf-note">{m.assessment.note}</td>
            <td><form action={payFee.bind(null, company.id, m.id)} className="row">
              <input name="amount" defaultValue={(Math.max(0, m.annual_fee - m.paid) / 100).toFixed(2).replace('.', ',')} aria-label="Belopp" style={{ width: '8rem' }} />
              {m.assessment.treatment === 'salary'
                ? <select name="run_id" aria-label="Lönekörning">{o.runs.map((r) => <option key={r.id} value={r.id}>Lön {r.period}</option>)}{!o.runs.length && <option value="">Skapa en lönekörning först</option>}</select>
                : <input type="date" name="date" defaultValue={t} aria-label="Datum" />}
              <button className="secondary small">{m.assessment.treatment === 'salary' ? 'Lägg i lönekörning' : 'Bokför utbetalning'}</button></form></td></tr>))}
          {!o.rows.length && <tr><td colSpan={6} className="muted">Inga ledamöter registrerade.</td></tr>}</tbody></table>
      <form action={addMember.bind(null, company.id)} className="card stack" style={{ marginTop: '1rem' }}>
        <div className="row">
          <label>Namn<input name="name" required maxLength={200} /></label>
          <label>Person-/organisationsnummer<input name="id_number" /></label>
          <label>Roll<input name="role" defaultValue="ledamot" /></label>
          <label>Årsstämma<input type="date" name="agm_date" defaultValue={t} required /></label>
          <label>Arvode för perioden (kr)<input name="annual_fee" /></label>
        </div>
        <div className="row">
          <label>Betalning<select name="mode"><option value="salary">Som lön</option><option value="invoice">Mot faktura</option></select></label>
          <label>Mottagare<select name="recipient"><option value="person">Ledamoten själv</option><option value="company">Ledamotens bolag</option></select></label>
          <label className="row" style={{ alignItems: 'center' }}><input type="checkbox" name="f_skatt" /> Har F-skatt</label>
          <label className="row" style={{ alignItems: 'center' }}><input type="checkbox" name="in_business" /> Uppdraget ingår i mottagarens näringsverksamhet</label>
        </div>
        <button>Registrera ledamot</button>
      </form>
    </div>
  );
}
