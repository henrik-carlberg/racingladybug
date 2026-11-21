import 'server-only';
import { sql } from '@/lib/db';
import { NotFoundError, ValidationError } from '@/lib/errors';
import { auditBy } from '@/lib/server/audit';
import { accountSums } from '@/lib/server/ledger';
import { lastDay, addMonths } from '@/lib/assets';
import { parseAmount } from '@/lib/money';
import { ARRIVAL_ACCOUNTS, DISPATCH_ACCOUNTS, deviation, file, obligation, validate, type Flow, type Line } from '@/lib/intrastat';
import type { Actor } from './actor';
import { str } from './input';

const checkPeriod = (p: string) => { if (!/^\d{4}-(0[1-9]|1[0-2])$/.test(p)) throw new ValidationError('Ange månad som ÅÅÅÅ-MM'); return p; };
async function flows(companyId: number, from: string, to: string) {
  let dispatch = 0, arrival = 0;
  for (const [n, v] of await accountSums(companyId, from, to)) {
    if (DISPATCH_ACCOUNTS.includes(n)) dispatch -= Number(v);
    if (ARRIVAL_ACCOUNTS.includes(n)) arrival += Number(v);
  }
  return { dispatch, arrival };
}

export async function overview(companyId: number, period: string) {
  checkPeriod(period);
  const month = await flows(companyId, `${period}-01`, lastDay(period));
  const rolling = await flows(companyId, `${addMonths(period, -11)}-01`, lastDay(period));
  const lines = await sql<(Line & { id: number })[]>`SELECT id, flow, kn, country, origin, txn, value::float8 AS value, mass, supp FROM intrastat_lines
    WHERE company_id = ${companyId} AND period = ${period} ORDER BY flow, kn, id`;
  const per = (f: Flow) => {
    const declared = lines.filter((l) => l.flow === f).reduce((s, l) => s + l.value, 0);
    return { ledger: month[f], rolling: rolling[f], declared, deviation: deviation(declared, month[f]), ...obligation(f, rolling[f]) };
  };
  return { period, lines, arrival: per('arrival'), dispatch: per('dispatch') };
}

export async function addLine(actor: Actor, input: Record<string, unknown>) {
  const period = checkPeriod(str(input, 'period'));
  const l: Line = {
    flow: str(input, 'flow') === 'arrival' ? 'arrival' : 'dispatch', kn: str(input, 'kn').replace(/\s/g, ''), country: str(input, 'country').toUpperCase(), origin: str(input, 'origin').toUpperCase(),
    txn: str(input, 'txn') || '11', value: parseAmount(str(input, 'value')) ?? 0, mass: Number(str(input, 'mass') || 'NaN'), supp: str(input, 'supp') ? Number(str(input, 'supp')) : null,
  };
  if (l.supp != null && !(Number.isInteger(l.supp) && l.supp >= 0)) throw new ValidationError('Kvantiteten anges som ett heltal');
  const err = validate(l);
  if (err) throw new ValidationError(err);
  await sql`INSERT INTO intrastat_lines ${sql({ company_id: actor.companyId, period, ...l, created_by: actor.userId })}`;
  await auditBy(sql, actor, 'intrastat_line', 'company', actor.companyId, { period, flow: l.flow });
}

export async function deleteLine(actor: Actor, id: number) {
  const r = await sql`DELETE FROM intrastat_lines WHERE id = ${id} AND company_id = ${actor.companyId}`;
  if (!r.count) throw new NotFoundError('Raden');
}

export async function exportFile(companyId: number, period: string) {
  checkPeriod(period);
  const lines = await sql<Line[]>`SELECT flow, kn, country, origin, txn, value::float8 AS value, mass, supp FROM intrastat_lines WHERE company_id = ${companyId} AND period = ${period} ORDER BY flow, kn, id`;
  return file(period, lines);
}
