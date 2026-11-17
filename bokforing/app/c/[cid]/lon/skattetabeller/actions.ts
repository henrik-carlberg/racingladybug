'use server';
import { attempt, done, str } from '@/lib/server/action';
import { requireCompany } from '@/lib/server/auth';
import { fetchTaxTable } from '@/lib/server/taxtables';
import { audit } from '@/lib/server/audit';
import { sql } from '@/lib/db';

export async function importTables(cid: number, fd: FormData) {
  const { company, user } = await requireCompany(cid);
  const back = `/c/${cid}/lon/skattetabeller`;
  let count = 0;
  await attempt(back, async () => {
    const year = Number(str(fd, 'year'));
    if (!(year >= 2020 && year <= 2100)) throw new Error('Ogiltigt år');
    const tables = new Set<number>();
    for (const part of str(fd, 'tables').split(/[,\s]+/).filter(Boolean)) {
      const m = part.match(/^(\d+)(?:-(\d+))?$/);
      if (!m) throw new Error(`Ogiltigt tabellnummer: ${part}`);
      for (let t = Number(m[1]); t <= Number(m[2] ?? m[1]); t++) tables.add(t);
    }
    if (tables.size === 0 || tables.size > 20) throw new Error('Ange 1–20 tabeller, t.ex. 32 eller 29-35');
    for (const t of tables) { await fetchTaxTable(year, t); count++; }
    await audit(sql, { companyId: company.id, userId: user.id, action: 'import', entity: 'tax_table', details: { year, tables: [...tables] } });
  });
  done(back, `${count} skattetabell(er) hämtade från Skatteverket`);
}
