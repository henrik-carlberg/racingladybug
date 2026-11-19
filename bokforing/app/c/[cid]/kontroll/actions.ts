'use server';
import { attempt, done, str } from '@/lib/server/action';
import { requireCompany } from '@/lib/server/auth';
import { userActor } from '@/lib/services/actor';
import { decideBankChange, resolveAlert } from '@/lib/services/fraud';

const back = (cid: number) => `/c/${cid}/kontroll`;

export async function decide(cid: number, id: number, approve: boolean, fd: FormData) {
  const actor = userActor(await requireCompany(cid, { perm: 'attest' }));
  await attempt(back(cid), () => decideBankChange(actor, id, approve, str(fd, 'comment'), fd.get('verified') === 'on'));
  done(back(cid), approve ? 'De nya bankuppgifterna är godkända och gäller nu' : 'Ändringen är avslagen – de gamla bankuppgifterna gäller');
}

export async function resolve(cid: number, id: number, status: 'ok' | 'confirmed', fd: FormData) {
  const actor = userActor(await requireCompany(cid, { perm: 'ledger' }));
  await attempt(back(cid), () => resolveAlert(actor, id, status, str(fd, 'comment')));
  done(back(cid), status === 'ok' ? 'Varningen är kontrollerad och stängd' : 'Varningen är markerad som ett verkligt problem');
}
