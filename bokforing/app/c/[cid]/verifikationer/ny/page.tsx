import { sql } from '@/lib/db';
import { requireCompany } from '@/lib/server/auth';
import { VoucherForm } from '@/components/VoucherForm';
import { saveVoucher } from '../actions';
import { today } from '@/lib/format';

export const dynamic = 'force-dynamic';

export default async function NewVoucher({ params }: { params: Promise<{ cid: string }> }) {
  const { cid } = await params;
  const { company } = await requireCompany(cid);
  const accounts = await sql<{ number: number; name: string }[]>`SELECT number, name FROM accounts WHERE company_id = ${company.id} AND active ORDER BY number`;
  return (
    <>
      <h1>Ny verifikation</h1>
      <VoucherForm action={saveVoucher.bind(null, company.id)} accounts={[...accounts]} today={today()} />
    </>
  );
}
