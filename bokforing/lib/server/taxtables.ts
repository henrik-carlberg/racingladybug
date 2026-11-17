import 'server-only';
import { sql } from '@/lib/db';
import type { TaxTableRow } from '@/lib/payroll';

// Skatteverkets öppna data: "Skattetabeller för månadslön" (rowstore-API)
const DATASET = 'https://skatteverket.entryscape.net/rowstore/dataset/88320397-5c32-4c16-ae79-d36d95b17b95/json';

type ApiRow = Record<string, string>;

export async function fetchTaxTable(year: number, table: number): Promise<number> {
  const rows: ApiRow[] = [];
  let url: string | null = `${DATASET}?${new URLSearchParams({ 'år': String(year), tabellnr: String(table), _limit: '500' })}`;
  while (url) {
    const res: Response = await fetch(url, { cache: 'no-store' });
    if (!res.ok) throw new Error(`Skatteverket svarade ${res.status} för tabell ${table}`);
    const data = (await res.json()) as { results: ApiRow[]; next?: string };
    rows.push(...data.results);
    url = data.results.length > 0 ? data.next ?? null : null;
  }
  const parsed = rows
    .filter((r) => r['antal dgr'] === '30B' || r['antal dgr'] === '30%')
    .map((r) => {
      const cols: number[] = [];
      for (let i = 1; i <= 7; i++) {
        const v = r[`kolumn ${i}`];
        if (v === undefined || v === '') break;
        cols.push(Number(v));
      }
      return {
        year, table_no: table, kind: r['antal dgr'] === '30B' ? 'B' : '%',
        income_from: Number(r['inkomst fr.o.m.']), income_to: r['inkomst t.o.m.'] ? Number(r['inkomst t.o.m.']) : 2147483647,
        columns: cols,
      };
    });
  if (parsed.length === 0) throw new Error(`Hittade ingen tabell ${table} för ${year} hos Skatteverket`);
  await sql.begin(async (tx) => {
    await tx`DELETE FROM tax_table_rows WHERE year = ${year} AND table_no = ${table}`;
    for (let i = 0; i < parsed.length; i += 200) {
      const chunk = parsed.slice(i, i + 200);
      await tx`INSERT INTO tax_table_rows (year, table_no, income_from, income_to, kind, columns)
        SELECT year, table_no, income_from, income_to, kind, ARRAY(SELECT jsonb_array_elements_text(columns)::int)
        FROM jsonb_to_recordset(${tx.json(chunk as never)})
          AS x(year int, table_no int, income_from int, income_to int, kind text, columns jsonb)`;
    }
  });
  return parsed.length;
}

export async function loadTaxRows(year: number, table: number): Promise<TaxTableRow[]> {
  return sql<TaxTableRow[]>`
    SELECT income_from, income_to, kind, columns FROM tax_table_rows WHERE year = ${year} AND table_no = ${table} ORDER BY kind, income_from`;
}
