'use server';
import { amount, attempt, done, str } from '@/lib/server/action';
import { requireCompany } from '@/lib/server/auth';
import { userActor } from '@/lib/services/actor';
import * as svc from '@/lib/services/bank-rules';

const base = (cid: number) => `/c/${cid}/bank/regler`;
const fields = (fd: FormData) => ({
  name: str(fd, 'name'), pattern: str(fd, 'pattern'), direction: str(fd, 'direction'), account: str(fd, 'account'), vat_rate: str(fd, 'vat_rate'),
  description: str(fd, 'description'), auto: fd.get('auto') === 'on', cost_center_id: str(fd, 'cost_center_id'), priority: str(fd, 'priority') || undefined,
  amount_min: amount(fd, 'amount_min', 'Lägsta belopp') ?? undefined, amount_max: amount(fd, 'amount_max', 'Högsta belopp') ?? undefined,
});

export async function create(cid: number, fd: FormData) {
  const actor = userActor(await requireCompany(cid, { perm: 'ledger' }));
  await attempt(base(cid), () => svc.createRule(actor, fields(fd)));
  done(str(fd, 'back') || base(cid), 'Regeln är sparad');
}

export async function update(cid: number, id: number, fd: FormData) {
  const actor = userActor(await requireCompany(cid, { perm: 'ledger' }));
  await attempt(`${base(cid)}#r${id}`, () => svc.updateRule(actor, id, fields(fd)));
  done(base(cid), 'Regeln är ändrad');
}

export async function remove(cid: number, id: number) {
  const actor = userActor(await requireCompany(cid, { perm: 'ledger' }));
  await attempt(base(cid), () => svc.deleteRule(actor, id));
  done(base(cid), 'Regeln är borttagen');
}

export async function starters(cid: number) {
  const actor = userActor(await requireCompany(cid, { perm: 'ledger' }));
  let n = 0;
  await attempt(base(cid), async () => { n = await svc.addStarterRules(actor); });
  done(base(cid), `${n} vanliga regler är tillagda`);
}
