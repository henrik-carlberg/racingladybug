'use server';
import { redirect } from 'next/navigation';
import { attempt, done } from '@/lib/server/action';
import { requireCompany } from '@/lib/server/auth';
import { userActor } from '@/lib/services/actor';
import { kr } from '@/lib/format';
import * as svc from '@/lib/services/rebates';

const base = (cid: number) => `/c/${cid}/kundbonus`;
const form = (fd: FormData) => Object.fromEntries([...fd.entries()].filter(([, v]) => typeof v === 'string'));

export async function addAction(cid: number, fd: FormData) {
  const actor = userActor(await requireCompany(cid, { perm: 'invoicing' }));
  await attempt(base(cid), () => svc.addAgreement(actor, form(fd)));
  done(base(cid), 'Bonusavtalet är upplagt');
}

export async function accrueAction(cid: number, fd: FormData) {
  const actor = userActor(await requireCompany(cid, { perm: 'ledger' }));
  let change = 0;
  await attempt(base(cid), async () => { change = await svc.accrue(actor, Number(fd.get('fiscal_year_id'))); });
  done(base(cid), change > 0 ? `Upplupen kundbonus har ökats med ${kr(change)} kr` : `Upplupen kundbonus har minskats med ${kr(-change)} kr`);
}

export async function settleAction(cid: number, id: number, fd: FormData) {
  const actor = userActor(await requireCompany(cid, { perm: 'invoicing' }));
  let r = { amount: 0, invoiceId: null as number | null };
  await attempt(base(cid), async () => { r = await svc.settle(actor, id, form(fd)); });
  if (r.invoiceId) redirect(`/c/${cid}/fakturor/${r.invoiceId}?ok=${encodeURIComponent(`Bonusen ${kr(r.amount)} kr är lagd som kreditfakturautkast – granska och bokför`)}`);
  done(base(cid), 'Perioden är reglerad – ingen bonus var intjänad');
}
