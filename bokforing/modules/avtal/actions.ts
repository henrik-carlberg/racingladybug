'use server';
import { amount, attempt, done, str } from '@/lib/server/action';
import { requireCompany } from '@/lib/server/auth';
import { isModuleEnabled } from '@/lib/modules/enabled';
import { userActor } from '@/lib/services/actor';
import * as svc from './service';

async function ctx(cid: number) {
  const c = await requireCompany(cid);
  if (!(await isModuleEnabled(c.company.id, 'avtal'))) throw new Error('Avtalsmodulen är inte aktiverad');
  return userActor(c);
}
const base = (cid: number) => `/c/${cid}/m/avtal`;
const fields = (fd: FormData) => {
  const lines = [];
  for (let i = 0; i < 8; i++) {
    if (!str(fd, `d_${i}`)) continue;
    lines.push({ description: str(fd, `d_${i}`), quantity: str(fd, `q_${i}`) || '1', unit: str(fd, `u_${i}`), unit_price: amount(fd, `p_${i}`, `Rad ${i + 1}: pris`) ?? 0, vat_rate: str(fd, `v_${i}`) || 25 });
  }
  return {
    customer_id: str(fd, 'customer_id'), name: str(fd, 'name'), start_date: str(fd, 'start_date'), end_date: str(fd, 'end_date'), interval_months: str(fd, 'interval_months'),
    in_advance: str(fd, 'timing') !== 'arrears', notice_months: str(fd, 'notice_months'), auto_renew: fd.get('auto_renew') === 'on', renewal_months: str(fd, 'renewal_months'),
    auto_book: fd.get('auto_book') === 'on', your_reference: str(fd, 'your_reference'), notes: str(fd, 'notes'), lines,
  };
};

export async function create(cid: number, fd: FormData) {
  const actor = await ctx(cid);
  let id = 0;
  await attempt(`${base(cid)}/nytt`, async () => { id = (await svc.createContract(actor, fields(fd))).id; });
  done(`${base(cid)}/a/${id}`, 'Avtalet är skapat');
}

export async function update(cid: number, id: number, fd: FormData) {
  const actor = await ctx(cid);
  await attempt(`${base(cid)}/a/${id}`, () => svc.updateContract(actor, id, fields(fd)));
  done(`${base(cid)}/a/${id}`, 'Avtalet är sparat');
}

export async function status(cid: number, id: number, s: 'active' | 'paused' | 'ended') {
  const actor = await ctx(cid);
  await attempt(`${base(cid)}/a/${id}`, () => svc.setStatus(actor, id, s));
  done(`${base(cid)}/a/${id}`, s === 'paused' ? 'Avtalet är pausat' : s === 'active' ? 'Avtalet är aktivt' : 'Avtalet är avslutat');
}

export async function terminate(cid: number, id: number, fd: FormData) {
  const actor = await ctx(cid);
  await attempt(`${base(cid)}/a/${id}`, () => svc.terminate(actor, id, str(fd, 'notice_date') || undefined));
  done(`${base(cid)}/a/${id}`, 'Avtalet är uppsagt');
}

export async function generate(cid: number, id: number | null) {
  const actor = await ctx(cid);
  let n = 0;
  const back = id ? `${base(cid)}/a/${id}` : base(cid);
  await attempt(back, async () => { n = (await svc.generateDue(actor, undefined, id ?? undefined)).length; });
  done(back, n ? `${n} fakturor är skapade` : 'Inga perioder att fakturera just nu');
}

export async function adjust(cid: number, fd: FormData) {
  const actor = await ctx(cid);
  let n = 0;
  await attempt(base(cid), async () => { n = await svc.adjustPrices(actor, Number(str(fd, 'percent').replace(',', '.'))); });
  done(base(cid), `Priserna är justerade på ${n} avtalsrader`);
}

export async function renewal(cid: number, id: number) {
  const actor = await ctx(cid);
  let dealId = 0;
  await attempt(`${base(cid)}/a/${id}`, async () => {
    if (!(await isModuleEnabled(actor.companyId, 'crm'))) throw new Error('Aktivera CRM-modulen för att skapa förnyelseaffärer');
    dealId = (await svc.renewalDeal(actor, id)).id;
  });
  done(`/c/${cid}/m/crm/affar/${dealId}`, 'Förnyelseaffären är skapad');
}
