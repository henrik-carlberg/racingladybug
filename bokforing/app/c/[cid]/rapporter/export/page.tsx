import { Help } from '@/components/Help';
import Link from 'next/link';
import { requireCompany } from '@/lib/server/auth';
import { fiscalYears } from '@/lib/server/ledger';

export const dynamic = 'force-dynamic';

export default async function Export({ params }: { params: Promise<{ cid: string }> }) {
  const { cid } = await params;
  const { company } = await requireCompany(cid, { allowLocked: true });
  const years = await fiscalYears(company.id);
  return (
    <>
      <h1>Export <Help term="sie" /></h1>
      <p className="muted">SIE 4 innehåller kontoplan, ingående och utgående balanser, resultat och alla verifikationer. Filen kan läsas in i de flesta bokförings- och bokslutsprogram och används ofta av revisorer.</p>
      <table>
        <thead><tr><th>Räkenskapsår</th><th></th></tr></thead>
        <tbody>
          {years.map((y) => (
            <tr key={y.id}><td>{y.start_date} – {y.end_date}</td>
              <td className="num"><a className="btn secondary" href={`/c/${company.id}/rapporter/export/sie?fy=${y.id}`}>Ladda ner SIE 4</a></td></tr>
          ))}
        </tbody>
      </table>
      <h2>Allt</h2>
      <p>All bolagets data – kunder, fakturor, verifikationer, lön, anställda och moduler – som en JSON-fil, för egen säkerhetskopia eller flytt. <a className="btn secondary" href={`/c/${company.id}/rapporter/export/allt`}>Ladda ner allt (JSON)</a></p>
      <h2>Import</h2>
      <p>Byter du från ett annat bokföringsprogram? <Link href={`/c/${company.id}/kom-igang/sie-import`}>Importera en SIE-fil</Link> med kontoplan, ingående balanser och verifikationer.</p>
    </>
  );
}
