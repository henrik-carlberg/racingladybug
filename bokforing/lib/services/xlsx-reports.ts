import 'server-only';
import { sql } from '@/lib/db';
import { kronor, type Cell, type Sheet } from '@/lib/xlsx';
import { BALANCE_GROUPS } from '@/lib/statements';
import { statements, type Compare } from './statements';

/** Resultat- och balansräkning som två blad */
export async function rrbrSheets(companyId: number, o: { fy?: string; from?: string; to?: string; compare?: Compare }): Promise<{ sheets: Sheet[]; name: string } | null> {
  const s = await statements(companyId, o);
  if (!s) return null;
  const cmp = s.compare !== 'none';
  const rr: Cell[][] = [['Konto', 'Namn', 'Utfall', ...(cmp ? [s.compare === 'fjol' ? 'Förra året' : 'Budget', 'Skillnad'] : [])]];
  for (const g of s.income.groups) {
    rr.push([{ s: g.label, bold: true }, null, { v: g.total / 100, fmt: 'kr' }, ...(cmp ? [kronor(g.compareTotal ?? 0), kronor(g.total - (g.compareTotal ?? 0))] : [])]);
    for (const r of g.rows) rr.push([{ v: r.account, fmt: 'int' }, r.name, kronor(r.amount), ...(cmp ? [kronor(r.compare ?? 0), kronor(r.amount - (r.compare ?? 0))] : [])]);
  }
  rr.push([{ s: 'Beräknat resultat', bold: true }, null, kronor(s.income.result), ...(cmp ? [kronor(s.income.compareResult ?? 0), kronor(s.income.result - (s.income.compareResult ?? 0))] : [])]);
  const br: Cell[][] = [['Konto', 'Namn', 'Ingående balans', 'Utgående balans']];
  for (const [label, a, b] of BALANCE_GROUPS) {
    const accs = [...new Set([...s.ib.keys(), ...s.ub.keys()])].filter((n) => n >= a && n <= b && ((s.ib.get(n) ?? 0) || (s.ub.get(n) ?? 0))).sort((x, y) => x - y);
    if (!accs.length) continue;
    const sign = a < 2000 ? 1 : -1;
    br.push([{ s: label, bold: true }]);
    for (const n of accs) br.push([{ v: n, fmt: 'int' }, s.names.get(n) ?? '', kronor(sign * (s.ib.get(n) ?? 0)), kronor(sign * (s.ub.get(n) ?? 0))]);
  }
  const assets = [...s.ub].filter(([n]) => n >= 1000 && n <= 1999).reduce((x, [, v]) => x + v, 0);
  br.push([{ s: 'Summa tillgångar', bold: true }, null, null, kronor(assets)]);
  return { name: `resultat-balans-${s.from}-${s.to}`, sheets: [
    { name: 'Resultaträkning', rows: rr, header: true, widths: [10, 40, 16, 16, 16] },
    { name: 'Balansräkning', rows: br, header: true, widths: [10, 40, 18, 18] },
  ] };
}

export async function listSheet(companyId: number, kind: string, o: { from?: string; to?: string }): Promise<{ sheets: Sheet[]; name: string } | null> {
  const from = o.from || '1900-01-01', to = o.to || '2999-12-31';
  if (kind === 'kundfakturor') {
    const rows = await sql<{ number: number | null; customer: string; date: string; due: string; total: number; paid: number; status: string; ocr: string | null }[]>`
      SELECT i.invoice_number AS number, c.name AS customer, to_char(i.invoice_date,'YYYY-MM-DD') AS date, to_char(i.due_date,'YYYY-MM-DD') AS due, i.total, i.paid_amount AS paid, i.status, i.ocr
      FROM invoices i JOIN customers c ON c.id = i.customer_id WHERE i.company_id = ${companyId} AND i.invoice_date BETWEEN ${from} AND ${to} ORDER BY i.invoice_number NULLS FIRST`;
    return { name: 'kundfakturor', sheets: [{ name: 'Kundfakturor', header: true, rows: [['Nr', 'Kund', 'Datum', 'Förfaller', 'Belopp', 'Betalt', 'Kvar', 'Status', 'OCR'],
      ...rows.map((r) => [r.number ? { v: r.number, fmt: 'int' as const } : 'Utkast', r.customer, r.date, r.due, kronor(Number(r.total)), kronor(Number(r.paid)), kronor(Number(r.total) - Number(r.paid)), r.status, r.ocr ?? ''])] }] };
  }
  if (kind === 'leverantorsfakturor') {
    const rows = await sql<{ supplier: string; number: string; date: string; due: string; total: number; vat: number; status: string }[]>`
      SELECT s.name AS supplier, si.invoice_number AS number, to_char(si.invoice_date,'YYYY-MM-DD') AS date, to_char(si.due_date,'YYYY-MM-DD') AS due, si.total, si.vat, si.status
      FROM supplier_invoices si JOIN suppliers s ON s.id = si.supplier_id WHERE si.company_id = ${companyId} AND si.invoice_date BETWEEN ${from} AND ${to} ORDER BY si.invoice_date, si.id`;
    return { name: 'leverantorsfakturor', sheets: [{ name: 'Leverantörsfakturor', header: true, rows: [['Leverantör', 'Fakturanr', 'Datum', 'Förfaller', 'Belopp', 'Moms', 'Status'],
      ...rows.map((r) => [r.supplier, r.number, r.date, r.due, kronor(Number(r.total)), kronor(Number(r.vat)), r.status])] }] };
  }
  if (kind === 'verifikationer') {
    const rows = await sql<{ ver: string; date: string; description: string; account: number; name: string; debit: number; credit: number }[]>`
      SELECT v.series || v.number AS ver, to_char(v.date,'YYYY-MM-DD') AS date, v.description, l.account_number AS account, COALESCE(a.name, '') AS name, l.debit, l.credit
      FROM vouchers v JOIN voucher_lines l ON l.voucher_id = v.id LEFT JOIN accounts a ON a.company_id = v.company_id AND a.number = l.account_number
      WHERE v.company_id = ${companyId} AND v.date BETWEEN ${from} AND ${to} ORDER BY v.date, v.series, v.number, l.id LIMIT 200000`;
    return { name: 'verifikationer', sheets: [{ name: 'Verifikationer', header: true, rows: [['Ver', 'Datum', 'Beskrivning', 'Konto', 'Kontonamn', 'Debet', 'Kredit'],
      ...rows.map((r) => [r.ver, r.date, r.description, { v: r.account, fmt: 'int' as const }, r.name, kronor(Number(r.debit)), kronor(Number(r.credit))])] }] };
  }
  if (kind === 'kunder') {
    const rows = await sql<{ name: string; orgnr: string; email: string; city: string }[]>`SELECT name, orgnr, email, city FROM customers WHERE company_id = ${companyId} ORDER BY name`;
    return { name: 'kunder', sheets: [{ name: 'Kunder', header: true, rows: [['Namn', 'Organisationsnummer', 'E-post', 'Ort'], ...rows.map((r) => [r.name, r.orgnr, r.email, r.city])] }] };
  }
  return null;
}
