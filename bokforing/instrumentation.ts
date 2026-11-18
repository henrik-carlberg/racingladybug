// Fångar fel på servern (sidor, API och serveråtgärder) och sparar dem i felloggen med larm till driften.
export async function register() {}

export async function onRequestError(
  err: unknown,
  request: { path: string; method: string },
  context: { routerKind: string; routePath: string; routeType: string },
) {
  if (process.env.NEXT_RUNTIME !== 'nodejs') return;
  const e = err instanceof Error ? err : new Error(String(err));
  const { recordError } = await import('./lib/server/monitor');
  await recordError({ message: e.message, stack: e.stack, path: request.path, method: request.method, kind: context.routeType });
}
