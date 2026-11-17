'use server';
import { amount, attempt, done, str } from '@/lib/server/action';
import { requireCompany } from '@/lib/server/auth';
import { requestOrigin } from '@/lib/server/origin';
import { isModuleEnabled } from '@/lib/modules/enabled';
import { userActor } from '@/lib/services/actor';
import * as svc from './service';

async function ctx(cid: number) {
  const c = await requireCompany(cid);
  if (!(await isModuleEnabled(c.company.id, 'lonerevision'))) throw new Error('Lönerevisionsmodulen är inte aktiverad');
  return userActor(c);
}
const base = (cid: number) => `/c/${cid}/m/lonerevision`;
const rev = (cid: number, id: number) => `${base(cid)}/revision/${id}`;

export async function create(cid: number, fd: FormData) {
  const actor = await ctx(cid);
  let id = 0;
  await attempt(`${base(cid)}/ny`, async () => {
    id = (await svc.createReview(actor, { name: str(fd, 'name'), effective_date: str(fd, 'effective_date'), budget_percent: str(fd, 'budget_percent'), criteria: str(fd, 'criteria') })).id;
  });
  done(rev(cid, id), 'Lönerevisionen är skapad. Lägg in förslag per medarbetare.');
}

export async function saveProposals(cid: number, id: number, fd: FormData) {
  const actor = await ctx(cid);
  await attempt(rev(cid, id), async () => {
    const ids = fd.getAll('employee_id').map(String);
    await svc.saveProposals(actor, id, {
      budget_percent: str(fd, 'budget_percent'), criteria: str(fd, 'criteria'),
      items: ids.map((e) => ({
        employee_id: e, comment: str(fd, `comment_${e}`),
        ...(str(fd, `percent_${e}`) ? { percent: str(fd, `percent_${e}`) } : { new_salary: amount(fd, `new_${e}`, 'Ny lön') }),
      })),
    });
  });
  done(rev(cid, id), 'Förslagen är sparade');
}

export async function evenly(cid: number, id: number, fd: FormData) {
  const actor = await ctx(cid);
  await attempt(rev(cid, id), () => svc.applyEvenly(actor, id, Number(str(fd, 'percent').replace(',', '.'))));
  done(rev(cid, id), 'Höjningen är utlagd på alla. Justera individuellt och spara.');
}

export async function approve(cid: number, id: number) {
  const actor = await ctx(cid);
  await attempt(rev(cid, id), () => svc.approveReview(actor, id));
  done(rev(cid, id), 'Lönerevisionen är godkänd');
}

export async function reopen(cid: number, id: number) {
  const actor = await ctx(cid);
  await attempt(rev(cid, id), () => svc.reopenReview(actor, id));
  done(rev(cid, id), 'Lönerevisionen är återöppnad');
}

export async function cancel(cid: number, id: number) {
  const actor = await ctx(cid);
  await attempt(rev(cid, id), () => svc.cancelReview(actor, id));
  done(base(cid), 'Lönerevisionen är avbruten');
}

export async function letters(cid: number, id: number) {
  const actor = await ctx(cid);
  let msg = '';
  await attempt(rev(cid, id), async () => {
    const r = await svc.sendLetters(actor, id, await requestOrigin());
    msg = `${r.sent} lönebesked är skickade för e-signering` + (r.missingEmail.length ? `. Saknar e-post: ${r.missingEmail.join(', ')}` : '');
  });
  done(rev(cid, id), msg);
}

export async function apply(cid: number, id: number) {
  const actor = await ctx(cid);
  await attempt(rev(cid, id), () => svc.applyReview(actor, id));
  done(rev(cid, id), 'De nya lönerna är införda i lönen');
}

export async function retro(cid: number, id: number, fd: FormData) {
  const actor = await ctx(cid);
  let msg = '';
  await attempt(rev(cid, id), async () => {
    const r = await svc.addRetroToRun(actor, id, Number(str(fd, 'run_id')));
    msg = `Retroaktiv lön är inlagd för ${r.added} medarbetare i lönekörningen ${r.period}`;
  });
  done(rev(cid, id), msg);
}
