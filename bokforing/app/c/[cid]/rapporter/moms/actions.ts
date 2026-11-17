'use server';
import { sql } from '@/lib/db';
import { attempt, done, str } from '@/lib/server/action';
import { requireCompany } from '@/lib/server/auth';
import { accountSums, createVoucher } from '@/lib/server/ledger';
import { vatSettlementLines } from '@/lib/vat';

/** Bokför momsavräkning för perioden: nollställer momskonton mot 2650 */
export async function settleVat(cid: number, fd: FormData) {
  const { company, user } = await requireCompany(cid);
  const from = str(fd, 'from'), to = str(fd, 'to');
  const back = `/c/${cid}/rapporter/moms?from=${from}&to=${to}`;
  let id = 0;
  await attempt(back, async () => {
    const existing = await sql`SELECT 1 FROM vouchers v WHERE v.company_id = ${company.id} AND v.source_type = 'vat'
      AND v.date BETWEEN ${from} AND ${to} AND NOT EXISTS (SELECT 1 FROM vouchers r WHERE r.corrects_id = v.id)`;
    if (existing.length) throw new Error('Det finns redan en momsavräkning för perioden');
    const sums = await accountSums(company.id, from, to, { excludeVatSettlements: true });
    const lines = vatSettlementLines(sums);
    if (lines.length === 0) throw new Error('Inga momstransaktioner i perioden');
    id = (await sql.begin((tx) => createVoucher(tx, {
      companyId: company.id, userId: user.id, date: to, description: `Momsavräkning ${from} – ${to}`, lines, sourceType: 'vat',
    }))).id;
  });
  done(`/c/${cid}/verifikationer/${id}`, 'Momsavräkningen är bokförd. Lås perioden under Inställningar när deklarationen är inlämnad.');
}
