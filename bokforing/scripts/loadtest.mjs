// Lasttest: fyller ett bolag med många verifikationer och fakturor och mäter svarstiderna för de tyngsta sidorna.
// Kör mot en TESTDATABAS (aldrig produktion):
//   node scripts/loadtest.mjs --company 1 --vouchers 100000 --base http://localhost:3100 --email agare@example.com --password …
import postgres from 'postgres';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
for (const f of ['.env.local', '.env']) {
  const p = path.join(root, f);
  if (!process.env.DATABASE_URL && fs.existsSync(p)) for (const line of fs.readFileSync(p, 'utf8').split('\n')) { const m = line.match(/^\s*([A-Z_]+)\s*=\s*(.*)\s*$/); if (m && !process.env[m[1]]) process.env[m[1]] = m[2].replace(/^"|"$/g, ''); }
}
const arg = (k, d) => { const i = process.argv.indexOf(`--${k}`); return i > 0 ? process.argv[i + 1] : d; };
const cid = Number(arg('company', '1')), N = Number(arg('vouchers', '100000')), base = arg('base', 'http://localhost:3100');
const limit = Number(arg('limit-ms', '3000'));
if (/prod|neon\.tech|vercel/i.test(process.env.DATABASE_URL ?? '') && !process.argv.includes('--i-know')) { console.error('Ser ut som en produktionsdatabas – avbryter'); process.exit(1); }
const sql = postgres(process.env.DATABASE_URL, { max: 2, onnotice: () => {} });

async function seed() {
  const [fy] = await sql`SELECT id, start_date, end_date FROM fiscal_years WHERE company_id = ${cid} AND current_date BETWEEN start_date AND end_date`;
  if (!fy) throw new Error('Inget räkenskapsår för i dag');
  const [{ n }] = await sql`SELECT count(*)::int AS n FROM vouchers WHERE company_id = ${cid} AND series = 'L'`;
  if (n >= N) { console.log(`Redan ${n} lasttestverifikationer`); return; }
  const [{ uid }] = await sql`SELECT user_id AS uid FROM memberships WHERE company_id = ${cid} AND role = 'owner' LIMIT 1`;
  console.log(`Skapar ${N - n} verifikationer (serie L)…`);
  const t0 = Date.now();
  await sql.begin(async (tx) => {
    // Bokföringen spärrar ändringar via triggers på vissa tabeller; lasttestdata läggs in direkt
    await tx`INSERT INTO vouchers (company_id, fiscal_year_id, series, number, date, description, source_type, created_by)
      SELECT ${cid}, ${fy.id}, 'L', g, ${fy.start_date}::date + (g % GREATEST(1, (current_date - ${fy.start_date}::date))), 'Lasttest ' || g, 'manual', ${uid}
      FROM generate_series(${n + 1}::int, ${N}::int) g`;
    await tx`INSERT INTO voucher_lines (voucher_id, account_number, debit, credit, description)
      SELECT v.id, (ARRAY[5010,6110,4010,6212,5410])[1 + (v.number % 5)], 10000 + (v.number % 997) * 100, 0, '' FROM vouchers v WHERE v.company_id = ${cid} AND v.series = 'L' AND v.number > ${n}`;
    await tx`INSERT INTO voucher_lines (voucher_id, account_number, debit, credit, description)
      SELECT v.id, 1930, 0, 10000 + (v.number % 997) * 100, '' FROM vouchers v WHERE v.company_id = ${cid} AND v.series = 'L' AND v.number > ${n}`;
  });
  await sql`ANALYZE vouchers; ANALYZE voucher_lines`.simple();
  console.log(`Klart på ${((Date.now() - t0) / 1000).toFixed(1)} s`);
}

async function login() {
  // Inloggningen är en serveråtgärd; enklast att skapa en session direkt i databasen
  const { createHash, randomBytes } = await import('node:crypto');
  const token = randomBytes(32).toString('base64url');
  const [{ uid }] = await sql`SELECT user_id AS uid FROM memberships WHERE company_id = ${cid} AND role = 'owner' LIMIT 1`;
  await sql`INSERT INTO sessions (id, user_id, expires_at) VALUES (${createHash('sha256').update(token).digest('hex')}, ${uid}, now() + interval '1 hour')`;
  return `bok_session=${token}`;
}

async function measure(cookie) {
  const [fy] = await sql`SELECT id FROM fiscal_years WHERE company_id = ${cid} AND current_date BETWEEN start_date AND end_date`;
  const pages = [
    ['Översikt', `/c/${cid}`], ['Verifikationer', `/c/${cid}/verifikationer`], ['Huvudbok', `/c/${cid}/rapporter/huvudbok`],
    ['Resultat och balans', `/c/${cid}/rapporter`], ['Jämförelse mot förra året', `/c/${cid}/rapporter?jmf=fjol`], ['Instrumentpanel', `/c/${cid}/rapporter/panel`],
    ['Momsrapport', `/c/${cid}/rapporter/moms`], ['Kundfakturor', `/c/${cid}/fakturor`], ['Bankavstämning', `/c/${cid}/bank/avstamning`],
    ['SIE-export', `/c/${cid}/rapporter/export/sie?fy=${fy.id}`], ['Excel: verifikationer', `/c/${cid}/rapporter/xlsx?r=verifikationer`],
  ];
  const out = [];
  for (const [name, p] of pages) {
    const times = [];
    let status = 0, bytes = 0;
    for (let i = 0; i < 3; i++) {
      const t = performance.now();
      const r = await fetch(base + p, { headers: { cookie }, redirect: 'manual' });
      const b = await r.arrayBuffer();
      times.push(performance.now() - t); status = r.status; bytes = b.byteLength;
    }
    times.sort((a, b) => a - b);
    out.push({ sida: name, status, 'median ms': Math.round(times[1]), 'max ms': Math.round(times[2]), kB: Math.round(bytes / 1024) });
  }
  console.table(out);
  // Exporter av hela året får ta längre tid än vanliga sidor
  const slow = out.filter((x) => x['median ms'] > (/export|Excel/i.test(x.sida) ? limit * 3 : limit) || (x.status !== 200 && x.status !== 307));
  if (slow.length) { console.error(`För långsamt eller fel (gräns ${limit} ms):`, slow.map((x) => x.sida).join(', ')); process.exitCode = 1; }
}

await seed();
if (!process.argv.includes('--seed-only')) await measure(await login());
await sql.end();
