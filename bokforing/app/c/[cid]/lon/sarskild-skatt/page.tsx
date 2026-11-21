import Link from 'next/link';
import { requireCompany } from '@/lib/server/auth';
import { Flash, type SP } from '@/components/ui';
import { EXPERT_YEARS } from '@/lib/special-tax';
import { list } from '@/lib/services/special-tax';
import { saveSpecialTax } from './actions';

export const dynamic = 'force-dynamic';

/** Expertskatt och SINK per anställd */
export default async function SpecialTax({ params, searchParams }: { params: Promise<{ cid: string }>; searchParams: SP }) {
  const { cid } = await params;
  const { company } = await requireCompany(cid, { perm: 'payroll' });
  const rows = await list(company.id);
  return (
    <div style={{ maxWidth: 1000 }}>
      <h1>Expertskatt och SINK</h1>
      <p className="small"><Link href={`/c/${company.id}/lon`}>← Lön</Link></p>
      <Flash searchParams={searchParams} />
      <p className="small"><b>Expertskatt</b> (beslut från Forskarskattenämnden): en fjärdedel av lön och förmåner är skattefri och ingår varken i skatteunderlaget eller i underlaget för arbetsgivaravgifter, i högst {EXPERT_YEARS} år.
        <br /><b>SINK</b> (beslut från Skatteverket för den som bor utomlands): 25 % särskild inkomstskatt i stället för skattetabell, redovisas i ruta 274 i arbetsgivardeklarationen. Arbetsgivaravgifter betalas som vanligt.</p>
      <table className="st-list"><thead><tr><th>Anställd</th><th>Beslut</th></tr></thead>
        <tbody>{rows.map((r) => (
          <tr key={r.id} className="st-row" data-name={r.name}><td>{r.name}</td><td>
            <form action={saveSpecialTax.bind(null, company.id, r.id)} className="row">
              <select name="kind" defaultValue={r.kind ?? ''} aria-label="Typ"><option value="">Ingen</option><option value="expert">Expertskatt</option><option value="sink">SINK</option></select>
              <input name="decision" defaultValue={r.decision} placeholder="Beslut nr" aria-label="Beslut" style={{ width: '9rem' }} />
              <input type="date" name="valid_from" defaultValue={r.valid_from ?? ''} aria-label="Gäller från" />
              <input type="date" name="valid_to" defaultValue={r.valid_to ?? ''} aria-label="Gäller till" />
              <button className="secondary small">Spara</button>
            </form></td></tr>))}
          {!rows.length && <tr><td colSpan={2} className="muted">Inga anställda.</td></tr>}</tbody></table>
      <p className="small muted">Beslutet används för lönespecar med utbetalningsdag inom giltighetstiden. Räkna om lönespecarna i en pågående lönekörning efter att du sparat beslutet.</p>
    </div>
  );
}
