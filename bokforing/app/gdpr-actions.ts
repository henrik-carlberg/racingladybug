'use server';
import { attempt, done, str } from '@/lib/server/action';
import { destroySession, requireCompany, requireUser } from '@/lib/server/auth';
import { userActor } from '@/lib/services/actor';
import { acceptDpa, deleteAccount, pruneEmployees } from '@/lib/services/gdpr';

export async function removeAccount(fd: FormData) {
  const user = await requireUser();
  await attempt('/konto#gdpr', () => deleteAccount(user.id, str(fd, 'password'), str(fd, 'confirm')));
  await destroySession();
  done('/login', 'Ditt konto är raderat');
}

export async function approveDpa(cid: number) {
  const actor = userActor(await requireCompany(cid, { owner: true }));
  await attempt(`/c/${cid}/installningar/gdpr`, () => acceptDpa(actor));
  done(`/c/${cid}/installningar/gdpr`, 'Personuppgiftsbiträdesavtalet är godkänt');
}

export async function prune(cid: number) {
  const actor = userActor(await requireCompany(cid, { owner: true }));
  let n = 0;
  await attempt(`/c/${cid}/installningar/gdpr`, async () => { n = await pruneEmployees(actor); });
  done(`/c/${cid}/installningar/gdpr`, `Personuppgifterna för ${n} tidigare anställda är gallrade`);
}
