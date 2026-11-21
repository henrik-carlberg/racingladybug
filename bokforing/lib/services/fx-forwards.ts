import 'server-only';
import { sql, type Tx } from '@/lib/db';
import { ConflictError, NotFoundError, ValidationError } from '@/lib/errors';
import { auditBy } from '@/lib/server/audit';
import { createVoucher } from '@/lib/server/ledger';
import { fromSigned } from '@/lib/ledger-lines';
import { today } from '@/lib/format';
import { ACCRUED, FIN_COST, FX_GAIN, FX_LOSS, reserveLines, settleLines, value, yearEnd, type Direction } from '@/lib/fx-forwards';
import type { Actor } from './actor';
import { date, str } from './input';

const num = (v: unknown, label: string) => { const n = Number(String(v ?? '').replace(/\s/g, '').replace(',', '.')); if (!(n > 0) || !Number.isFinite(n)) throw new ValidationError(`Ange ${label}`); return n; };
const NAMES: Record<number, string> = { [FX_GAIN]: 'Valutakursvinster på fordringar och skulder av rörelsekaraktär', [FX_LOSS]: 'Valutakursförluster på fordringar och skulder av rörelsekaraktär', [FIN_COST]: 'Övriga finansiella kostnader', [ACCRUED]: 'Övriga upplupna kostnader och förutbetalda intäkter' };
async function ensure(tx: Tx, companyId: number) { for (const [n, name] of Object.entries(NAMES)) await tx`INSERT INTO accounts (company_id, number, name) VALUES (${companyId}, ${Number(n)}, ${name}) ON CONFLICT DO NOTHING`; }

type Fwd = { id: number; currency: string; direction: Direction; amount: number; forward_rate: number; trade_date: string; maturity: string; hedged: string; reserved: number; status: string; spot_rate: number | null; result: number | null };
const COLS = sql`id, currency, direction, amount::float8 AS amount, forward_rate::float8 AS forward_rate, to_char(trade_date,'YYYY-MM-DD') AS trade_date, to_char(maturity,'YYYY-MM-DD') AS maturity, hedged, reserved::float8 AS reserved, status, spot_rate::float8 AS spot_rate, result::float8 AS result`;

export async function list(companyId: number) {
  return sql<Fwd[]>`SELECT ${COLS} FROM fx_forwards WHERE company_id = ${companyId} ORDER BY status, maturity`;
}

export async function addForward(actor: Actor, input: Record<string, unknown>) {
  const currency = str(input, 'currency').toUpperCase();
  if (!/^[A-Z]{3}$/.test(currency) || currency === 'SEK') throw new ValidationError('Ange valutakod, t.ex. EUR');
  const trade = date(input, 'trade_date', 'Affärsdag'), maturity = date(input, 'maturity', 'Förfallodag');
  if (maturity <= trade) throw new ValidationError('Förfallodagen ska ligga efter affärsdagen');
  const [r] = await sql<{ id: number }[]>`INSERT INTO fx_forwards ${sql({ company_id: actor.companyId, currency, direction: str(input, 'direction') === 'buy' ? 'buy' : 'sell', amount: num(input.amount, 'belopp i valutan'),
    forward_rate: num(input.forward_rate, 'terminskurs'), trade_date: trade, maturity, hedged: str(input, 'hedged', { max: 200 }), created_by: actor.userId })} RETURNING id`;
  await auditBy(sql, actor, 'create', 'fx_forward', r.id);
  return r.id;
}

async function lock(tx: Tx, companyId: number, id: number) {
  const [f] = await tx<Fwd[]>`SELECT ${COLS} FROM fx_forwards WHERE id = ${id} AND company_id = ${companyId} FOR UPDATE`;
  if (!f) throw new NotFoundError('Terminen');
  if (f.status !== 'open') throw new ConflictError('Terminen är redan avräknad');
  return f;
}

/** Värdering per bokslutsdagen mot balansdagskursen: reserv för undervärde på osäkrade terminer */
export async function valuate(actor: Actor, id: number, input: Record<string, unknown>) {
  const d = date(input, 'date', 'Bokslutsdag');
  const rate = num(input.rate, 'balansdagskurs');
  return sql.begin(async (tx) => {
    const f = await lock(tx, actor.companyId, id);
    const y = yearEnd({ dir: f.direction, amount: f.amount, forwardRate: f.forward_rate, closingRate: rate, hedging: !!f.hedged, reserved: f.reserved });
    if (y.change) {
      await ensure(tx, actor.companyId);
      await createVoucher(tx, { actor, date: d, description: `Valutatermin ${f.currency} ${f.amount}: ${y.change > 0 ? 'reserv för orealiserad förlust' : 'minskad reserv'} (kurs ${rate})`, lines: fromSigned(reserveLines(y.change)), sourceType: 'fx_forward', sourceId: id });
      await tx`UPDATE fx_forwards SET reserved = ${y.reserve} WHERE id = ${id}`;
    }
    await auditBy(tx, actor, 'fx_forward_valuation', 'fx_forward', id, { rate, value: y.value });
    return y;
  });
}

/** Förfall med nettoavräkning mot avistakursen */
export async function settle(actor: Actor, id: number, input: Record<string, unknown>) {
  const d = date(input, 'date', 'Datum', false) || today();
  const spot = num(input.spot_rate, 'avistakurs');
  return sql.begin(async (tx) => {
    const f = await lock(tx, actor.companyId, id);
    const result = value(f.direction, f.amount, f.forward_rate, spot);
    await ensure(tx, actor.companyId);
    await createVoucher(tx, { actor, date: d, description: `Avräkning valutatermin ${f.currency} ${f.amount} (terminskurs ${f.forward_rate}, avista ${spot})`, lines: fromSigned(settleLines(result, f.reserved)), sourceType: 'fx_forward', sourceId: id });
    await tx`UPDATE fx_forwards SET status = 'settled', spot_rate = ${spot}, result = ${result}, reserved = 0 WHERE id = ${id}`;
    await auditBy(tx, actor, 'fx_forward_settle', 'fx_forward', id, { result });
    return result;
  });
}
