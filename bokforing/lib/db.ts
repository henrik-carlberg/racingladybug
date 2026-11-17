import postgres from 'postgres';

type Sql = ReturnType<typeof postgres>;

declare global {
  // eslint-disable-next-line no-var
  var __sql: Sql | undefined;
}

function create(): Sql {
  const url = process.env.DATABASE_URL;
  if (!url) throw new Error('DATABASE_URL saknas');
  return postgres(url, {
    max: process.env.VERCEL ? 1 : 5,
    prepare: false, // krävs för poolade anslutningar (Neon/pgbouncer)
    types: {
      // bigint (öre) returneras som number – säkert upp till 90 biljoner kr.
      bigint: { to: 20, from: [20], serialize: (x: number) => String(x), parse: (x: string) => Number(x) },
    },
    onnotice: () => {},
  });
}

const real = (): Sql => (globalThis.__sql ??= create());

/** Anslutningen skapas först vid första användningen (så att import inte kräver DATABASE_URL). */
export const sql: Sql = new Proxy(function () {} as unknown as Sql, {
  apply: (_t, _this, args) => (real() as unknown as (...a: unknown[]) => unknown)(...args),
  get: (_t, prop) => {
    const s = real() as unknown as Record<string | symbol, unknown>;
    const v = s[prop];
    return typeof v === 'function' ? (v as (...a: unknown[]) => unknown).bind(s) : v;
  },
}) as Sql;
export type Tx = postgres.TransactionSql;
