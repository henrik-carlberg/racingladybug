'use server';
import { attempt, done, str } from '@/lib/server/action';
import { requireCompany } from '@/lib/server/auth';
import { userActor } from '@/lib/services/actor';
import { settleVat as settle } from '@/lib/services/reports';

/** Bokför momsavräkning för perioden: nollställer momskonton mot 2650 */
export async function settleVat(cid: number, fd: FormData) {
  const actor = userActor(await requireCompany(cid));
  const from = str(fd, 'from'), to = str(fd, 'to');
  let id = 0;
  await attempt(`/c/${cid}/rapporter/moms?from=${from}&to=${to}`, async () => { id = (await settle(actor, from, to)).settlement_voucher_id!; });
  done(`/c/${cid}/verifikationer/${id}`, 'Momsavräkningen är bokförd. Lås perioden under Inställningar när deklarationen är inlämnad.');
}
