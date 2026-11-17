// Kör SQL-migreringar i db/migrations i ordning. Används lokalt och i Vercels build-steg.
import postgres from 'postgres';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
for (const f of ['.env.local', '.env']) {
  const p = path.join(root, f);
  if (!process.env.DATABASE_URL && fs.existsSync(p)) {
    for (const line of fs.readFileSync(p, 'utf8').split('\n')) {
      const m = line.match(/^\s*([A-Z_]+)\s*=\s*(.*)\s*$/);
      if (m && !process.env[m[1]]) process.env[m[1]] = m[2].replace(/^"|"$/g, '');
    }
  }
}
const url = process.env.DATABASE_URL_UNPOOLED || process.env.DATABASE_URL;
if (!url) { console.error('DATABASE_URL saknas'); process.exit(1); }

const sql = postgres(url, { max: 1, onnotice: () => {} });
await sql`CREATE TABLE IF NOT EXISTS schema_migrations (name text PRIMARY KEY, applied_at timestamptz NOT NULL DEFAULT now())`;
const done = new Set((await sql`SELECT name FROM schema_migrations`).map((r) => r.name));
// Kärnans migreringar först, därefter varje moduls egna (modules/<id>/migrations/*.sql)
const sources = [{ prefix: '', dir: path.join(root, 'db', 'migrations') }];
const modulesDir = path.join(root, 'modules');
if (fs.existsSync(modulesDir)) {
  for (const m of fs.readdirSync(modulesDir).sort()) {
    const d = path.join(modulesDir, m, 'migrations');
    if (fs.existsSync(d)) sources.push({ prefix: `${m}/`, dir: d });
  }
}
for (const { prefix, dir } of sources) {
  for (const file of fs.readdirSync(dir).filter((f) => f.endsWith('.sql')).sort()) {
    const name = prefix + file;
    if (done.has(name)) continue;
    await sql.begin(async (tx) => {
      await tx.unsafe(fs.readFileSync(path.join(dir, file), 'utf8'));
      await tx`INSERT INTO schema_migrations (name) VALUES (${name})`;
    });
    console.log('Migrerade', name);
  }
}
await sql.end();
