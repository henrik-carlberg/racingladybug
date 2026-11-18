'use server';
import { amount, attempt, done, str } from '@/lib/server/action';
import { requireCompany } from '@/lib/server/auth';
import { userActor } from '@/lib/services/actor';
import { kr } from '@/lib/format';
import * as svc from '@/lib/services/assets';

const base = (cid: number) => `/c/${cid}/anlaggningar`;

export async function create(cid: number, fd: FormData) {
  const actor = userActor(await requireCompany(cid));
  await attempt(base(cid), () => svc.createAsset(actor, {
    name: str(fd, 'name'), category: str(fd, 'category'), acquired_on: str(fd, 'acquired_on'), cost: amount(fd, 'cost', 'Anskaffningsvärde'),
    residual: amount(fd, 'residual', 'Restvärde') ?? 0, life_months: str(fd, 'life_months') || undefined, dep_start: str(fd, 'dep_start'),
    cost_center_id: str(fd, 'cost_center_id'), source_voucher_id: str(fd, 'source_voucher_id'), notes: str(fd, 'notes'),
  }));
  done(base(cid), 'Tillgången är upplagd i anläggningsregistret');
}

export async function depreciate(cid: number, fd: FormData) {
  const actor = userActor(await requireCompany(cid));
  let msg = '';
  await attempt(base(cid), async () => {
    const r = await svc.runDepreciation(actor, str(fd, 'period'));
    msg = r.vouchers ? `Avskrivningar bokförda: ${kr(r.total)} kr på ${r.vouchers} verifikationer` : 'Inga avskrivningar att bokföra';
  });
  done(base(cid), msg);
}

export async function dispose(cid: number, id: number, fd: FormData) {
  const actor = userActor(await requireCompany(cid));
  let msg = '';
  await attempt(base(cid), async () => {
    const r = await svc.disposeAsset(actor, id, { date: str(fd, 'date'), price: amount(fd, 'price', 'Försäljningspris') ?? 0, vat_rate: str(fd, 'vat_rate') });
    msg = `Tillgången är avyttrad (bokfört värde ${kr(r.book)} kr, ${r.result >= 0 ? 'vinst' : 'förlust'} ${kr(Math.abs(r.result))} kr)`;
  });
  done(base(cid), msg);
}

export async function remove(cid: number, id: number) {
  const actor = userActor(await requireCompany(cid));
  await attempt(base(cid), () => svc.deleteAsset(actor, id));
  done(base(cid), 'Tillgången är borttagen');
}
