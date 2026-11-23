import 'server-only';
import { sql } from '@/lib/db';
import { ConflictError, NotFoundError, ValidationError } from '@/lib/errors';
import { auditBy } from '@/lib/server/audit';
import { createVoucher } from '@/lib/server/ledger';
import { fromSigned } from '@/lib/ledger-lines';
import { parseAmount } from '@/lib/money';
import { CAR_COSTS, OWN_CAR_COST, OWN_CAR_RATE, OWNER_DEPOSIT, OWNER_WITHDRAWAL, PRIVATE_USE_INCOME, costPerMil, deductionLines, perMil, privateUseLines, summary, tripKm } from '@/lib/vehicle-log';
import type { Actor } from './actor';
import { date, int, optInt, str } from './input';

const NAMES: Record<number, string> = { [OWN_CAR_COST]: 'Skattefria bilersättningar', [OWNER_DEPOSIT]: 'Övriga egna insättningar', [OWNER_WITHDRAWAL]: 'Övriga egna uttag', [PRIVATE_USE_INCOME]: 'Övriga ersättningar och intäkter' };

export async function overview(companyId: number, year: number) {
  const [c] = await sql<{ company_type: string }[]>`SELECT company_type FROM companies WHERE id = ${companyId}`;
  const vehicles = await sql<{ id: number; reg_no: string; name: string; owner: 'company' | 'private'; last_odo: number | null }[]>`SELECT v.id, v.reg_no, v.name, v.owner,
      (SELECT max(odo_end) FROM vehicle_trips t WHERE t.vehicle_id = v.id) AS last_odo FROM vehicles v WHERE v.company_id = ${companyId} AND v.active ORDER BY v.reg_no`;
  const trips = await sql<{ id: number; vehicle_id: number; date: string; from_place: string; to_place: string; purpose: string; km: number; odo_start: number | null; odo_end: number | null; private: boolean; customer: string | null }[]>`
    SELECT t.id, t.vehicle_id, to_char(t.date,'YYYY-MM-DD') AS date, t.from_place, t.to_place, t.purpose, t.km::float8 AS km, t.odo_start, t.odo_end, t.private, cu.name AS customer
    FROM vehicle_trips t LEFT JOIN customers cu ON cu.id = t.customer_id WHERE t.company_id = ${companyId} AND extract(year FROM t.date) = ${year} ORDER BY t.date DESC, t.id DESC`;
  const settlements = await sql<{ vehicle_id: number; kind: string; km: number; rate: number; amount: number; voucher_id: number | null }[]>`SELECT vehicle_id, kind, km::float8 AS km, rate::float8 AS rate, amount::float8 AS amount, voucher_id
    FROM vehicle_settlements WHERE company_id = ${companyId} AND year = ${year}`;
  const [{ costs }] = await sql<{ costs: number }[]>`SELECT COALESCE(SUM(l.debit - l.credit), 0)::float8 AS costs FROM voucher_lines l JOIN vouchers v ON v.id = l.voucher_id
    WHERE v.company_id = ${companyId} AND l.account_number BETWEEN ${CAR_COSTS[0]} AND ${CAR_COSTS[1]} AND extract(year FROM v.date) = ${year}`;
  const customers = await sql<{ id: number; name: string }[]>`SELECT id, name FROM customers WHERE company_id = ${companyId} ORDER BY name LIMIT 500`;
  const companyKm = trips.filter((t) => vehicles.find((v) => v.id === t.vehicle_id)?.owner === 'company').reduce((s, t) => s + t.km, 0);
  const ef = c.company_type === 'EF';
  return {
    ef, customers, costs, costPerMil: costPerMil(costs, companyKm),
    vehicles: vehicles.map((v) => {
      const own = trips.filter((t) => t.vehicle_id === v.id);
      const s = summary(own);
      const settled = settlements.find((x) => x.vehicle_id === v.id);
      const proposal = !ef ? null : v.owner === 'private' ? { kind: 'mileage_deduction' as const, km: s.business, rate: OWN_CAR_RATE, amount: perMil(s.business, OWN_CAR_RATE) }
        : { kind: 'private_use' as const, km: s.private, rate: costPerMil(costs, companyKm), amount: perMil(s.private, costPerMil(costs, companyKm)) };
      return { ...v, trips: own, summary: s, settled: settled ?? null, proposal };
    }),
  };
}

export async function addVehicle(actor: Actor, input: Record<string, unknown>) {
  const owner = input.owner === 'private' ? 'private' : 'company';
  const reg = str(input, 'reg_no', { required: true, label: 'Registreringsnummer', max: 12 }).toUpperCase().replace(/\s/g, '');
  try {
    const [v] = await sql<{ id: number }[]>`INSERT INTO vehicles ${sql({ company_id: actor.companyId, reg_no: reg, name: str(input, 'name', { max: 100 }), owner })} RETURNING id`;
    await auditBy(sql, actor, 'vehicle', 'vehicle', v.id, { owner });
    return v.id;
  } catch (e) { if (String((e as Error).message).includes('vehicles_company_id_reg_no_key')) throw new ConflictError('Fordonet finns redan'); throw e; }
}

export async function addTrip(actor: Actor, input: Record<string, unknown>) {
  const vehicleId = int(input, 'vehicle_id', 'Fordon');
  const [v] = await sql`SELECT 1 FROM vehicles WHERE id = ${vehicleId} AND company_id = ${actor.companyId}`;
  if (!v) throw new NotFoundError('Fordonet');
  const d = date(input, 'date', 'Datum');
  const odoStart = optInt(input, 'odo_start', 'Mätarställning vid avfärd'), odoEnd = optInt(input, 'odo_end', 'Mätarställning vid ankomst');
  const kmIn = Number(String(input.km ?? '').replace(',', '.')) || null;
  let km: number;
  try { km = tripKm({ km: kmIn, odoStart, odoEnd }); } catch (e) { throw new ValidationError((e as Error).message); }
  const priv = input.private === 'on' || input.private === true;
  const purpose = str(input, 'purpose', { required: !priv, label: 'Ärende', max: 200 });
  const [done] = await sql`SELECT 1 FROM vehicle_settlements WHERE vehicle_id = ${vehicleId} AND year = ${Number(d.slice(0, 4))}`;
  if (done) throw new ConflictError('Året är redan avräknat för fordonet');
  const customerId = optInt(input, 'customer_id', 'Kund');
  if (customerId) { const [cu] = await sql`SELECT 1 FROM customers WHERE id = ${customerId} AND company_id = ${actor.companyId}`; if (!cu) throw new NotFoundError('Kunden'); }
  await sql`INSERT INTO vehicle_trips ${sql({ company_id: actor.companyId, vehicle_id: vehicleId, date: d, from_place: str(input, 'from_place', { max: 100 }), to_place: str(input, 'to_place', { max: 100 }), purpose,
    km, odo_start: odoStart, odo_end: odoEnd, private: priv, customer_id: priv ? null : customerId, created_by: actor.userId })}`;
  return km;
}

/** Årsavräkning i enskild firma: avdrag för egen bil i tjänsten (25 kr/mil) eller uttag för privat körning med firmans bil (självkostnad per mil) */
export async function settle(actor: Actor, vehicleId: number, year: number, input: Record<string, unknown>) {
  return sql.begin(async (tx) => {
    await tx`SELECT id FROM vehicles WHERE id = ${vehicleId} AND company_id = ${actor.companyId} FOR UPDATE`;
    const o = await overview(actor.companyId, year);
    const v = o.vehicles.find((x) => x.id === vehicleId);
    if (!v) throw new NotFoundError('Fordonet');
    if (!o.ef) throw new ValidationError('Årsavräkningen gäller enskild firma – i aktiebolag ersätts egen bil via utlägg och privat körning med företagets bil är en förmån');
    if (v.settled) throw new ConflictError('Året är redan avräknat för fordonet');
    const p = v.proposal!;
    let rate = p.rate;
    if (p.kind === 'private_use' && String(input.rate ?? '').trim()) {
      const r = parseAmount(String(input.rate));
      if (r == null || r <= 0) throw new ValidationError('Ange kostnaden per mil i kronor');
      rate = r;
    }
    const amount = perMil(p.km, rate);
    if (!amount) throw new ValidationError(p.kind === 'private_use' ? 'Det finns ingen privat körning eller inga bilkostnader att räkna på' : 'Det finns inga tjänsteresor att göra avdrag för');
    const accounts = p.kind === 'private_use' ? [OWNER_WITHDRAWAL, PRIVATE_USE_INCOME] : [OWN_CAR_COST, OWNER_DEPOSIT];
    for (const n of accounts) await tx`INSERT INTO accounts (company_id, number, name) VALUES (${actor.companyId}, ${n}, ${NAMES[n]}) ON CONFLICT DO NOTHING`;
    const desc = p.kind === 'private_use' ? `Privat körning ${year} med ${v.reg_no}: ${p.km} km à ${(rate / 100).toLocaleString('sv-SE')} kr/mil` : `Egen bil i tjänsten ${year}, ${v.reg_no}: ${p.km} km à ${(rate / 100).toLocaleString('sv-SE')} kr/mil`;
    const voucher = await createVoucher(tx, { actor, date: `${year}-12-31`, description: desc, lines: fromSigned(p.kind === 'private_use' ? privateUseLines(amount) : deductionLines(amount)), sourceType: 'vehicle_log', sourceId: vehicleId });
    await tx`INSERT INTO vehicle_settlements ${tx({ company_id: actor.companyId, vehicle_id: vehicleId, year, kind: p.kind, km: p.km, rate, amount, voucher_id: voucher.id, created_by: actor.userId })}`;
    await auditBy(tx, actor, 'vehicle_settled', 'vehicle', vehicleId, { year, kind: p.kind, amount });
    return { kind: p.kind, amount, km: p.km };
  });
}
