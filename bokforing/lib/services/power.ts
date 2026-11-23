import 'server-only';
import { sql, type Tx } from '@/lib/db';
import { ConflictError, NotFoundError, ValidationError } from '@/lib/errors';
import { auditBy } from '@/lib/server/audit';
import { createVoucher } from '@/lib/server/ledger';
import { fromSigned } from '@/lib/ledger-lines';
import { parseAmount } from '@/lib/money';
import { today } from '@/lib/format';
import { CERT_SALES, POWER_SALES, VAT_OUT, reduction, saleLines, yearSummary } from '@/lib/power';
import type { Actor } from './actor';
import { date, int, optInt, str } from './input';

const NAMES: Record<number, string> = { [POWER_SALES]: 'Försäljning av egenproducerad el', [CERT_SALES]: 'Försäljning av elcertifikat och ursprungsgarantier', [VAT_OUT]: 'Utgående moms på försäljning inom Sverige, 25 %' };
const ensure = async (tx: Tx, companyId: number, ns: number[]) => { for (const n of ns) await tx`INSERT INTO accounts (company_id, number, name) VALUES (${companyId}, ${n}, ${NAMES[n]}) ON CONFLICT DO NOTHING`; };
const kwh = (v: unknown, label: string) => { const n = Number(String(v ?? '').replace(/\s/g, '').replace(',', '.') || '0'); if (!Number.isFinite(n) || n < 0) throw new ValidationError(`Ange ${label} i kWh`); return Math.round(n * 10) / 10; };
const vatOf = (v: unknown) => (String(v) === '0' ? 0 : 25);

export async function overview(companyId: number, year: number) {
  const [c] = await sql<{ company_type: string }[]>`SELECT company_type FROM companies WHERE id = ${companyId}`;
  const plants = await sql<{ id: number; name: string; kind: string; capacity_kw: number | null; investment: number; asset: string | null; start_date: string }[]>`
    SELECT p.id, p.name, p.kind, p.capacity_kw::float8 AS capacity_kw, p.investment::float8 AS investment, a.name AS asset, to_char(p.start_date,'YYYY-MM-DD') AS start_date
    FROM power_plants p LEFT JOIN assets a ON a.id = p.asset_id WHERE p.company_id = ${companyId} ORDER BY p.name`;
  const months = await sql<{ plant_id: number; period: string; produced_kwh: number; sold_kwh: number; bought_kwh: number; sold_amount: number; vat_rate: number }[]>`
    SELECT m.plant_id, m.period, m.produced_kwh::float8 AS produced_kwh, m.sold_kwh::float8 AS sold_kwh, m.bought_kwh::float8 AS bought_kwh, m.sold_amount::float8 AS sold_amount, m.vat_rate
    FROM power_months m JOIN power_plants p ON p.id = m.plant_id WHERE p.company_id = ${companyId} AND m.period LIKE ${`${year}-%`} ORDER BY m.period`;
  const certs = await sql<{ plant_id: number; date: string; kind: string; quantity: number; amount: number }[]>`SELECT c.plant_id, to_char(c.date,'YYYY-MM-DD') AS date, c.kind, c.quantity, c.amount::float8 AS amount
    FROM power_certificates c JOIN power_plants p ON p.id = c.plant_id WHERE p.company_id = ${companyId} AND extract(year FROM c.date) = ${year} ORDER BY c.date`;
  const assets = await sql<{ id: number; name: string }[]>`SELECT id, name FROM assets WHERE company_id = ${companyId} AND status = 'active' ORDER BY name`;
  return {
    ef: c.company_type === 'EF', assets,
    plants: plants.map((p) => {
      const own = months.filter((m) => m.plant_id === p.id), oc = certs.filter((x) => x.plant_id === p.id);
      const sum = yearSummary(own, oc.reduce((s, x) => s + x.amount, 0), p.investment);
      return { ...p, months: own, certs: oc, summary: sum, reduction: reduction(year, sum.sold, own.reduce((s, m) => s + m.bought_kwh, 0)) };
    }),
  };
}

export async function addPlant(actor: Actor, input: Record<string, unknown>) {
  const assetId = optInt(input, 'asset_id', 'Anläggningstillgång');
  if (assetId) { const [a] = await sql`SELECT 1 FROM assets WHERE id = ${assetId} AND company_id = ${actor.companyId}`; if (!a) throw new NotFoundError('Tillgången'); }
  const inv = String(input.investment ?? '').trim() ? parseAmount(String(input.investment)) : 0;
  if (inv == null || inv < 0) throw new ValidationError('Ange investeringen i kronor');
  const cap = String(input.capacity_kw ?? '').trim() ? Number(String(input.capacity_kw).replace(',', '.')) : null;
  if (cap != null && (!Number.isFinite(cap) || cap <= 0)) throw new ValidationError('Ogiltig effekt');
  try {
    await sql`INSERT INTO power_plants ${sql({ company_id: actor.companyId, name: str(input, 'name', { required: true, label: 'Anläggning', max: 100 }), kind: ['sol', 'vind', 'vatten', 'annan'].includes(String(input.kind)) ? String(input.kind) : 'sol',
      capacity_kw: cap, investment: inv, asset_id: assetId, start_date: date(input, 'start_date', 'Driftstart', false) || today() })}`;
  } catch (e) { if (String((e as Error).message).includes('power_plants_company_id_name_key')) throw new ConflictError('Anläggningen finns redan'); throw e; }
}

const plantOf = async (tx: Tx, actor: Actor, id: number) => {
  const [p] = await tx<{ name: string }[]>`SELECT name FROM power_plants WHERE id = ${id} AND company_id = ${actor.companyId} FOR UPDATE`;
  if (!p) throw new NotFoundError('Anläggningen');
  return p;
};

/** Månadens produktion och såld el; försäljningen bokförs med moms (eller utan om bolaget är befriat) */
export async function addMonth(actor: Actor, plantId: number, input: Record<string, unknown>) {
  const period = str(input, 'period', { required: true, label: 'Månad' });
  if (!/^\d{4}-(0[1-9]|1[0-2])$/.test(period)) throw new ValidationError('Ange månaden som ÅÅÅÅ-MM');
  const produced = kwh(input.produced_kwh, 'producerad el'), sold = kwh(input.sold_kwh, 'såld el'), bought = kwh(input.bought_kwh, 'köpt el');
  if (sold > produced) throw new ValidationError('Såld el kan inte vara mer än den producerade');
  const amountRaw = String(input.sold_amount ?? '').trim();
  const amount = amountRaw ? parseAmount(amountRaw) : 0;
  if (amount == null || amount < 0) throw new ValidationError('Ange ersättningen för den sålda elen exkl. moms');
  const vat = vatOf(input.vat_rate);
  const last = (() => { const [y, m] = period.split('-').map(Number); return `${period}-${String(new Date(Date.UTC(y, m, 0)).getUTCDate()).padStart(2, '0')}`; })();
  return sql.begin(async (tx) => {
    const p = await plantOf(tx, actor, plantId);
    const [dup] = await tx`SELECT 1 FROM power_months WHERE plant_id = ${plantId} AND period = ${period}`;
    if (dup) throw new ConflictError('Månaden är redan registrerad');
    let voucherId: number | null = null;
    if (amount) {
      await ensure(tx, actor.companyId, [POWER_SALES, ...(vat ? [VAT_OUT] : [])]);
      voucherId = (await createVoucher(tx, { actor, date: last > today() ? today() : last, description: `Såld el ${period}, ${p.name}: ${sold.toLocaleString('sv-SE')} kWh`, lines: fromSigned(saleLines(amount, vat, POWER_SALES)), sourceType: 'power' })).id;
    }
    await tx`INSERT INTO power_months ${tx({ plant_id: plantId, period, produced_kwh: produced, sold_kwh: sold, bought_kwh: bought, sold_amount: amount, vat_rate: vat, voucher_id: voucherId, created_by: actor.userId })}`;
    return { amount, sold };
  });
}

/** Sålda elcertifikat eller ursprungsgarantier är intäkt när de säljs */
export async function sellCertificates(actor: Actor, plantId: number, input: Record<string, unknown>) {
  const kind = input.kind === 'guarantee' ? 'guarantee' : 'elcert';
  const quantity = int(input, 'quantity', 'Antal');
  if (quantity <= 0) throw new ValidationError('Ange antal');
  const amount = parseAmount(String(input.amount ?? '').trim());
  if (amount == null || amount <= 0) throw new ValidationError('Ange ersättningen exkl. moms');
  const vat = vatOf(input.vat_rate), d = date(input, 'date', 'Datum');
  return sql.begin(async (tx) => {
    const p = await plantOf(tx, actor, plantId);
    await ensure(tx, actor.companyId, [CERT_SALES, ...(vat ? [VAT_OUT] : [])]);
    const v = await createVoucher(tx, { actor, date: d, description: `Sålda ${kind === 'elcert' ? 'elcertifikat' : 'ursprungsgarantier'}, ${p.name}: ${quantity} st`, lines: fromSigned(saleLines(amount, vat, CERT_SALES)), sourceType: 'power' });
    await tx`INSERT INTO power_certificates ${tx({ plant_id: plantId, date: d, kind, quantity, amount, vat_rate: vat, voucher_id: v.id, created_by: actor.userId })}`;
    await auditBy(tx, actor, 'power_certificates', 'power_plant', plantId, { kind, quantity, amount });
    return amount;
  });
}
