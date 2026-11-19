'use server';
import { attempt, done, str } from '@/lib/server/action';
import { requireCompany } from '@/lib/server/auth';
import { userActor } from '@/lib/services/actor';
import { addComment, ENTITY_PERM, isEntity } from '@/lib/services/comments';

export async function comment(cid: number, entity: string, id: number, fd: FormData) {
  if (!isEntity(entity)) throw new Error('Ogiltig koppling');
  const ctx = await requireCompany(cid);
  const back = str(fd, 'back').startsWith(`/c/${ctx.company.id}/`) ? str(fd, 'back') : `/c/${ctx.company.id}/kommentarer?entity=${entity}&id=${id}`;
  await attempt(back, async () => {
    if (!ctx.can(ENTITY_PERM[entity])) throw new Error('Du saknar behörighet att kommentera här');
    await addComment({ ...userActor(ctx), userName: ctx.user.name }, entity, id, str(fd, 'body'));
  });
  done(back.includes('#') ? back : `${back}#kommentarer`, 'Kommentaren är skickad');
}
