'use server';
import { attempt, done } from '@/lib/server/action';
import { requireCompany } from '@/lib/server/auth';
import { userActor } from '@/lib/services/actor';
import { kr } from '@/lib/format';
import * as svc from '@/lib/services/rebates';

const base = (cid: number) => `/c/${cid}/leverantorsfakturor/bonus`;
const form = (fd: FormData) => Object.fromEntries([...fd.entries()].filter(([, v]) => typeof v === 'string'));

export async function addAction(cid: number, fd: FormData) {
  const actor = userActor(await requireCompany(cid, { perm: 'purchasing' }));
  await attempt(base(cid), () => svc.addAgreement(actor, form(fd), 'supplier'));
  done(base(cid), 'Bonusavtalet är upplagt');
}
export async function accrueAction(cid: number, fd: FormData) {
  const actor = userActor(await requireCompany(cid, { perm: 'ledger' }));
  let change = 0;
  await attempt(base(cid), async () => { change = await svc.accrue(actor, Number(fd.get('fiscal_year_id')), 'supplier'); });
  done(base(cid), change > 0 ? `Upplupen leverantörsbonus har ökats med ${kr(change)} kr` : `Upplupen leverantörsbonus har minskats med ${kr(-change)} kr`);
}
export async function receiveAction(cid: number, id: number, fd: FormData) {
  const actor = userActor(await requireCompany(cid, { perm: 'payments' }));
  let r = { amount: 0, vat: 0, method: 'bank' };
  await attempt(base(cid), async () => { r = await svc.receiveSupplierRebate(actor, id, form(fd)); });
  done(base(cid), `Bonusen ${kr(r.amount)} kr (moms ${kr(r.vat)} kr) är bokförd${r.method === 'credit' ? ' som kreditnota – kvitta den mot en faktura under Kreditfakturor' : ' som inbetald'}`);
}
