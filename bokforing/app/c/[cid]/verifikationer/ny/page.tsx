import { sql } from '@/lib/db';
import { requireCompany } from '@/lib/server/auth';
import { VoucherForm } from '@/components/VoucherForm';
import { listCostCenters, listProjectRefs } from '@/lib/services/dimensions';
import { saveVoucher } from '../actions';
import { today } from '@/lib/format';
import { Help } from '@/components/Help';
import { getVoucher } from '@/lib/services/vouchers';

export const dynamic = 'force-dynamic';

export default async function NewVoucher({ params, searchParams }: { params: Promise<{ cid: string }>; searchParams: Promise<{ kopiera?: string }> }) {
  const { cid } = await params;
  const { company } = await requireCompany(cid, { perm: 'ledger' });
  // "Bokför igen": samma beskrivning, konton och belopp som en tidigare verifikation i bolaget
  const copyId = Number((await searchParams).kopiera);
  const copy = Number.isInteger(copyId) && copyId > 0 ? await getVoucher(company.id, copyId).catch(() => null) : null;
  const accounts = await sql<{ number: number; name: string }[]>`SELECT number, name FROM accounts WHERE company_id = ${company.id} AND active ORDER BY number`;
  return (
    <>
      <h1>Ny verifikation <Help term="verifikation" /> <Help term="debet_kredit" /></h1>
      <p className="muted small">Tips: för vanliga kvitton är det enklare att använda <a href={`/c/${company.id}/kvitto`}>Nytt kvitto</a> – då väljer appen konton åt dig.</p>
      {copy && <div className="learned small" role="status">✨ Ifyllt som verifikation {copy.series}{copy.number} ({copy.date}). Kontrollera datum och belopp innan du bokför.</div>}
      <VoucherForm initial={copy ? { description: copy.description, rows: copy.lines } : undefined} action={saveVoucher.bind(null, company.id)} accounts={[...accounts]} today={today()}
        costCenters={await listCostCenters(company.id, true)} projects={await listProjectRefs(company.id, true)} />
    </>
  );
}
