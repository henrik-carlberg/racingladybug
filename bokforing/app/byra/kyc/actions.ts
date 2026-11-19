'use server';
import { attempt, done, str } from '@/lib/server/action';
import { requireUser } from '@/lib/server/auth';
import { requestOrigin } from '@/lib/server/origin';
import * as svc from '@/lib/services/kyc';

const back = (f: number, c: number) => `/byra/kyc?f=${f}&c=${c}`;

export async function owners(firmId: number, companyId: number) {
  const user = await requireUser();
  let n = 0;
  await attempt(back(firmId, companyId), async () => { n = (await svc.fetchOwners(user.id, firmId, companyId)).length; });
  done(back(firmId, companyId), `${n} verkliga huvudmän hämtade från Bolagsverket`);
}

export async function assess(firmId: number, companyId: number, fd: FormData) {
  const user = await requireUser();
  let msg = '';
  await attempt(back(firmId, companyId), async () => {
    const a = await svc.saveAssessment(user.id, firmId, companyId, { factors: fd.getAll('factor').map(String), pep: str(fd, 'pep'), pep_details: str(fd, 'pep_details'),
      identified: str(fd, 'identified'), purpose: str(fd, 'purpose'), notes: str(fd, 'notes') });
    msg = `Kundkännedomen är sparad – ${a.risk === 'high' ? 'hög' : a.risk === 'normal' ? 'normal' : 'låg'} risk, görs om senast ${a.nextReview}`;
  });
  done(back(firmId, companyId), msg);
}

export async function engagement(firmId: number, companyId: number, fd: FormData) {
  const user = await requireUser();
  await attempt(back(firmId, companyId), async () => { await svc.sendEngagement(user.id, firmId, companyId, { services: fd.getAll('service').map(String), fee: str(fd, 'fee') }, await requestOrigin()); });
  done(back(firmId, companyId), 'Uppdragsbrevet är skickat för signering');
}
