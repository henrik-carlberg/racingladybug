import Link from 'next/link';
import { requireCompany } from '@/lib/server/auth';
import { fiscalYears } from '@/lib/server/ledger';
import { openingBalanceTemplate } from '@/lib/services/setup';
import { OpeningBalanceForm } from '@/components/OpeningBalanceForm';
import { saveIb } from '../actions';

export const dynamic = 'force-dynamic';

export default async function OpeningBalances({ params }: { params: Promise<{ cid: string }> }) {
  const { cid } = await params;
  const { company } = await requireCompany(cid);
  const years = (await fiscalYears(company.id)).filter((y) => !y.closed).map((y) => ({ id: y.id, label: `${y.start_date} – ${y.end_date}` }));
  return (
    <div style={{ maxWidth: 980 }}>
      <h1>Ingående balanser</h1>
      <p className="muted">Fyll i saldona per räkenskapsårets första dag. De hittar du i förra årets <b>balansräkning</b> (utgående balans) från ditt tidigare bokföringsprogram eller din redovisningskonsult.
        Ange belopp som positiva tal – tillgångar till vänster, eget kapital och skulder till höger. Har du en SIE-fil från det gamla programmet kan du <Link href={`/c/${company.id}/kom-igang/sie-import`}>importera den</Link> i stället.</p>
      {years.length === 0 ? <p>Det finns inget öppet räkenskapsår. <Link href={`/c/${company.id}/installningar`}>Lägg till ett under Inställningar</Link>.</p> :
        <OpeningBalanceForm action={saveIb.bind(null, company.id)} accounts={openingBalanceTemplate(company.company_type)} years={years} companyType={company.company_type} />}
    </div>
  );
}
