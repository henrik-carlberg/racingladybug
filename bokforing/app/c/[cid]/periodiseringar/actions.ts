'use server';
import { amount, attempt, done, str } from '@/lib/server/action';
import { requireCompany } from '@/lib/server/auth';
import { userActor } from '@/lib/services/actor';
import { kr } from '@/lib/format';
import * as svc from '@/lib/services/accruals';

const base = (cid: number) => `/c/${cid}/periodiseringar`;

export async function create(cid: number, fd: FormData) {
  const actor = userActor(await requireCompany(cid));
  await attempt(base(cid), () => svc.createAccrual(actor, {
    description: str(fd, 'description'), kind: str(fd, 'kind'), amount: amount(fd, 'amount'), result_account: str(fd, 'result_account'),
    first_period: str(fd, 'first_period'), months: str(fd, 'months'), transfer_date: fd.get('transfer') === 'on' ? str(fd, 'transfer_date') : '',
    cost_center_id: str(fd, 'cost_center_id'),
  }));
  done(base(cid), 'Periodiseringen är upplagd');
}

export async function run(cid: number, fd: FormData) {
  const actor = userActor(await requireCompany(cid));
  let msg = '';
  await attempt(base(cid), async () => {
    const r = await svc.runAccruals(actor, str(fd, 'period'));
    msg = r.vouchers ? `Periodiseringar bokförda: ${kr(r.total)} kr på ${r.vouchers} verifikationer` : 'Inga periodiseringar att bokföra';
  });
  done(base(cid), msg);
}

export async function remove(cid: number, id: number) {
  const actor = userActor(await requireCompany(cid));
  await attempt(base(cid), () => svc.deleteAccrual(actor, id));
  done(base(cid), 'Periodiseringen är borttagen');
}

export async function bookVacation(cid: number, fd: FormData) {
  const actor = userActor(await requireCompany(cid));
  await attempt(base(cid), () => svc.bookVacationLiability(actor, str(fd, 'date')));
  done(base(cid), 'Semesterlöneskulden är bokförd');
}

export async function vacationAuto(cid: number, fd: FormData) {
  const { sql } = await import('@/lib/db');
  const { company } = await requireCompany(cid, { owner: true });
  await attempt(base(cid), async () => { await sql`UPDATE companies SET vacation_liability_auto = ${fd.get('auto') === 'on'} WHERE id = ${company.id}`; });
  done(base(cid), fd.get('auto') === 'on' ? 'Semesterlöneskulden bokförs nu automatiskt när en lönekörning bokförs' : 'Automatisk bokning av semesterlöneskulden är avstängd');
}
