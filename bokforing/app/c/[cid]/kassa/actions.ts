'use server';
import { amount, attempt, done, str } from '@/lib/server/action';
import { requireCompany } from '@/lib/server/auth';
import { userActor } from '@/lib/services/actor';
import { PAYMENT_ACCOUNTS, RATES } from '@/lib/shop';
import * as svc from '@/lib/services/shop';

const base = (cid: number) => `/c/${cid}/kassa`;

export async function cashReport(cid: number, fd: FormData) {
  const actor = userActor(await requireCompany(cid));
  const input: Record<string, unknown> = { date: str(fd, 'date'), register: str(fd, 'register'), z_number: str(fd, 'z_number'), allow_diff: fd.get('allow_diff') === 'on', cost_center_id: str(fd, 'cost_center_id') };
  await attempt(base(cid), async () => {
    for (const r of RATES) input[`sales_${r}`] = amount(fd, `sales_${r}`, `Försäljning ${r} %`) ?? undefined;
    for (const m of Object.keys(PAYMENT_ACCOUNTS)) input[`pay_${m}`] = amount(fd, `pay_${m}`, m) ?? undefined;
    await svc.createCashReport(actor, input);
  });
  done(base(cid), 'Dagskassan är bokförd');
}

export async function connect(cid: number, fd: FormData) {
  const actor = userActor(await requireCompany(cid));
  let msg = 'Butiken är kopplad. Lägg in webhook-adressen i butiken.';
  await attempt(`${base(cid)}#ehandel`, async () => {
    const r = await svc.createConnection(actor, { platform: str(fd, 'platform'), name: str(fd, 'name'), secret: str(fd, 'secret'), cost_center_id: str(fd, 'cost_center_id') });
    if (r.secret) msg = `Butiken är kopplad. Hemlighet att klistra in i WooCommerce: ${r.secret}`;
  });
  done(`${base(cid)}#ehandel`, msg);
}

export async function toggle(cid: number, id: number, active: boolean) {
  const actor = userActor(await requireCompany(cid));
  await attempt(base(cid), () => svc.setConnectionActive(actor, id, active));
  done(`${base(cid)}#ehandel`, active ? 'Kopplingen är aktiv' : 'Kopplingen är pausad');
}
