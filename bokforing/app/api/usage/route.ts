import { currentUser } from '@/lib/server/auth';
import { recordUsage } from '@/lib/services/usage';
import { usagePath } from '@/lib/usage';
import { hit } from '@/lib/server/ratelimit';

/** Menyn rapporterar vilken sida användaren öppnade (navigator.sendBeacon). Används bara för att lära sig vanliga åtgärder. */
export async function POST(req: Request) {
  // Bara från appen själv
  const origin = req.headers.get('origin');
  if (origin && new URL(origin).host !== req.headers.get('host')) return new Response(null, { status: 403 });
  const user = await currentUser();
  if (!user) return new Response(null, { status: 401 });
  let body: { path?: unknown };
  try { body = JSON.parse((await req.text()).slice(0, 1000)); } catch { return new Response(null, { status: 400 }); }
  const p = typeof body.path === 'string' ? usagePath(body.path) : null;
  if (!p) return new Response(null, { status: 204 });
  if (!(await hit(`usage:${user.id}`, 300, 3600)).ok) return new Response(null, { status: 204 });
  await recordUsage(user.id, p.cid, p.path);
  return new Response(null, { status: 204 });
}
