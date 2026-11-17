import type { Actor } from '@/lib/services/actor';

export type Method = 'GET' | 'POST' | 'PATCH' | 'DELETE';

export interface ApiContext {
  actor: Actor;
  params: Record<string, string>;
  query: URLSearchParams;
  body: Record<string, unknown>;
}

/** JSON Schema (förenklat) för dokumentation i OpenAPI */
export type Schema = Record<string, unknown>;

export interface ApiRoute {
  method: Method;
  path: string; // t.ex. '/invoices/:id/book'
  scope: string; // krävd behörighet, t.ex. 'sales:write'
  summary: string;
  description?: string;
  tag?: string;
  body?: Schema;
  query?: { name: string; description: string; type?: string }[];
  status?: number; // HTTP-status vid lyckat anrop (standard 200)
  handler: (ctx: ApiContext) => Promise<unknown>;
}

export function compile(path: string): { re: RegExp; keys: string[] } {
  const keys: string[] = [];
  const re = new RegExp(
    '^' + path.replace(/\/+$/, '').replace(/:([a-zA-Z_]+)/g, (_, k) => { keys.push(k); return '([^/]+)'; }) + '/?$',
  );
  return { re, keys };
}

export function matchRoute(routes: ApiRoute[], method: string, path: string):
  { route: ApiRoute; params: Record<string, string> } | { allowed: Method[] } | null {
  const allowed: Method[] = [];
  for (const route of routes) {
    const { re, keys } = compile(route.path);
    const m = path.match(re);
    if (!m) continue;
    if (route.method !== method) { allowed.push(route.method); continue; }
    const params: Record<string, string> = {};
    keys.forEach((k, i) => (params[k] = decodeURIComponent(m[i + 1])));
    return { route, params };
  }
  return allowed.length ? { allowed } : null;
}

/** Kontrollerar om en nyckels scopes täcker det krävda scopet. 'x:write' innefattar 'x:read'. */
export function hasScope(granted: string[], required: string): boolean {
  if (granted.includes('*') || granted.includes(required)) return true;
  const [area, level] = required.split(':');
  return level === 'read' && granted.includes(`${area}:write`);
}
