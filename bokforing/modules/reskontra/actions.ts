'use server';
import { amount, attempt, done, str } from '@/lib/server/action';
import { requireCompany } from '@/lib/server/auth';
import { isModuleEnabled } from '@/lib/modules/enabled';
import { userActor } from '@/lib/services/actor';
import * as svc from './service';

async function ctx(cid: number) {
  const c = await requireCompany(cid);
  if (!(await isModuleEnabled(c.company.id, 'reskontra'))) throw new Error('Reskontramodulen är inte aktiverad');
  return userActor(c);
}
const base = (cid: number) => `/c/${cid}/m/reskontra`;

export async function remind(cid: number, invoiceId: number, back: string, fd: FormData) {
  const actor = await ctx(cid);
  let id = 0, msg = '';
  await attempt(back, async () => {
    const r = await svc.createReminder(actor, invoiceId, { email: fd.get('email') === 'on' });
    id = r.id; msg = `Påminnelse ${r.level} är skapad${r.emailed ? ` och skickad till ${r.emailed}` : ''}${r.sms ? ` och som SMS till ${r.sms}` : ''}`;
  });
  done(`${base(cid)}/paminnelse/${id}`, msg);
}

export async function remindAll(cid: number, fd: FormData) {
  const actor = await ctx(cid);
  let n = 0, mailed = 0;
  await attempt(base(cid), async () => { const r = await svc.remindDue(actor, fd.get('email') === 'on'); n = r.length; mailed = r.filter((x) => x.emailed).length; });
  done(base(cid), `${n} påminnelser är skapade${mailed ? `, ${mailed} skickade med e-post` : ''}`);
}

export async function charge(cid: number, customerId: number) {
  const actor = await ctx(cid);
  let id = 0;
  await attempt(`${base(cid)}/kund/${customerId}`, async () => { id = (await svc.chargeFees(actor, customerId)).id; });
  done(`/c/${cid}/fakturor/${id}`, 'Fakturautkast för avgifter och ränta är skapat');
}

export async function collection(cid: number, invoiceId: number, on: boolean, fd: FormData) {
  const actor = await ctx(cid);
  await attempt(base(cid), () => (on ? svc.markCollection(actor, invoiceId, str(fd, 'note')) : svc.unmarkCollection(actor, invoiceId)));
  done(base(cid), on ? 'Fakturan är markerad för inkasso' : 'Inkassomarkeringen är borttagen');
}

export async function saveSettings(cid: number, fd: FormData) {
  const actor = await ctx(cid);
  await attempt(`${base(cid)}/installningar`, () => svc.saveSettings(actor, {
    first_days: str(fd, 'first_days'), second_days: str(fd, 'second_days'), collection_days: str(fd, 'collection_days'), fee: amount(fd, 'fee', 'Avgift') ?? 0,
    reference_rate: str(fd, 'reference_rate'), fee_account: str(fd, 'fee_account'), interest_account: str(fd, 'interest_account'),
    auto_remind: fd.get('auto_remind') === 'on', message: str(fd, 'message'), sms: fd.get('sms') === 'on',
  }));
  done(`${base(cid)}/installningar`, 'Inställningarna är sparade');
}

export async function handOver(cid: number, invoiceId: number) {
  const actor = await ctx(cid);
  await attempt(base(cid), () => svc.handOver(actor, invoiceId));
  done(base(cid), 'Fakturan är lämnad till inkassobolaget');
}

export async function recall(cid: number, invoiceId: number) {
  const actor = await ctx(cid);
  await attempt(base(cid), () => svc.recall(actor, invoiceId));
  done(base(cid), 'Inkassoärendet är återkallat');
}

export async function refreshCases(cid: number) {
  const actor = await ctx(cid);
  await attempt(base(cid), () => svc.refreshCases(actor.companyId));
  done(base(cid), 'Status hämtad från inkassobolaget');
}
