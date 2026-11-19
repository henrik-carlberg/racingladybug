'use server';
import { attempt, done, fileFrom, str } from '@/lib/server/action';
import { requireCompany } from '@/lib/server/auth';
import { userActor } from '@/lib/services/actor';
import * as svc from '@/lib/services/firms';

const base = (cid: number) => `/c/${cid}/fragor`;

export async function ask(cid: number, fd: FormData) {
  const actor = userActor(await requireCompany(cid));
  await attempt(base(cid), () => svc.askQuestion(actor, { question: str(fd, 'question'), entity: str(fd, 'entity') || undefined, entity_id: Number(str(fd, 'entity_id')) || undefined, needs_document: fd.get('needs_document') === 'on' || fd.get('needs_document') === '1' }));
  const back = str(fd, 'back');
  done(back.startsWith(`/c/${cid}/`) ? back : base(cid), fd.get('needs_document') ? 'Underlag är begärt – kunden ser det i sin att göra-lista' : 'Frågan är skickad');
}

export async function answer(cid: number, id: number, fd: FormData) {
  const actor = userActor(await requireCompany(cid));
  const file = await fileFrom(fd);
  await attempt(base(cid), () => svc.answerQuestion(actor, id, str(fd, 'answer'), file));
  done(base(cid), 'Tack, svaret är skickat');
}

export async function close(cid: number, id: number) {
  const actor = userActor(await requireCompany(cid));
  await attempt(base(cid), () => svc.closeQuestion(actor, id));
  done(base(cid), 'Frågan är avslutad');
}
