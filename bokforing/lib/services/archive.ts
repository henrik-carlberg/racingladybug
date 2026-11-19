import 'server-only';
import { createHash } from 'node:crypto';
import { sql } from '@/lib/db';
import { encodeCp437 } from '@/lib/sie';
import { zip } from '@/lib/zip';
import { sieForYear } from './sie-export';
import { systemDocumentation } from './sysdoc';

const MAX_BYTES = 400 * 1024 * 1024;
const esc = (s: string) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
const safe = (s: string) => s.normalize('NFKD').replace(/[^\w.-]+/g, '_').replace(/_+/g, '_').slice(0, 80) || 'fil';
const csv = (v: unknown) => { const s = String(v ?? ''); return /[;"\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s; };

/**
 * Arkivpaket för ett räkenskapsår: alla verifikationer med underlag, SIE 4, register och systemdokumentation,
 * med kontrollsummor (SHA-256) för varje fil. För att spara i sju år (BFL 7 kap.) eller lämna till revisorn.
 */
export async function buildArchive(companyId: number, fyId: number, sysdocHtml: (d: Awaited<ReturnType<typeof systemDocumentation>>) => string) {
  const sie = await sieForYear(companyId, fyId);
  if (!sie) return null;
  const [co] = await sql<{ name: string; orgnr: string }[]>`SELECT name, orgnr FROM companies WHERE id = ${companyId}`;
  const vouchers = await sql<{ id: number; ver: string; date: string; description: string; source: string | null; corrects: string | null; created: string; by: string | null; d: number }[]>`
    SELECT v.id, v.series || v.number AS ver, to_char(v.date,'YYYY-MM-DD') AS date, v.description, v.source_type AS source,
      (SELECT o.series || o.number FROM vouchers o WHERE o.id = v.corrects_id) AS corrects, to_char(v.created_at,'YYYY-MM-DD HH24:MI') AS created, u.name AS by,
      (SELECT COALESCE(SUM(debit), 0) FROM voucher_lines WHERE voucher_id = v.id)::bigint AS d
    FROM vouchers v LEFT JOIN users u ON u.id = v.created_by WHERE v.company_id = ${companyId} AND v.fiscal_year_id = ${fyId} ORDER BY v.series, v.number`;
  const atts = await sql<{ id: number; voucher_id: number; filename: string; mime_type: string; size: number }[]>`
    SELECT a.id, COALESCE(a.voucher_id, si.voucher_id) AS voucher_id, a.filename, a.mime_type, length(a.data)::int AS size FROM attachments a
    LEFT JOIN supplier_invoices si ON si.id = a.supplier_invoice_id
    JOIN vouchers v ON v.id = COALESCE(a.voucher_id, si.voucher_id) WHERE a.company_id = ${companyId} AND v.fiscal_year_id = ${fyId}`;
  const total = atts.reduce((s, a) => s + a.size, 0);
  if (total > MAX_BYTES) throw new Error(`Underlagen är för stora för ett paket (${Math.round(total / 1e6)} MB). Kontakta supporten för export i delar.`);
  const year = sie.fy.start_date.slice(0, 4) === sie.fy.end_date.slice(0, 4) ? sie.fy.start_date.slice(0, 4) : `${sie.fy.start_date.slice(0, 7)}_${sie.fy.end_date.slice(0, 7)}`;
  const files: { name: string; data: Buffer }[] = [];
  const byVoucher = new Map<number, { path: string; name: string }[]>();
  for (const a of atts) {
    const [row] = await sql<{ data: Buffer }[]>`SELECT data FROM attachments WHERE id = ${a.id}`;
    const v = vouchers.find((x) => x.id === a.voucher_id);
    const path = `underlag/${safe(v?.ver ?? 'okand')}_${a.id}_${safe(a.filename)}`;
    files.push({ name: path, data: Buffer.from(row.data) });
    byVoucher.set(a.voucher_id, [...(byVoucher.get(a.voucher_id) ?? []), { path, name: a.filename }]);
  }
  files.push({ name: `sie/${safe(co.name)}_${year}.se`, data: Buffer.from(encodeCp437(sie.text)) });
  const lines = await sql<{ ver: string; date: string; account: number; name: string; debit: number; credit: number; text: string }[]>`
    SELECT v.series || v.number AS ver, to_char(v.date,'YYYY-MM-DD') AS date, l.account_number AS account, COALESCE(a.name, '') AS name, l.debit, l.credit, COALESCE(NULLIF(l.description,''), v.description) AS text
    FROM voucher_lines l JOIN vouchers v ON v.id = l.voucher_id LEFT JOIN accounts a ON a.company_id = v.company_id AND a.number = l.account_number
    WHERE v.company_id = ${companyId} AND v.fiscal_year_id = ${fyId} ORDER BY v.series, v.number, l.id`;
  files.push({ name: 'verifikationer.csv', data: Buffer.from('﻿' + ['Verifikation;Datum;Konto;Kontonamn;Debet;Kredit;Text', ...lines.map((l) => [l.ver, l.date, l.account, l.name, (Number(l.debit) / 100).toFixed(2).replace('.', ','), (Number(l.credit) / 100).toFixed(2).replace('.', ','), l.text].map(csv).join(';'))].join('\r\n'), 'utf8') });
  const register = `<!doctype html><html lang="sv"><head><meta charset="utf-8"><title>Verifikationsregister ${esc(co.name)} ${year}</title><style>body{font-family:sans-serif;margin:2rem}td,th{padding:.2rem .5rem;border-bottom:1px solid #ddd;text-align:left;font-size:13px}</style></head><body>
<h1>Verifikationsregister</h1><p>${esc(co.name)}, ${esc(co.orgnr)} · Räkenskapsår ${sie.fy.start_date} – ${sie.fy.end_date} · ${vouchers.length} verifikationer</p>
<table><thead><tr><th>Ver</th><th>Datum</th><th>Beskrivning</th><th>Belopp</th><th>Underlag</th><th>Rättar</th><th>Bokförd av</th><th>Bokförd</th></tr></thead><tbody>
${vouchers.map((v) => `<tr><td>${esc(v.ver)}</td><td>${v.date}</td><td>${esc(v.description)}</td><td>${(Number(v.d) / 100).toFixed(2)}</td><td>${(byVoucher.get(v.id) ?? []).map((f) => `<a href="${esc(f.path)}">${esc(f.name)}</a>`).join('<br>') || '–'}</td><td>${esc(v.corrects ?? '')}</td><td>${esc(v.by ?? '')}</td><td>${v.created}</td></tr>`).join('\n')}
</tbody></table></body></html>`;
  files.push({ name: 'register.html', data: Buffer.from(register, 'utf8') });
  const doc = await systemDocumentation(companyId);
  files.push({ name: 'systemdokumentation.html', data: Buffer.from(`<!doctype html><html lang="sv"><head><meta charset="utf-8"><title>Systemdokumentation ${esc(co.name)}</title><style>body{font-family:sans-serif;margin:2rem;max-width:900px}td,th{padding:.2rem .5rem;border-bottom:1px solid #ddd;text-align:left;font-size:13px}</style></head><body>${sysdocHtml(doc)}</body></html>`, 'utf8') });
  const manifest = {
    company: co.name, orgnr: co.orgnr, fiscal_year: { start: sie.fy.start_date, end: sie.fy.end_date }, created_at: new Date().toISOString(), vouchers: vouchers.length, attachments: atts.length,
    files: files.map((f) => ({ path: f.name, bytes: f.data.length, sha256: createHash('sha256').update(f.data).digest('hex') })),
  };
  const mjson = Buffer.from(JSON.stringify(manifest, null, 2), 'utf8');
  files.push({ name: 'manifest.json', data: mjson });
  files.push({ name: 'LASMIG.txt', data: Buffer.from(`Arkivpaket för ${co.name} (${co.orgnr}), räkenskapsår ${sie.fy.start_date} – ${sie.fy.end_date}.\r\n\r\nregister.html – alla verifikationer med länkar till underlagen\r\nverifikationer.csv – alla konteringsrader\r\nsie/ – bokföringen i SIE 4-format (kan läsas in i andra bokföringsprogram)\r\nunderlag/ – kvitton och fakturor\r\nsystemdokumentation.html – hur bokföringen är organiserad och behandlingshistorik\r\nmanifest.json – kontrollsummor (SHA-256) för varje fil\r\n\r\nSpara paketet i sju år efter räkenskapsårets slut (bokföringslagen 7 kap. 2 §).\r\nKontrollsumma för manifest.json: ${createHash('sha256').update(mjson).digest('hex')}\r\n`, 'utf8') });
  return { name: `arkiv_${safe(co.name)}_${year}.zip`, data: zip(files), manifest };
}
