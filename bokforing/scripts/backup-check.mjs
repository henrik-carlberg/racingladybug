// Kontrollerar att en säkerhetskopia går att återställa: pg_dump av källan, pg_restore till en tom måldatabas,
// och jämförelse av antal rader per tabell. Kräver pg_dump och pg_restore (samma huvudversion som servern).
//   SOURCE_DATABASE_URL=... TARGET_DATABASE_URL=... node scripts/backup-check.mjs
// Måldatabasen töms. Använd aldrig produktionsdatabasen som mål.
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import postgres from 'postgres';

const src = process.env.SOURCE_DATABASE_URL;
const dst = process.env.TARGET_DATABASE_URL;
if (!src || !dst) { console.error('Ange SOURCE_DATABASE_URL och TARGET_DATABASE_URL'); process.exit(2); }
if (src === dst) { console.error('Källa och mål får inte vara samma databas'); process.exit(2); }

const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'backup-'));
const file = path.join(dir, 'dump.pgc');
const t0 = Date.now();
try {
  execFileSync('pg_dump', ['--format=custom', '--no-owner', '--no-privileges', '--file', file, src], { stdio: 'inherit' });
  const size = fs.statSync(file).size;
  console.log(`Kopia: ${(size / 1024 / 1024).toFixed(1)} MB på ${((Date.now() - t0) / 1000).toFixed(1)} s`);
  execFileSync('pg_restore', ['--clean', '--if-exists', '--no-owner', '--no-privileges', '--exit-on-error', '--dbname', dst, file], { stdio: 'inherit' });

  const a = postgres(src, { max: 1, onnotice: () => {} });
  const b = postgres(dst, { max: 1, onnotice: () => {} });
  const tables = await a`SELECT tablename FROM pg_tables WHERE schemaname = 'public' ORDER BY tablename`;
  let bad = 0;
  for (const { tablename } of tables) {
    const [x] = await a`SELECT count(*)::bigint AS n FROM ${a(tablename)}`;
    const [y] = await b`SELECT count(*)::bigint AS n FROM ${b(tablename)}`.catch(() => [{ n: -1 }]);
    // Källan kan ha fått nya rader under tiden; återställningen får inte ha färre än vid dumpen men kan skilja något
    const ok = Number(y.n) >= 0 && Math.abs(Number(x.n) - Number(y.n)) <= Math.max(5, Number(x.n) * 0.01);
    if (!ok) bad++;
    if (!ok || process.env.VERBOSE) console.log(`${ok ? 'OK ' : 'FEL'} ${tablename}: källa ${x.n}, återställd ${y.n}`);
  }
  // Verifikationerna måste balansera även i kopian
  const [bal] = await b`SELECT count(*)::int AS n FROM (SELECT voucher_id FROM voucher_lines GROUP BY voucher_id HAVING SUM(debit) <> SUM(credit)) x`;
  if (bal.n) { bad++; console.log(`FEL: ${bal.n} verifikationer balanserar inte i kopian`); }
  await a.end(); await b.end();
  console.log(bad ? `Återställningen har ${bad} avvikelser` : `Återställningen är kontrollerad: ${tables.length} tabeller, klart på ${((Date.now() - t0) / 1000).toFixed(1)} s`);
  process.exit(bad ? 1 : 0);
} finally {
  fs.rmSync(dir, { recursive: true, force: true });
}
