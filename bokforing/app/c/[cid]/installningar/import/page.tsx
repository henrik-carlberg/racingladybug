import Link from 'next/link';
import { requireCompany } from '@/lib/server/auth';
import { CsvImport } from '@/components/CsvImport';
import { IMPORT_KINDS } from '@/lib/services/csv-import';
import { enabledModules } from '@/lib/modules/enabled';
import { commitCsv, previewCsv } from './actions';

export const dynamic = 'force-dynamic';

export default async function Import({ params }: { params: Promise<{ cid: string }> }) {
  const { cid } = await params;
  const { company } = await requireCompany(cid);
  const lager = (await enabledModules(company.id)).some((m) => m.id === 'lager');
  const b = `/c/${company.id}`;
  return (
    <div>
      <h1>Importera från CSV</h1>
      <p className="muted">Flytta över register och obetalda fakturor från t.ex. Fortnox, Visma eller Excel. Exportera som CSV, välj filen och granska innan något sparas.
        Kolumnerna känns igen på rubrikerna (t.ex. <i>Namn</i>, <i>Organisationsnummer</i>, <i>Fakturanummer</i>, <i>Förfallodatum</i>, <i>Restbelopp</i>). Det som redan finns hoppas över.</p>
      <div className="card small">
        <b>Obetalda fakturor</b> bokförs inte vid importen – fordringarna och skulderna ska redan finnas i den ingående balansen på 1510 och 2440
        (via <Link href={`${b}/installningar`}>ingående balanser</Link> eller SIE-import). När de betalas bokförs betalningen mot 1510/2440. Leverantörsfakturorna behöver attesteras före betalning.
      </div>
      <CsvImport preview={previewCsv.bind(null, company.id)} commit={commitCsv.bind(null, company.id)} kinds={IMPORT_KINDS.filter((k) => k !== 'articles' || lager)} />
    </div>
  );
}
