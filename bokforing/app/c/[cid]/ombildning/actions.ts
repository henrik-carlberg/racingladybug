'use server';
import { attempt, done } from '@/lib/server/action';
import { allowedCompanies, companyAccess, requireCompany } from '@/lib/server/auth';
import { ForbiddenError } from '@/lib/errors';
import { userActor } from '@/lib/services/actor';
import { kr } from '@/lib/format';
import { convert } from '@/lib/services/conversion';

export async function convertAction(cid: number, fd: FormData) {
  const actor = userActor(await requireCompany(cid, { owner: true }));
  const base = `/c/${cid}/ombildning`;
  let r = { net: 0, pfond: 0, expansion: 0 };
  await attempt(base, async () => {
    // Aktiebolaget har egna åtkomstregler (tvåstegsverifiering, IP-lista, SSO, abonnemang) som måste uppfyllas av den här inloggningen
    const abId = Number(fd.get('ab_company_id'));
    if (!(await allowedCompanies([{ id: abId }])).length || (await companyAccess(abId)).state === 'locked') throw new ForbiddenError('Din inloggning har inte åtkomst till aktiebolaget');
    r = await convert(actor, Object.fromEntries([...fd.entries()].map(([k, v]) => [k, String(v)])));
  });
  done(base, `Verksamheten är överlåten till aktiebolaget för ${kr(r.net)} kr. Periodiseringsfonder ${kr(r.pfond)} kr och expansionsfond ${kr(r.expansion)} kr är återförda i firman.`);
}
