import Link from 'next/link';
import { sql } from '@/lib/db';
import { requireCompany } from '@/lib/server/auth';
import { Flash, type SP } from '@/components/ui';
import { DpaText } from '@/components/DpaText';
import { prunableEmployees, pruneBefore } from '@/lib/services/gdpr';
import { RETENTION_YEARS } from '@/lib/legal';
import { approveDpa, prune } from '@/app/gdpr-actions';

export const dynamic = 'force-dynamic';

const RECORD = [
  ['Bokföring och fakturering', 'Kunder, leverantörer, kontaktpersoner', 'Namn, adress, org.nr/personnr, e-post, fakturor, betalningar', 'Rättslig förpliktelse (bokföringslagen)', `${RETENTION_YEARS} år efter räkenskapsårets utgång`],
  ['Lön och arbetsgivardeklaration', 'Anställda', 'Namn, personnummer, adress, bankkonto, lön, skatt, förmåner', 'Avtal (anställning) och rättslig förpliktelse (skatteförfarandelagen)', `${RETENTION_YEARS} år`],
  ['Frånvaro och sjuklön', 'Anställda', 'Sjukfrånvaro (hälsa – känslig uppgift), semester, VAB, ledighet', 'Rättslig förpliktelse (sjuklönelagen, semesterlagen), art. 9.2 b', 'Under anställningen och lagringstiden för lön'],
  ['Tidrapportering', 'Anställda och användare', 'Arbetad tid per uppdrag', 'Avtal och berättigat intresse (fakturering)', `${RETENTION_YEARS} år om tiden har fakturerats`],
  ['Användarkonton', 'Användare', 'Namn, e-post, inloggningar, behörighetslogg', 'Avtal och berättigat intresse (säkerhet)', 'Så länge kontot finns'],
  ['CRM och marknadsföring (om aktiverat)', 'Kontaktpersoner och leads', 'Namn, kontaktuppgifter, aktiviteter, samtycke', 'Berättigat intresse eller samtycke', 'Tills kontakten tas bort eller samtycket återkallas'],
];

export default async function Gdpr({ params, searchParams }: { params: Promise<{ cid: string }>; searchParams: SP }) {
  const { cid } = await params;
  const { company, role } = await requireCompany(cid);
  const [d] = await sql<{ at: string | null; by: string | null }[]>`
    SELECT to_char(c.dpa_accepted_at,'YYYY-MM-DD') AS at, u.name AS by FROM companies c LEFT JOIN users u ON u.id = c.dpa_accepted_by WHERE c.id = ${company.id}`;
  const prunable = await prunableEmployees(company.id);
  const owner = role === 'owner';
  return (
    <div style={{ maxWidth: 900 }}>
      <h1>Dataskydd (GDPR)</h1>
      <Flash searchParams={searchParams} />
      <p className="muted">Ert bolag är personuppgiftsansvarigt för uppgifterna om era anställda, kunder och leverantörer. Tjänsten är personuppgiftsbiträde. <Link href="/integritet">Integritetspolicy</Link></p>

      <h2>Personuppgiftsbiträdesavtal</h2>
      <div className="card">
        {d.at ? <p><span className="badge ok">Godkänt</span> {d.at} av {d.by ?? 'okänd'}</p>
          : <p><span className="badge warn">Inte godkänt</span> Avtalet krävs enligt GDPR art. 28 när någon annan behandlar personuppgifter åt er.</p>}
        <DpaText company={company} />
        {!d.at && owner && <form action={approveDpa.bind(null, company.id)}><button>Godkänn avtalet för {company.name}</button></form>}
      </div>

      <h2>Register över behandlingar</h2>
      <p className="small muted">Underlag för ert register enligt art. 30. Komplettera med behandlingar ni gör utanför tjänsten under <Link href={`/c/${company.id}/dataskydd`}>behandlingar och personuppgiftsincidenter</Link>.</p>
      <div className="table-wrap"><table className="small">
        <thead><tr><th>Behandling</th><th>Registrerade</th><th>Uppgifter</th><th>Rättslig grund</th><th>Lagringstid</th></tr></thead>
        <tbody>{RECORD.map((r) => <tr key={r[0]}>{r.map((c, i) => <td key={i}>{c}</td>)}</tr>)}</tbody>
      </table></div>

      <h2>Gallring</h2>
      <p className="small muted">Personuppgifter om anställda som slutade före {pruneBefore()} behövs inte längre för bokföringen. Vid gallring tas namn, personnummer, adress, bankkonto och frånvaro bort. Lönebeloppen finns kvar i bokföringen utan koppling till personen.</p>
      {prunable.length === 0 ? <p className="small">Det finns inget att gallra.</p> : (
        <div className="card">
          <ul className="small">{prunable.map((e) => <li key={e.id}>{e.name} – slutade {e.ended}</li>)}</ul>
          {owner && <form action={prune.bind(null, company.id)}><button className="secondary">Gallra {prunable.length} tidigare anställda</button></form>}
        </div>
      )}

      <h2>Den registrerades rättigheter</h2>
      <ul className="small">
        <li>Användare (även anställda med inloggning) laddar ner sina uppgifter och raderar sitt konto under <Link href="/konto#gdpr">Mitt konto</Link>.</li>
        <li>Uppgifter om kunder, leverantörer och anställda rättar ni direkt i respektive register. Uppgifter i bokförda verifikationer och fakturor får inte ändras eller tas bort under lagringstiden.</li>
        <li>Hela bokföringen kan exporteras som <Link href={`/c/${company.id}/rapporter/export`}>SIE</Link>.</li>
      </ul>
    </div>
  );
}
