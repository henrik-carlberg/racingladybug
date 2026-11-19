'use server';
import { redirect } from 'next/navigation';
import { attempt, done } from '@/lib/server/action';
import { requireCompany } from '@/lib/server/auth';
import { requestOrigin } from '@/lib/server/origin';
import { userActor } from '@/lib/services/actor';
import * as svc from '@/lib/services/payments';

const base = (cid: number) => `/c/${cid}/installningar/betalningar`;

export async function connect(cid: number) {
  const actor = userActor(await requireCompany(cid, { owner: true }));
  let url = '';
  await attempt(base(cid), async () => { url = await svc.connectStripe(actor, await requestOrigin()); });
  redirect(url);
}

export async function refresh(cid: number) {
  await requireCompany(cid, { owner: true });
  await attempt(base(cid), () => svc.refreshStripeAccount(cid));
  done(base(cid), 'Status hämtad från Stripe');
}

export async function disconnect(cid: number) {
  const actor = userActor(await requireCompany(cid, { owner: true }));
  await attempt(base(cid), () => svc.disconnectStripe(actor));
  done(base(cid), 'Kortbetalning är avstängd');
}

export async function resolve(cid: number, id: number) {
  const actor = userActor(await requireCompany(cid));
  await attempt(base(cid), () => svc.resolveIssue(actor, id));
  done(base(cid), 'Markerad som hanterad');
}

/** Swish Handel från fakturalänken och delbetalning som kunden kan välja i kundportalen */
export async function savePayOptions(cid: number, fd: FormData) {
  const { sql } = await import('@/lib/db');
  const { auditBy } = await import('@/lib/server/audit');
  const actor = userActor(await requireCompany(cid, { owner: true }));
  await attempt(base(cid), async () => {
    const max = Number(fd.get('part_payment_max') ?? 0);
    if (![0, 2, 3, 4, 6].includes(max)) throw new Error('Välj antal delbetalningar');
    const min = Math.round(Number(String(fd.get('part_payment_min') ?? '1000').replace(/\s/g, '').replace(',', '.')) * 100);
    if (!Number.isFinite(min) || min < 10000) throw new Error('Lägsta belopp för delbetalning är 100 kr');
    await sql`UPDATE companies SET swish_commerce = ${fd.get('swish_commerce') === 'on'}, part_payment_max = ${max}, part_payment_min = ${min} WHERE id = ${actor.companyId}`;
    await auditBy(sql, actor, 'pay_options', 'company', actor.companyId, { swish: fd.get('swish_commerce') === 'on', max, min });
  });
  done(base(cid), 'Betalsätten är sparade');
}
