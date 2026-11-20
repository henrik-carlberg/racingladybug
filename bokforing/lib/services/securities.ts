import 'server-only';
import { sql, type Tx } from '@/lib/db';
import { ConflictError, NotFoundError, ValidationError } from '@/lib/errors';
import { auditBy } from '@/lib/server/audit';
import { createVoucher } from '@/lib/server/ledger';
import { fromSigned } from '@/lib/ledger-lines';
import { parseAmount } from '@/lib/money';
import { accounts, buyLines, incomeLines, isBusinessRelated, KIND_LABEL, position, saleLines, saleResult, taxSummary, writedown, writedownLines,
  type Holding, type SecurityKind, type Trade } from '@/lib/securities';
import type { Actor } from './actor';
import { date, optInt, str } from './input';

const NAMES: Record<number, string> = {
  1350: 'Andelar och värdepapper i andra företag', 1359: 'Ackumulerade nedskrivningar av andelar och värdepapper', 1810: 'Andelar i börsnoterade företag', 1819: 'Nedskrivning av kortfristiga placeringar',
  1880: 'Andra kortfristiga placeringar (kryptotillgångar)', 1889: 'Nedskrivning av andra kortfristiga placeringar', 8210: 'Utdelningar på andelar i andra företag', 8220: 'Resultat vid försäljning av värdepapper i andra företag',
  8250: 'Ränteintäkter från långfristiga fordringar', 8270: 'Nedskrivningar av innehav av andelar och värdepapper', 8310: 'Ränteintäkter från omsättningstillgångar', 8320: 'Värdering av kortfristiga placeringar',
  8340: 'Utdelningar på kortfristiga placeringar', 8350: 'Resultat vid försäljning av kortfristiga placeringar',
};
async function ensure(tx: Tx, companyId: number, nums: number[]) {
  for (const n of nums) if (NAMES[n]) await tx`INSERT INTO accounts (company_id, number, name) VALUES (${companyId}, ${n}, ${NAMES[n]}) ON CONFLICT DO NOTHING`;
}
const kronor = (v: unknown, label: string, allowZero = false) => {
  const n = parseAmount(String(v ?? '').trim() || (allowZero ? '0' : ''));
  if (n == null || n < 0 || (!allowZero && n === 0)) throw new ValidationError(`Ange ${label} i kronor`);
  return n;
};
const qtyOf = (v: unknown) => {
  const n = Number(String(v ?? '').replace(/\s/g, '').replace(',', '.'));
  if (!(n > 0) || n > 1e12) throw new ValidationError('Ange antal');
  return Math.round(n * 1e8) / 1e8;
};
const bankOf = (input: Record<string, unknown>) => { const b = optInt(input, 'bank_account', 'Bankkonto') ?? 1930; if (b < 1900 || b > 1999) throw new ValidationError('Bankkonto måste vara ett 19xx-konto'); return b; };

export async function addSecurity(actor: Actor, input: Record<string, unknown>) {
  const kind = str(input, 'kind') as SecurityKind;
  if (!KIND_LABEL[kind]) throw new ValidationError('Välj typ av värdepapper');
  const holding: Holding = str(input, 'holding') === 'fixed' ? 'fixed' : 'current';
  try {
    const [r] = await sql<{ id: number }[]>`INSERT INTO securities ${sql({ company_id: actor.companyId, name: str(input, 'name', { required: true, label: 'Namn', max: 200 }), identifier: str(input, 'identifier', { max: 40 }),
      kind, holding, business_related: input.business_related === 'on' || input.business_related === true })} RETURNING id`;
    await auditBy(sql, actor, 'create', 'security', r.id);
    return r.id;
  } catch (e) {
    if (String((e as Error).message).includes('securities_company_id_name_key')) throw new ConflictError('Det finns redan ett innehav med det namnet');
    throw e;
  }
}

type Sec = { id: number; name: string; identifier: string; kind: SecurityKind; holding: Holding; business_related: boolean };
async function security(tx: Tx | typeof sql, companyId: number, id: number, lock = false) {
  const [s] = lock
    ? await tx<Sec[]>`SELECT id, name, identifier, kind, holding, business_related FROM securities WHERE id = ${id} AND company_id = ${companyId} FOR UPDATE`
    : await tx<Sec[]>`SELECT id, name, identifier, kind, holding, business_related FROM securities WHERE id = ${id} AND company_id = ${companyId}`;
  if (!s) throw new NotFoundError('Innehavet');
  return s;
}
async function trades(tx: Tx | typeof sql, securityId: number, until?: string): Promise<(Trade & { id: number; gain: number | null; voucher_id: number | null })[]> {
  return (await tx<{ id: number; kind: Trade['kind']; date: string; quantity: number; amount: number; fee: number; gain: number | null; voucher_id: number | null }[]>`
    SELECT id, kind, to_char(date,'YYYY-MM-DD') AS date, quantity::float8 AS quantity, amount::float8 AS amount, fee::float8 AS fee, gain::float8 AS gain, voucher_id
    FROM security_trades WHERE security_id = ${securityId} ${until ? tx`AND date <= ${until}` : tx``} ORDER BY date, id`).map((t) => ({ ...t }));
}

/** Köp, försäljning (genomsnittsmetoden), utdelning eller ränta – bokförs direkt */
export async function trade(actor: Actor, securityId: number, input: Record<string, unknown>) {
  const kind = str(input, 'kind') as Trade['kind'];
  if (!['buy', 'sell', 'dividend', 'interest'].includes(kind)) throw new ValidationError('Välj transaktion');
  const d = date(input, 'date', 'Datum');
  const amount = kronor(input.amount, kind === 'buy' ? 'köpesumman' : kind === 'sell' ? 'försäljningssumman' : 'beloppet');
  const fee = kronor(input.fee, 'courtage', true);
  const bank = bankOf(input);
  return sql.begin(async (tx) => {
    const s = await security(tx, actor.companyId, securityId, true);
    const acc = accounts(s.kind, s.holding);
    const all = await trades(tx, securityId);
    let lines, quantity = 0, cost: number | null = null, gain: number | null = null, desc: string;
    if (kind === 'buy') { quantity = qtyOf(input.quantity); lines = buyLines(acc, amount, fee, bank); desc = `Köp ${quantity} ${s.name}`; }
    else if (kind === 'sell') {
      quantity = qtyOf(input.quantity);
      // Försäljningen räknas mot innehavet på affärsdagen så att ett senare köp inte ändrar anskaffningsvärdet
      const pos = position(all.filter((t) => t.date <= d));
      let r;
      try { r = saleResult(pos, quantity, amount, fee); } catch (e) { throw new ValidationError((e as Error).message); }
      if (all.some((t) => t.kind === 'sell' && t.date > d)) throw new ValidationError('Det finns en senare försäljning – registrera försäljningar i datumordning');
      lines = saleLines(acc, r, bank); cost = r.cost; gain = r.gain;
      desc = `Försäljning ${quantity} ${s.name} (${r.gain >= 0 ? 'vinst' : 'förlust'} ${(Math.abs(r.gain) / 100).toFixed(2).replace('.', ',')} kr)`;
    } else { lines = incomeLines(acc, kind, amount, bank); desc = `${kind === 'dividend' ? 'Utdelning' : 'Ränta'} ${s.name}`; }
    await ensure(tx, actor.companyId, lines.map((l) => l.account));
    const v = await createVoucher(tx, { actor, date: d, description: desc, lines: fromSigned(lines), sourceType: 'security_trade', sourceId: securityId });
    await tx`INSERT INTO security_trades ${tx({ company_id: actor.companyId, security_id: securityId, kind, date: d, quantity, amount, fee, cost, gain, voucher_id: v.id, created_by: actor.userId })}`;
    await auditBy(tx, actor, 'security_' + kind, 'security', securityId, { quantity, amount, gain });
    return { gain, cost };
  });
}

/** Ångrar den senaste transaktionen på innehavet med en rättelseverifikation */
export async function undoLast(actor: Actor, securityId: number) {
  return sql.begin(async (tx) => {
    await security(tx, actor.companyId, securityId, true);
    const [t] = await tx<{ id: number; voucher_id: number | null }[]>`SELECT id, voucher_id FROM security_trades WHERE security_id = ${securityId} ORDER BY date DESC, id DESC LIMIT 1`;
    if (!t) throw new NotFoundError('Transaktionen');
    if (t.voucher_id) {
      const orig = await tx<{ account: number; debit: number; credit: number }[]>`SELECT account_number AS account, debit::float8 AS debit, credit::float8 AS credit FROM voucher_lines WHERE voucher_id = ${t.voucher_id}`;
      const [{ d }] = await tx<{ d: string }[]>`SELECT to_char(current_date,'YYYY-MM-DD') AS d`;
      await createVoucher(tx, { actor, date: d, description: 'Rättelse av värdepapperstransaktion', lines: orig.map((l) => ({ account: l.account, debit: l.credit, credit: l.debit })), sourceType: 'reversal', correctsId: t.voucher_id });
    }
    await tx`DELETE FROM security_trades WHERE id = ${t.id}`;
    await auditBy(tx, actor, 'security_undo', 'security', securityId, { trade: t.id });
  });
}

async function currentWritedown(tx: Tx | typeof sql, securityId: number, until: string) {
  const [w] = await tx<{ w: number }[]>`SELECT writedown::float8 AS w FROM security_valuations WHERE security_id = ${securityId} AND date <= ${until} ORDER BY date DESC LIMIT 1`;
  return w?.w ?? 0;
}

/** Värdering per bokslutsdagen: marknadsvärde, nedskrivning (eller återföring) bokförs som en verifikation */
export async function value(actor: Actor, securityId: number, input: Record<string, unknown>) {
  const d = date(input, 'date', 'Värderingsdag');
  const market = kronor(input.market, 'marknadsvärdet', true);
  const permanent = input.permanent === 'on' || input.permanent === true;
  return sql.begin(async (tx) => {
    const s = await security(tx, actor.companyId, securityId, true);
    const acc = accounts(s.kind, s.holding);
    const pos = position(await trades(tx, securityId, d));
    if (!pos.quantity) throw new ValidationError('Innehavet är tomt på värderingsdagen');
    const current = await currentWritedown(tx, securityId, d);
    const w = writedown({ holding: s.holding, cost: pos.cost, market, current, permanent });
    const lines = writedownLines(acc, w.change);
    let voucherId: number | null = null;
    if (lines.length) {
      await ensure(tx, actor.companyId, lines.map((l) => l.account));
      voucherId = (await createVoucher(tx, { actor, date: d, description: `${w.change > 0 ? 'Nedskrivning' : 'Återföring av nedskrivning'} ${s.name} till ${s.holding === 'current' ? 'lägsta värdets princip' : 'verkligt värde'}`,
        lines: fromSigned(lines), sourceType: 'security_valuation', sourceId: securityId })).id;
    }
    await tx`INSERT INTO security_valuations ${tx({ company_id: actor.companyId, security_id: securityId, date: d, market, writedown: w.target, change: w.change, voucher_id: voucherId })}
      ON CONFLICT (security_id, date) DO UPDATE SET market = EXCLUDED.market, writedown = EXCLUDED.writedown, change = security_valuations.change + EXCLUDED.change,
        voucher_id = COALESCE(EXCLUDED.voucher_id, security_valuations.voucher_id)`;
    await auditBy(tx, actor, 'security_value', 'security', securityId, { market, writedown: w.target });
    return w;
  });
}

/** Portföljen med innehav, bokfört värde och årets skattejusteringar */
export async function portfolio(companyId: number, year: number) {
  const secs = await sql<Sec[]>`SELECT id, name, identifier, kind, holding, business_related FROM securities WHERE company_id = ${companyId} ORDER BY holding, name`;
  const from = `${year}-01-01`, to = `${year}-12-31`;
  const rows = [];
  for (const s of secs) {
    const ts = await trades(sql, s.id);
    const pos = position(ts);
    const wd = await currentWritedown(sql, s.id, '9999-12-31');
    const [last] = await sql<{ market: number; date: string }[]>`SELECT market::float8 AS market, to_char(date,'YYYY-MM-DD') AS date FROM security_valuations WHERE security_id = ${s.id} ORDER BY date DESC LIMIT 1`;
    const inYear = ts.filter((t) => t.date >= from && t.date <= to);
    const [wy] = await sql<{ w: number }[]>`SELECT COALESCE(SUM(change), 0)::float8 AS w FROM security_valuations WHERE security_id = ${s.id} AND date BETWEEN ${from} AND ${to}`;
    // Värdet vid årets ingång: värderingen per föregående årsskifte, annars anskaffningsvärdet
    const startPos = position(ts.filter((t) => t.date < from));
    const [vStart] = await sql<{ market: number }[]>`SELECT market::float8 AS market FROM security_valuations WHERE security_id = ${s.id} AND date = ${`${year - 1}-12-31`}`;
    rows.push({ ...s, label: KIND_LABEL[s.kind], businessRelated: isBusinessRelated(s.kind, s.business_related), ...pos, writedown: wd, book: pos.cost - wd, market: last?.market ?? null, marketDate: last?.date ?? null, trades: ts,
      year: { dividends: inYear.filter((t) => t.kind === 'dividend' || t.kind === 'interest').reduce((a, t) => a + t.amount, 0), gains: inYear.reduce((a, t) => a + (t.gain ?? 0), 0), writedowns: wy.w,
        fundValueStart: startPos.quantity ? vStart?.market ?? startPos.cost : 0 } });
  }
  const tax = taxSummary(rows.map((r) => ({ id: r.id, name: r.name, kind: r.kind, businessRelated: r.businessRelated, ...r.year })));
  return { rows, tax };
}
