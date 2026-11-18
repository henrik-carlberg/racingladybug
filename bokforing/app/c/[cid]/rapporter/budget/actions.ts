'use server';
import { attempt, done, str } from '@/lib/server/action';
import { requireCompany } from '@/lib/server/auth';
import { userActor } from '@/lib/services/actor';
import { parseAmount } from '@/lib/money';
import * as svc from '@/lib/services/budget';

export async function save(cid: number, year: number, fd: FormData) {
  const actor = userActor(await requireCompany(cid, { perm: 'ledger' }));
  const back = `/c/${cid}/rapporter/budget?year=${year}`;
  await attempt(back, async () => {
    const cells: { account: number; month: number; amount: number }[] = [];
    for (const [k, v] of fd.entries()) {
      const m = k.match(/^b_(\d{4})_(\d{1,2})$/);
      if (!m || !String(v).trim()) continue;
      const amount = parseAmount(String(v));
      if (amount == null) throw new Error(`Ogiltigt belopp "${v}" på konto ${m[1]}`);
      cells.push({ account: Number(m[1]), month: Number(m[2]), amount });
    }
    const add = Number(str(fd, 'new_account'));
    const addYear = parseAmount(str(fd, 'new_amount'));
    if (add) {
      if (add < 3000 || add > 8999) throw new Error('Budget läggs på resultatkonton (3000–8999)');
      if (addYear) for (let mo = 1; mo <= 12; mo++) cells.push({ account: add, month: mo, amount: Math.round(addYear / 12) });
    }
    await svc.saveBudget(actor, year, cells);
  });
  done(back, 'Budgeten är sparad');
}

export async function copy(cid: number, year: number, fd: FormData) {
  const actor = userActor(await requireCompany(cid, { perm: 'ledger' }));
  const back = `/c/${cid}/rapporter/budget?year=${year}`;
  await attempt(back, () => svc.copyLastYear(actor, year, Number(str(fd, 'uplift').replace(',', '.')) || 0));
  done(back, `Budgeten är ifylld från ${year - 1} års utfall`);
}
