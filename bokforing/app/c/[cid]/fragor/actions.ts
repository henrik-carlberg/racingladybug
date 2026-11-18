'use server';
import { attempt, done, str } from '@/lib/server/action';
import { requireCompany } from '@/lib/server/auth';
import { userActor } from '@/lib/services/actor';
import * as svc from '@/lib/services/firms';

const base = (cid: number) => `/c/${cid}/fragor`;

export async function ask(cid: number, fd: FormData) {
  const actor = userActor(await requireCompany(cid));
  await attempt(base(cid), () => svc.askQuestion(actor, { question: str(fd, 'question'), entity: str(fd, 'entity') || undefined, entity_id: Number(str(fd, 'entity_id')) || undefined }));
  done(str(fd, 'back') || base(cid), 'Frågan är skickad');
}

export async function answer(cid: number, id: number, fd: FormData) {
  const actor = userActor(await requireCompany(cid));
  await attempt(base(cid), () => svc.answerQuestion(actor, id, str(fd, 'answer')));
  done(base(cid), 'Tack, svaret är skickat');
}

export async function close(cid: number, id: number) {
  const actor = userActor(await requireCompany(cid));
  await attempt(base(cid), () => svc.closeQuestion(actor, id));
  done(base(cid), 'Frågan är avslutad');
}
