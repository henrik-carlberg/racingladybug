import { requireCompany } from '@/lib/server/auth';
import { ENTITY_PERM, listComments, mentionable, type Entity } from '@/lib/services/comments';
import { comment } from '@/app/c/[cid]/kommentarer/actions';
import { CommentForm } from './CommentForm';

/** Kommentarer på en verifikation, faktura, leverantörsfaktura eller banktransaktion */
export async function CommentThread({ cid, entity, id, back }: { cid: number; entity: Entity; id: number; back: string }) {
  const ctx = await requireCompany(cid, { employee: true });
  if (ctx.role === 'employee' || !(ctx.role === 'owner' || ctx.can(ENTITY_PERM[entity]) || ctx.role === 'auditor')) return null;
  const list = await listComments(ctx.company.id, entity, id, ctx.user.id);
  const people = (await mentionable(ctx.company.id)).filter((p) => p.id !== ctx.user.id);
  const mark = (body: string) => body.split(/(@[\p{L}\p{N}]+(?: [\p{L}\p{N}]+)?)/u).map((part, i) =>
    part.startsWith('@') && people.concat([{ id: ctx.user.id, name: ctx.user.name }]).some((p) => part.slice(1).toLowerCase().startsWith(p.name.split(' ')[0].toLowerCase())) ? <b key={i} className="mention">{part}</b> : part);
  return (
    <section className="card comments" id="kommentarer">
      <h2 style={{ marginTop: 0 }}>Kommentarer{list.length ? ` (${list.length})` : ''}</h2>
      {list.length === 0 && <p className="small muted">Inga kommentarer än. Skriv en fråga eller en notering – nämn någon med @ så får hen en notis.</p>}
      {list.map((c) => (
        <div key={c.id} className={c.mine ? 'comment mine' : 'comment'}>
          <div className="small muted">{c.author ?? 'Borttagen användare'} · {c.created_at}</div>
          <div className="comment-body">{mark(c.body)}</div>
        </div>
      ))}
      {ctx.role !== 'auditor' && <CommentForm action={comment.bind(null, ctx.company.id, entity, id)} people={people} back={back} />}
    </section>
  );
}
