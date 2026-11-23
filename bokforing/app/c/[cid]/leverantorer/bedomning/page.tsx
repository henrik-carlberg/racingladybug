import Link from 'next/link';
import { requireCompany } from '@/lib/server/auth';
import { Flash, type SP } from '@/components/ui';
import { kr, today } from '@/lib/format';
import { CHECKS, LEVELS } from '@/lib/supplier-assessment';
import { overview } from '@/lib/services/supplier-assessment';
import { checkAction, riskAction } from './actions';

export const dynamic = 'force-dynamic';
const STATE: Record<string, string> = { ok: '✓', expiring: 'Går snart ut', expired: 'Har gått ut', failed: 'Ej godkänd', missing: 'Saknas' };

export default async function SupplierAssessment({ params, searchParams }: { params: Promise<{ cid: string }>; searchParams: SP }) {
  const { cid } = await params;
  const { company } = await requireCompany(cid, { perm: 'purchasing' });
  const id = company.id;
  const o = await overview(id);
  const t = today();
  return (
    <div style={{ maxWidth: 1150 }}>
      <h1>Leverantörsbedömning</h1>
      <p className="small"><Link href={`/c/${id}/leverantorer`}>← Leverantörer</Link></p>
      <Flash searchParams={searchParams} />
      <p className="small">Varje leverantör har en risknivå som styr vilka kontroller som krävs: låg (F-skatt och moms), medel (även kreditupplysning och ansvarsförsäkring) och hög (även kollektivavtal och uppförandekod).
        En kontroll gäller en viss tid. Saknas en kontroll eller har den gått ut visas en varning på leverantörens fakturor innan de betalas.</p>
      <table className="sa-list"><thead><tr><th>Leverantör</th><th>Risk</th><th>Kontroller</th><th className="num">Andel av inköpen</th><th className="num">Obetalt</th><th></th></tr></thead>
        <tbody>{o.suppliers.map((s) => (
          <tr key={s.id} className="sa-row" data-name={s.name} data-ok={s.ok ? '1' : '0'}><td>{s.name}{!s.ok && <div className="small sa-problems" style={{ color: 'var(--danger)' }}>{s.problems.join(', ')}</div>}</td>
            <td><form action={riskAction.bind(null, id, s.id)} className="row" style={{ gap: '.25rem' }}><select name="level" defaultValue={s.level}>{Object.entries(LEVELS).map(([k, v]) => <option key={k} value={k}>{v}</option>)}</select><button className="link">Spara</button></form></td>
            <td className="small">{s.rows.map((r) => <div key={r.kind}>{r.label}: {STATE[r.state]}{r.valid_until && r.state !== 'missing' ? ` (${r.valid_until})` : ''}</div>)}</td>
            <td className="num sa-share">{s.share.toLocaleString('sv-SE')} %{s.share >= 30 && <div className="small" style={{ color: 'var(--danger)' }}>Stort beroende</div>}</td>
            <td className="num">{kr(s.unpaid)}</td>
            <td><form action={checkAction.bind(null, id, s.id)} className="row" style={{ gap: '.25rem' }}>
              <select name="kind">{Object.entries(CHECKS).map(([k, v]) => <option key={k} value={k}>{v}</option>)}</select>
              <select name="ok"><option value="yes">Godkänd</option><option value="no">Ej godkänd</option></select>
              <input type="date" name="checked_on" defaultValue={t} /><input name="valid_months" defaultValue="12" inputMode="numeric" style={{ width: '3.5rem' }} title="Giltig antal månader" />
              <button className="link">Registrera</button></form></td></tr>))}
          {!o.suppliers.length && <tr><td colSpan={6} className="muted">Inga leverantörer.</td></tr>}</tbody></table>
    </div>
  );
}
