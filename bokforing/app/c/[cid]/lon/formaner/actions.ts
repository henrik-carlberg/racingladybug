'use server';
import { amount, attempt, done, str } from '@/lib/server/action';
import { requireCompany } from '@/lib/server/auth';
import { userActor } from '@/lib/services/actor';
import { registerBenefit } from '@/lib/services/payroll2';

export async function register(cid: number, fd: FormData) {
  const actor = userActor(await requireCompany(cid, { perm: 'payroll' }));
  let msg = '';
  await attempt(`/c/${cid}/lon/formaner`, async () => {
    const r = await registerBenefit(actor, { kind: str(fd, 'kind'), employee_id: str(fd, 'employee_id'), amount: amount(fd, 'amount', 'Belopp'), date: str(fd, 'date'), description: str(fd, 'description'), run_id: str(fd, 'run_id') });
    msg = `Förmånen är lagd på ${r.employee}s lön som skattefri ersättning – ${(r.left / 100).toLocaleString('sv-SE')} kr kvar av taket i år`;
  });
  done(`/c/${cid}/lon/formaner`, msg);
}
