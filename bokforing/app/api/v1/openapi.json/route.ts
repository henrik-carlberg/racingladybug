import { buildOpenApi } from '@/lib/api/openapi';

export const dynamic = 'force-dynamic';

export async function GET(req: Request) {
  const url = new URL(req.url);
  const proto = req.headers.get('x-forwarded-proto') ?? url.protocol.replace(':', '');
  const host = req.headers.get('x-forwarded-host') ?? req.headers.get('host') ?? url.host;
  return Response.json(buildOpenApi(`${proto}://${host}`), { headers: { 'Access-Control-Allow-Origin': '*' } });
}
