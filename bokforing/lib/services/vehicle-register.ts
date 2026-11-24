import 'server-only';
import { sql } from '@/lib/db';
import { ConflictError, NotFoundError, ValidationError } from '@/lib/errors';
import { auditBy } from '@/lib/server/audit';
import { createVoucher } from '@/lib/server/ledger';
import { fromSigned } from '@/lib/ledger-lines';
import { parseAmount } from '@/lib/money';
import { today } from '@/lib/format';
import { ACCOUNT_NAMES, EVENTS, costPerMil, eventLines, hasVat, reminders, tyreReminder, type EventKind } from '@/lib/vehicle-register';
import type { Actor } from './actor';
import { date, optInt, str } from './input';

type V = { id: number; reg_no: string; name: string; model: string; model_year: number | null; fuel: string; inspection_due: string | null; insurance_until: string | null; service_due_date: string | null; service_due_km: number | null; asset_id: number | null; asset: string | null };

export async function overview(companyId: number) {
  const t = today(), year = t.slice(0, 4);
  const vehicles = await sql<V[]>`SELECT v.id, v.reg_no, v.name, COALESCE(d.model, '') AS model, d.model_year, COALESCE(d.fuel, '') AS fuel, to_char(d.inspection_due,'YYYY-MM-DD') AS inspection_due, to_char(d.insurance_until,'YYYY-MM-DD') AS insurance_until,
      to_char(d.service_due_date,'YYYY-MM-DD') AS service_due_date, d.service_due_km, d.asset_id, a.name AS asset
    FROM vehicles v LEFT JOIN vehicle_details d ON d.vehicle_id = v.id LEFT JOIN assets a ON a.id = d.asset_id WHERE v.company_id = ${companyId} AND v.owner = 'company' AND v.active ORDER BY v.reg_no`;
  const ids = vehicles.map((v) => v.id);
  const events = ids.length ? await sql<{ id: number; vehicle_id: number; date: string; kind: EventKind; amount: number; vat: number; odometer: number | null; note: string; voucher_id: number | null }[]>`
    SELECT id, vehicle_id, to_char(date,'YYYY-MM-DD') AS date, kind, amount::float8 AS amount, vat::float8 AS vat, odometer, note, voucher_id FROM vehicle_events WHERE company_id = ${companyId} AND vehicle_id IN ${sql(ids)} ORDER BY date DESC, id DESC` : [];
  const km = ids.length ? await sql<{ vehicle_id: number; km: number; odo: number | null }[]>`SELECT vehicle_id, COALESCE(SUM(km) FILTER (WHERE date >= ${`${year}-01-01`}::date), 0)::float8 AS km, max(odo_end) AS odo
    FROM vehicle_trips WHERE company_id = ${companyId} AND vehicle_id IN ${sql(ids)} GROUP BY vehicle_id` : [];
  const dep = await sql<{ asset_id: number; amount: number }[]>`SELECT d.asset_id, SUM(d.amount)::float8 AS amount FROM asset_depreciations d JOIN assets a ON a.id = d.asset_id WHERE a.company_id = ${companyId} AND d.period LIKE ${`${year}-%`} GROUP BY d.asset_id`;
  const assets = await sql<{ id: number; name: string }[]>`SELECT id, name FROM assets WHERE company_id = ${companyId} AND status = 'active' ORDER BY name LIMIT 500`;
  return {
    tyres: vehicles.length ? tyreReminder(t) : null, assets, year,
    vehicles: vehicles.map((v) => {
      const own = events.filter((e) => e.vehicle_id === v.id);
      const k = km.find((x) => x.vehicle_id === v.id);
      const odometer = Math.max(k?.odo ?? 0, ...own.map((e) => e.odometer ?? 0)) || null;
      const costs = own.filter((e) => e.date.startsWith(year)).reduce((s, e) => s + e.amount, 0);
      const depreciation = v.asset_id ? dep.find((d) => d.asset_id === v.asset_id)?.amount ?? 0 : 0;
      return { ...v, events: own.slice(0, 20), odometer, km: k?.km ?? 0, costs, depreciation, perMil: costPerMil(costs + depreciation, k?.km ?? 0), reminders: reminders(v, odometer, t) };
    }),
  };
}

const ownVehicle = async (actor: Actor, id: number) => {
  const [v] = await sql<{ reg_no: string }[]>`SELECT reg_no FROM vehicles WHERE id = ${id} AND company_id = ${actor.companyId} AND owner = 'company'`;
  if (!v) throw new NotFoundError('Fordonet');
  return v;
};

/** Nytt fordon (finns det redan i körjournalen kompletteras det med uppgifterna) */
export async function addVehicle(actor: Actor, input: Record<string, unknown>) {
  const reg = str(input, 'reg_no', { required: true, label: 'Registreringsnummer', max: 12 }).toUpperCase().replace(/\s/g, '');
  const assetId = optInt(input, 'asset_id');
  if (assetId) { const [a] = await sql`SELECT 1 FROM assets WHERE id = ${assetId} AND company_id = ${actor.companyId}`; if (!a) throw new NotFoundError('Inventariet'); }
  return sql.begin(async (tx) => {
    const [ex] = await tx<{ id: number; owner: string }[]>`SELECT id, owner FROM vehicles WHERE company_id = ${actor.companyId} AND reg_no = ${reg}`;
    if (ex && ex.owner !== 'company') throw new ConflictError('Fordonet finns i körjournalen som privat bil');
    const id = ex?.id ?? (await tx<{ id: number }[]>`INSERT INTO vehicles ${tx({ company_id: actor.companyId, reg_no: reg, name: str(input, 'name', { max: 100 }), owner: 'company' })} RETURNING id`)[0].id;
    const details = { model: str(input, 'model', { max: 100 }), model_year: optInt(input, 'model_year'), fuel: str(input, 'fuel', { max: 40 }), inspection_due: date(input, 'inspection_due', 'Besiktning', false) || null,
      insurance_until: date(input, 'insurance_until', 'Försäkring till', false) || null, service_due_date: date(input, 'service_due_date', 'Service senast', false) || null, service_due_km: optInt(input, 'service_due_km'), asset_id: assetId ?? null };
    await tx`INSERT INTO vehicle_details ${tx({ vehicle_id: id, company_id: actor.companyId, ...details })}
      ON CONFLICT (vehicle_id) DO UPDATE SET model = EXCLUDED.model, model_year = EXCLUDED.model_year, fuel = EXCLUDED.fuel, inspection_due = EXCLUDED.inspection_due, insurance_until = EXCLUDED.insurance_until,
        service_due_date = EXCLUDED.service_due_date, service_due_km = EXCLUDED.service_due_km, asset_id = EXCLUDED.asset_id`;
    await auditBy(tx, actor, 'vehicle_register', 'vehicle', id, { reg });
    return { id, existed: !!ex };
  });
}

/** Händelse med kostnad: bokförs på 561x med ingående moms; besiktning, service och försäkring flyttar fram nästa datum */
export async function addEvent(actor: Actor, vehicleId: number, input: Record<string, unknown>) {
  const v = await ownVehicle(actor, vehicleId);
  const kind = String(input.kind) as EventKind;
  if (!Object.prototype.hasOwnProperty.call(EVENTS, kind)) throw new ValidationError('Välj typ av händelse');
  const d = date(input, 'date', 'Datum');
  const amount = String(input.amount ?? '').trim() ? parseAmount(String(input.amount)) : 0;
  const vat = hasVat(kind) && String(input.vat ?? '').trim() ? parseAmount(String(input.vat)) : 0;
  if (amount == null || amount < 0 || vat == null || vat < 0) throw new ValidationError('Ogiltigt belopp');
  if (vat > amount) throw new ValidationError('Momsen kan inte vara större än beloppet exkl. moms');
  const odometer = optInt(input, 'odometer');
  if (odometer != null && (odometer < 0 || odometer > 10_000_000)) throw new ValidationError('Ogiltig mätarställning');
  const next = date(input, 'next_date', 'Nästa datum', false) || null, nextKm = optInt(input, 'next_km');
  return sql.begin(async (tx) => {
    let voucherId: number | null = null;
    if (amount) {
      const acc = EVENTS[kind].account;
      await tx`INSERT INTO accounts (company_id, number, name) VALUES (${actor.companyId}, ${acc}, ${ACCOUNT_NAMES[acc]}) ON CONFLICT DO NOTHING`;
      voucherId = (await createVoucher(tx, { actor, date: d, description: `${EVENTS[kind].label} ${v.reg_no}${input.note ? ` – ${String(input.note).slice(0, 80)}` : ''}`, lines: fromSigned(eventLines(kind, amount, vat)), sourceType: 'vehicle_event' })).id;
    }
    await tx`INSERT INTO vehicle_events ${tx({ company_id: actor.companyId, vehicle_id: vehicleId, date: d, kind, amount, vat, odometer: odometer ?? null, note: str(input, 'note', { max: 200 }), voucher_id: voucherId, created_by: actor.userId })}`;
    await tx`INSERT INTO vehicle_details (vehicle_id, company_id) VALUES (${vehicleId}, ${actor.companyId}) ON CONFLICT DO NOTHING`;
    if (kind === 'inspection' && next) await tx`UPDATE vehicle_details SET inspection_due = ${next} WHERE vehicle_id = ${vehicleId}`;
    if (kind === 'insurance' && next) await tx`UPDATE vehicle_details SET insurance_until = ${next} WHERE vehicle_id = ${vehicleId}`;
    if (kind === 'service' && (next || nextKm != null)) await tx`UPDATE vehicle_details SET service_due_date = ${next}, service_due_km = ${nextKm ?? null} WHERE vehicle_id = ${vehicleId}`;
    return { booked: amount + vat, account: amount ? EVENTS[kind].account : null };
  });
}
