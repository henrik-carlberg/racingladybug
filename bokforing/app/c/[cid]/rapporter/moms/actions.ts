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

/** Rättelse av en redan deklarerad period */
export async function correctVat(cid: number, fd: FormData) {
  const actor = userActor(await requireCompany(cid, { perm: 'ledger' }));
  const from = str(fd, 'from'), to = str(fd, 'to');
  const back = `/c/${cid}/rapporter/moms?from=${from}&to=${to}`;
  const { correct } = await import('@/lib/services/vat-correction');
  const { kr } = await import('@/lib/format');
  let r = { toPayDiff: 0, n: 0 };
  await attempt(back, async () => { r = await correct(actor, from, to, { date: str(fd, 'date') }); });
  done(back, `Rättelse ${r.n} är bokförd: ${r.toPayDiff >= 0 ? `${kr(r.toPayDiff)} kr mer att betala` : `${kr(-r.toPayDiff)} kr att få tillbaka`}. Den nya deklarationen finns under Inlämning.`);
}
