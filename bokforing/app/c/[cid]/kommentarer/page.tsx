import Link from 'next/link';
import { requireCompany } from '@/lib/server/auth';
import { Flash, EmptyState, type SP } from '@/components/ui';
import { CommentThread } from '@/components/CommentThread';
import { ENTITY_PERM, entityInfo, isEntity, recentComments } from '@/lib/services/comments';

export const dynamic = 'force-dynamic';

const LINK: Record<string, (c: number, id: number) => string> = {
  bank_transaction: (c, id) => `/c/${c}/kommentarer?entity=bank_transaction&id=${id}`, voucher: (c, id) => `/c/${c}/verifikationer/${id}#kommentarer`,
  supplier_invoice: (c, id) => `/c/${c}/leverantorsfakturor/${id}#kommentarer`, invoice: (c, id) => `/c/${c}/fakturor/${id}#kommentarer`,
};
const KIND: Record<string, string> = { bank_transaction: 'Banktransaktion', voucher: 'Verifikation', supplier_invoice: 'Leverantörsfaktura', invoice: 'Kundfaktura' };

export default async function Comments({ params, searchParams }: { params: Promise<{ cid: string }>; searchParams: SP }) {
  const { cid } = await params;
  const ctx = await requireCompany(cid);
  const sp = await searchParams;
  const entity = String(sp.entity ?? '');
  const id = Number(sp.id);
  // En enskild tråd (används för banktransaktioner som saknar egen sida)
  if (isEntity(entity) && Number.isInteger(id) && ctx.can(ENTITY_PERM[entity])) {
    const info = await entityInfo(ctx.company.id, entity, id);
    return (
      <div style={{ maxWidth: 860 }}>
        <h1>Kommentarer</h1>
        <Flash searchParams={searchParams} />
        <p><Link href={info.href}>{info.title}</Link></p>
        <CommentThread cid={ctx.company.id} entity={entity} id={id} back={`/c/${ctx.company.id}/kommentarer?entity=${entity}&id=${id}`} />
      </div>
    );
  }
  const list = await recentComments(ctx.company.id, ctx.user.id, ctx.can);
  return (
    <div style={{ maxWidth: 860 }}>
      <h1>Kommentarer</h1>
      <Flash searchParams={searchParams} />
      <p className="muted">Kommentarer på verifikationer, fakturor och banktransaktioner. De där du har nämnts står först.</p>
      {list.length === 0 ? <EmptyState icon="users" title="Inga kommentarer än">Öppna en verifikation, faktura eller banktransaktion och skriv en kommentar längst ned. Skriv @ och ett namn för att nämna någon – hen får en notis.</EmptyState> : (
        <div className="stack" style={{ gap: '.5rem' }}>
          {list.map((c) => (
            <Link key={c.id} href={LINK[c.entity](ctx.company.id, c.entity_id)} className={`card comment-row${c.unseen ? ' unseen' : ''}`} style={{ color: 'var(--text)', margin: 0 }}>
              <div className="small muted">{KIND[c.entity]} · {c.author ?? 'Borttagen användare'} · {c.created_at} {c.mention && <span className="badge">{c.unseen ? 'Ny – du nämns' : 'Du nämns'}</span>}</div>
              <div>{c.body.length > 200 ? c.body.slice(0, 200) + '…' : c.body}</div>
            </Link>
          ))}
        </div>
      )}
    </div>
  );
}
