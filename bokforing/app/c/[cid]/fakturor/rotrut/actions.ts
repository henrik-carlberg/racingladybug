'use server';
import { amount, attempt, done, str } from '@/lib/server/action';
import { requireCompany } from '@/lib/server/auth';
import { userActor } from '@/lib/services/actor';
import * as svc from '@/lib/services/rotrut';

const base = (cid: number) => `/c/${cid}/fakturor/rotrut`;

export async function markRequested(cid: number, fd: FormData) {
  const actor = userActor(await requireCompany(cid));
  let n = 0;
  await attempt(base(cid), async () => { n = await svc.markRequested(actor, svc.parseIds(fd.getAll('ids')), str(fd, 'date')); });
  done(base(cid), `${n} fakturor är markerade som begärda`);
}

export async function undo(cid: number, id: number) {
  const actor = userActor(await requireCompany(cid));
  await attempt(base(cid), () => svc.undoRequested(actor, id));
  done(base(cid), 'Begäran är ångrad');
}

export async function decide(cid: number, id: number, fd: FormData) {
  const actor = userActor(await requireCompany(cid));
  let msg = '';
  await attempt(base(cid), async () => {
    const r = await svc.registerDecision(actor, id, { amount: amount(fd, 'amount', 'Utbetalt belopp') ?? 0, date: str(fd, 'date'), account: str(fd, 'account') });
    msg = r.rest > 0 ? 'Beslutet är bokfört. En faktura till kunden på mellanskillnaden ligger som utkast.' : 'Utbetalningen från Skatteverket är bokförd';
  });
  done(base(cid), msg);
}
