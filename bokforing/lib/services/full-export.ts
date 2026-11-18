import 'server-only';
import { sql } from '@/lib/db';

// Kolumner som aldrig följer med (hemligheter, inloggningsuppgifter) – binära filer (bytea) lämnas ut som storlek
const SECRET = /(secret|token|password|hash|_enc$|private_key|totp|backup_codes|session)/i;
const SKIP_TABLES = new Set(['sessions', 'rate_limits', 'error_log', 'cron_runs', 'mfa_challenges', 'bank_auth_states', 'idempotency_keys', 'sie_imports']);

/** All bolagets data som JSON: tabeller med company_id och deras underordnade rader (t.ex. verifikationsrader) */
export async function exportCompany(companyId: number) {
  const cols = await sql<{ table_name: string; column_name: string; data_type: string }[]>`
    SELECT table_name, column_name, data_type FROM information_schema.columns WHERE table_schema = 'public' ORDER BY table_name, ordinal_position`;
  const byTable = new Map<string, { name: string; type: string }[]>();
  for (const c of cols) (byTable.get(c.table_name) ?? byTable.set(c.table_name, []).get(c.table_name)!).push({ name: c.column_name, type: c.data_type });
  const fks = await sql<{ child: string; col: string; parent: string }[]>`
    SELECT tc.table_name AS child, kcu.column_name AS col, ccu.table_name AS parent
    FROM information_schema.table_constraints tc JOIN information_schema.key_column_usage kcu ON kcu.constraint_name = tc.constraint_name
    JOIN information_schema.constraint_column_usage ccu ON ccu.constraint_name = tc.constraint_name
    WHERE tc.constraint_type = 'FOREIGN KEY' AND tc.table_schema = 'public'`;
  const direct = [...byTable.keys()].filter((t) => !SKIP_TABLES.has(t) && t !== 'companies' && byTable.get(t)!.some((c) => c.name === 'company_id'));
  const children = fks.filter((f) => !SKIP_TABLES.has(f.child) && !byTable.get(f.child)!.some((c) => c.name === 'company_id') && direct.includes(f.parent));
  const select = (t: string) => {
    const list = byTable.get(t)!.filter((c) => !SECRET.test(c.name));
    return sql.unsafe(list.map((c) => (c.type === 'bytea' ? `octet_length("${c.name}") AS "${c.name}_bytes"` : `"${c.name}"`)).join(', '));
  };
  const out: Record<string, unknown> = { exported_at: new Date().toISOString(), format: 'bokforing-export-1' };
  const [co] = await sql`SELECT ${select('companies')} FROM companies WHERE id = ${companyId}`;
  out.company = co;
  const tables: Record<string, unknown[]> = {};
  for (const t of direct.sort()) tables[t] = [...await sql`SELECT ${select(t)} FROM ${sql(t)} WHERE company_id = ${companyId} ORDER BY 1`];
  for (const f of children) {
    if (tables[f.child]) continue;
    tables[f.child] = [...await sql`SELECT ${select(f.child)} FROM ${sql(f.child)} WHERE ${sql(f.col)} IN (SELECT id FROM ${sql(f.parent)} WHERE company_id = ${companyId}) ORDER BY 1`];
  }
  out.tables = tables;
  out.note = 'Filer (underlag, dokument) ingår som storlek i byte. Ladda ner dem från appen eller exportera bokföringen som SIE. Hemligheter och inloggningsuppgifter ingår inte.';
  return out;
}
