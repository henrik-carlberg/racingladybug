import { notFound } from 'next/navigation';
import { requireCompany } from '@/lib/server/auth';
import { isModuleEnabled } from '@/lib/modules/enabled';
import { compile } from '@/lib/api/router';
import { userActor } from '@/lib/services/actor';
import { getModule } from '@/modules/registry';
import { Flash, type SP } from '@/components/ui';

export const dynamic = 'force-dynamic';

/** Renderar en moduls sida utifrån dess pages-mönster */
export default async function ModulePage({ params, searchParams }: { params: Promise<{ cid: string; mod: string; path?: string[] }>; searchParams: SP }) {
  const { cid, mod, path = [] } = await params;
  const ctx = await requireCompany(cid);
  const m = getModule(mod);
  if (!m || !(await isModuleEnabled(ctx.company.id, m.id))) notFound();
  const sub = '/' + path.join('/');
  for (const [pattern, Page] of Object.entries(m.pages ?? {})) {
    const { re, keys } = compile('/' + pattern);
    const hit = sub.match(re);
    if (!hit) continue;
    const p: Record<string, string> = {};
    keys.forEach((k, i) => (p[k] = decodeURIComponent(hit[i + 1])));
    const sp = Object.fromEntries(Object.entries(await searchParams).map(([k, v]) => [k, Array.isArray(v) ? v[0] : v]));
    return (
      <>
        <Flash searchParams={searchParams} />
        {await Page({ companyId: ctx.company.id, actor: userActor(ctx), params: p, searchParams: sp, basePath: `/c/${ctx.company.id}/m/${m.id}` })}
      </>
    );
  }
  notFound();
}
