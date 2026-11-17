import 'server-only';
import { createHash } from 'node:crypto';
import { sql } from '@/lib/db';
import { AppError } from '@/lib/errors';
import { authenticateApiKey } from '@/lib/server/apikeys';
import { MODULES } from '@/modules/registry';
import { CORE_ROUTES } from './routes';
import { hasScope, matchRoute, type ApiRoute } from './router';

const json = (status: number, body: unknown, headers: Record<string, string> = {}) =>
  new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store', ...headers } });
const error = (status: number, code: string, message: string, headers?: Record<string, string>) => json(status, { error: { code, message } }, headers);

/** Hittar rätt uppsättning endpoints: kärnan, eller /m/<modul>/… för en modul */
function resolve(path: string): { routes: ApiRoute[]; sub: string; moduleId: string | null } | null {
  const m = path.match(/^\/m\/([a-z0-9-]+)(\/.*)?$/);
  if (!m) return { routes: CORE_ROUTES, sub: path, moduleId: null };
  const mod = MODULES.find((x) => x.id === m[1]);
  return mod ? { routes: mod.api ?? [], sub: m[2] ?? '/', moduleId: mod.id } : null;
}

export async function handleApi(req: Request, pathParts: string[]): Promise<Response> {
  const method = req.method.toUpperCase();
  const path = '/' + pathParts.map(encodeURIComponent).join('/');
  try {
    const auth = req.headers.get('authorization') ?? '';
    const token = auth.replace(/^Bearer\s+/i, '').trim();
    if (!token) return error(401, 'unauthorized', 'Ange API-nyckel: Authorization: Bearer <nyckel>', { 'WWW-Authenticate': 'Bearer' });
    const who = await authenticateApiKey(token);
    if (!who) return error(401, 'unauthorized', 'Ogiltig eller återkallad API-nyckel', { 'WWW-Authenticate': 'Bearer' });

    const target = resolve(path);
    const match = target && matchRoute(target.routes, method, target.sub);
    if (!target || !match) return error(404, 'not_found', `Okänd endpoint: ${method} /api/v1${path}`);
    if ('allowed' in match) return error(405, 'method_not_allowed', `Tillåtna metoder: ${match.allowed.join(', ')}`, { Allow: match.allowed.join(', ') });
    const { route, params } = match;
    if (!hasScope(who.scopes, route.scope)) return error(403, 'insufficient_scope', `Nyckeln saknar behörigheten ${route.scope}`);
    if (target.moduleId) {
      const en = await sql`SELECT 1 FROM company_modules WHERE company_id = ${who.actor.companyId} AND module_id = ${target.moduleId}`;
      if (!en.length) return error(403, 'module_disabled', `Modulen ${target.moduleId} är inte aktiverad för bolaget`);
    }

    let body: Record<string, unknown> = {};
    let raw = '';
    if (method !== 'GET' && method !== 'DELETE') {
      raw = await req.text();
      if (raw) {
        try { body = JSON.parse(raw); } catch { return error(400, 'invalid_json', 'Body är inte giltig JSON'); }
        if (typeof body !== 'object' || body === null || Array.isArray(body)) return error(400, 'invalid_json', 'Body måste vara ett JSON-objekt');
      }
    }

    // Idempotens: samma Idempotency-Key + samma anrop ger samma svar, utan att utföras igen
    const idemKey = method === 'POST' ? req.headers.get('idempotency-key') : null;
    const reqHash = createHash('sha256').update(`${method} ${path} ${raw}`).digest('hex');
    if (idemKey) {
      if (idemKey.length > 255) return error(400, 'invalid_request', 'Idempotency-Key är för lång');
      const ins = await sql`INSERT INTO idempotency_keys (company_id, key, request_hash) VALUES (${who.actor.companyId}, ${idemKey}, ${reqHash})
        ON CONFLICT DO NOTHING RETURNING key`;
      if (!ins.length) {
        const [prev] = await sql<{ request_hash: string; status: number | null; response: unknown }[]>`
          SELECT request_hash, status, response FROM idempotency_keys WHERE company_id = ${who.actor.companyId} AND key = ${idemKey}`;
        if (prev.request_hash !== reqHash) return error(422, 'idempotency_mismatch', 'Idempotency-Key har redan använts för ett annat anrop');
        if (prev.status == null) return error(409, 'idempotency_in_progress', 'Ett anrop med samma Idempotency-Key pågår');
        return json(prev.status, prev.response, { 'Idempotent-Replayed': 'true' });
      }
    }

    const finish = async (status: number, payload: unknown) => {
      if (idemKey) {
        // Spara bara lyckade svar och valideringsfel; serverfel får försökas igen
        if (status < 500) await sql`UPDATE idempotency_keys SET status = ${status}, response = ${sql.json(payload as never)} WHERE company_id = ${who.actor.companyId} AND key = ${idemKey}`;
        else await sql`DELETE FROM idempotency_keys WHERE company_id = ${who.actor.companyId} AND key = ${idemKey}`;
      }
      return json(status, payload);
    };

    try {
      const url = new URL(req.url);
      const origin = process.env.APP_ORIGIN ?? `${req.headers.get('x-forwarded-proto') ?? url.protocol.replace(':', '')}://${req.headers.get('x-forwarded-host') ?? req.headers.get('host') ?? url.host}`;
      const result = await route.handler({ actor: who.actor, params, query: url.searchParams, body, origin });
      if (result instanceof Response) return result;
      return finish(route.status ?? 200, result);
    } catch (e) {
      if (e instanceof AppError) return finish(e.status, { error: { code: e.code, message: e.message } });
      throw e;
    }
  } catch (e) {
    console.error('API-fel', e);
    return error(500, 'internal_error', 'Internt fel');
  }
}
