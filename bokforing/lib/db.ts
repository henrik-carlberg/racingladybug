import postgres from 'postgres';

declare global {
  // eslint-disable-next-line no-var
  var __sql: ReturnType<typeof postgres> | undefined;
}

function create() {
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

export const sql = globalThis.__sql ?? (globalThis.__sql = create());
export type Tx = postgres.TransactionSql;
