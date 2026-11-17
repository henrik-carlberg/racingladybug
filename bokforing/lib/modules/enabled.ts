import 'server-only';
import { sql } from '@/lib/db';
import { MODULES } from '@/modules/registry';
import type { ModuleDefinition } from './types';

export async function enabledModules(companyId: number): Promise<ModuleDefinition[]> {
  const rows = await sql<{ module_id: string }[]>`SELECT module_id FROM company_modules WHERE company_id = ${companyId}`;
  const ids = new Set(rows.map((r) => r.module_id));
  return MODULES.filter((m) => ids.has(m.id));
}

export async function isModuleEnabled(companyId: number, moduleId: string): Promise<boolean> {
  const r = await sql`SELECT 1 FROM company_modules WHERE company_id = ${companyId} AND module_id = ${moduleId}`;
  return r.length > 0;
}
