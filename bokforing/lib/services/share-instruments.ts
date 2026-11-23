import 'server-only';
import { sql, type Tx } from '@/lib/db';
import { ConflictError, NotFoundError, ValidationError } from '@/lib/errors';
import { auditBy } from '@/lib/server/audit';
import { createVoucher } from '@/lib/server/ledger';
import { fromSigned } from '@/lib/ledger-lines';
import { parseAmount } from '@/lib/money';
import { today } from '@/lib/format';
import { quotaValue } from '@/lib/shares';
import { ACCRUED_INTEREST, CONVERTIBLE, INTEREST_COST, PREMIUM_FUND, SHARE_CAPITAL, accruedInterest, conversionLines, dilution, exerciseLines, interestLines, issueLines } from '@/lib/share-instruments';
import type { Actor } from './actor';
import { date, int, str } from './input';
import { addSharesTx, getRegister } from './shares';

const NAMES: Record<number, string> = { [CONVERTIBLE]: 'Konvertibla lån och liknande', [SHARE_CAPITAL]: 'Aktiekapital', [PREMIUM_FUND]: 'Fri överkursfond', [INTEREST_COST]: 'Räntekostnader för långfristiga skulder', [ACCRUED_INTEREST]: 'Upplupna räntekostnader' };
const ensure = async (tx: Tx, companyId: number, ns: number[]) => { for (const n of ns) await tx`INSERT INTO accounts (company_id, number, name) VALUES (${companyId}, ${n}, ${NAMES[n]}) ON CONFLICT DO NOTHING`; };
const ownerOnly = (a: Actor) => { if (a.role !== 'owner') throw new ValidationError('Bara ägaren kan ge ut konvertibler och optioner'); };

type Row = { id: number; kind: 'convertible' | 'warrant'; holder_name: string; holder_id: string; issued_on: string; expires_on: string; amount: number; shares: number; strike: number; interest_pct: number; interest_booked: number; interest_until: string | null; share_class: 'A' | 'B'; status: string; closed_on: string | null };
const COLS = sql`id, kind, holder_name, holder_id, to_char(issued_on,'YYYY-MM-DD') AS issued_on, to_char(expires_on,'YYYY-MM-DD') AS expires_on, amount::float8 AS amount, shares, strike::float8 AS strike,
  interest_pct::float8 AS interest_pct, interest_booked::float8 AS interest_booked, to_char(interest_until,'YYYY-MM-DD') AS interest_until, share_class, status, to_char(closed_on,'YYYY-MM-DD') AS closed_on`;

export async function overview(companyId: number) {
  const reg = await getRegister(companyId);
  const list = await sql<Row[]>`SELECT ${COLS} FROM share_instruments WHERE company_id = ${companyId} ORDER BY status = 'active' DESC, issued_on DESC`;
  const t = today();
  const active = list.filter((i) => i.status === 'active');
  return {
    settings: reg.settings, quota: reg.quota,
    instruments: list.map((i) => ({ ...i, pendingInterest: i.kind === 'convertible' && i.status === 'active' ? accruedInterest({ amount: i.amount, pct: i.interest_pct, from: i.issued_on, to: t > i.expires_on ? i.expires_on : t, booked: i.interest_booked }) : 0 })),
    dilution: dilution(reg.holders.map((h) => ({ name: h.name, shares: h.shares })), active.map((i) => ({ name: i.holder_name, shares: i.shares }))),
  };
}

export async function issue(actor: Actor, input: Record<string, unknown>) {
  ownerOnly(actor);
  const kind = input.kind === 'warrant' ? 'warrant' : 'convertible';
  const reg = await getRegister(actor.companyId);
  if (!reg.settings) throw new ValidationError('Lägg upp aktieboken först');
  const amount = parseAmount(String(input.amount ?? '').trim() || '0');
  if (amount == null || amount < 0 || (kind === 'convertible' && !amount)) throw new ValidationError(kind === 'convertible' ? 'Ange lånebeloppet' : 'Ange optionspremien (0 om optionerna är gratis)');
  const strike = parseAmount(String(input.strike ?? '').trim());
  if (strike == null || strike <= 0) throw new ValidationError('Ange konverterings- eller teckningskursen per aktie');
  if (strike < reg.quota) throw new ValidationError(`Kursen får inte vara lägre än kvotvärdet (${(reg.quota / 100).toLocaleString('sv-SE')} kr)`);
  const shares = kind === 'convertible' ? Math.floor(amount / strike) : int(input, 'shares', 'Antal aktier');
  if (shares <= 0) throw new ValidationError('Antalet aktier måste vara minst ett');
  const issued = date(input, 'issued_on', 'Utgiven'), expires = date(input, 'expires_on', 'Löptid till');
  if (expires <= issued) throw new ValidationError('Löptiden ska sluta efter utgivningen');
  const pct = Number(String(input.interest_pct ?? '0').replace(',', '.') || '0');
  if (!Number.isFinite(pct) || pct < 0 || pct > 50) throw new ValidationError('Ogiltig ränta');
  return sql.begin(async (tx) => {
    let voucherId: number | null = null;
    if (amount) {
      await ensure(tx, actor.companyId, [kind === 'convertible' ? CONVERTIBLE : PREMIUM_FUND]);
      voucherId = (await createVoucher(tx, { actor, date: issued, description: `${kind === 'convertible' ? 'Konvertibelt lån' : 'Teckningsoptioner'}: ${str(input, 'holder_name')}`, lines: fromSigned(issueLines(kind, amount)), sourceType: 'share_instrument' })).id;
    }
    const [r] = await tx<{ id: number }[]>`INSERT INTO share_instruments ${tx({ company_id: actor.companyId, kind, holder_name: str(input, 'holder_name', { required: true, label: 'Innehavare', max: 200 }), holder_id: str(input, 'holder_id', { max: 20 }),
      issued_on: issued, expires_on: expires, amount, shares, strike, interest_pct: kind === 'convertible' ? pct : 0, share_class: input.share_class === 'A' ? 'A' : 'B', issue_voucher_id: voucherId, created_by: actor.userId })} RETURNING id`;
    await auditBy(tx, actor, 'share_instrument', 'share_instrument', r.id, { kind, amount, shares });
    return { id: r.id, shares };
  });
}

const lock = async (tx: Tx, actor: Actor, id: number) => {
  const [i] = await tx<Row[]>`SELECT ${COLS} FROM share_instruments WHERE id = ${id} AND company_id = ${actor.companyId} FOR UPDATE`;
  if (!i) throw new NotFoundError('Instrumentet');
  if (i.status !== 'active') throw new ConflictError('Instrumentet är redan avslutat');
  return i;
};

/** Räntan på konvertibeln periodiseras fram till ett datum */
export async function accrue(actor: Actor, id: number, input: Record<string, unknown>) {
  ownerOnly(actor);
  const d = date(input, 'date', 'Datum', false) || today();
  return sql.begin(async (tx) => {
    const i = await lock(tx, actor, id);
    if (i.kind !== 'convertible') throw new ValidationError('Bara konvertibler löper med ränta');
    const to = d > i.expires_on ? i.expires_on : d;
    const amount = accruedInterest({ amount: i.amount, pct: i.interest_pct, from: i.issued_on, to, booked: i.interest_booked });
    if (!amount) throw new ConflictError('Räntan är redan periodiserad fram till datumet');
    await ensure(tx, actor.companyId, [INTEREST_COST, ACCRUED_INTEREST]);
    await createVoucher(tx, { actor, date: d, description: `Upplupen ränta konvertibel ${i.holder_name} t.o.m. ${to}`, lines: fromSigned(interestLines(amount)), sourceType: 'share_instrument', sourceId: id });
    await tx`UPDATE share_instruments SET interest_booked = interest_booked + ${amount}, interest_until = ${to} WHERE id = ${id}`;
    return amount;
  });
}

/** Konvertering eller teckning: nya aktier i aktieboken och ökat aktiekapital */
export async function convert(actor: Actor, id: number, input: Record<string, unknown>) {
  ownerOnly(actor);
  const d = date(input, 'date', 'Datum', false) || today();
  return sql.begin(async (tx) => {
    const i = await lock(tx, actor, id);
    if (d > i.expires_on) throw new ConflictError('Löptiden har gått ut');
    const [s] = await tx<{ share_capital: number; total_shares: number }[]>`SELECT share_capital::float8 AS share_capital, total_shares FROM share_settings WHERE company_id = ${actor.companyId} FOR UPDATE`;
    if (!s) throw new ValidationError('Aktieboken saknas');
    const quota = quotaValue(s.share_capital, s.total_shares);
    let r: { capital: number; lines: { account: number; amount: number }[] };
    try { r = i.kind === 'convertible' ? conversionLines(i.amount, i.shares, quota) : exerciseLines(i.shares, i.strike, quota); } catch (e) { throw new ValidationError((e as Error).message); }
    await ensure(tx, actor.companyId, [SHARE_CAPITAL, PREMIUM_FUND, ...(i.kind === 'convertible' ? [CONVERTIBLE] : [])]);
    const v = await createVoucher(tx, { actor, date: d, description: `${i.kind === 'convertible' ? 'Konvertering' : 'Teckning med optioner'}: ${i.shares} aktier till ${i.holder_name}`, lines: fromSigned(r.lines), sourceType: 'share_instrument', sourceId: id });
    const nos = await addSharesTx(tx, actor, { name: i.holder_name, holder_id: i.holder_id, address: '', shares: i.shares, share_class: i.share_class, date: d, capital: r.capital, kind: 'issue',
      text: `${i.kind === 'convertible' ? 'Konvertering' : 'Nyteckning med teckningsoptioner'}: ${i.shares} ${i.share_class}-aktier till ${i.holder_name}` });
    await tx`UPDATE share_instruments SET status = ${i.kind === 'convertible' ? 'converted' : 'exercised'}, closed_on = ${d}, close_voucher_id = ${v.id} WHERE id = ${id}`;
    await auditBy(tx, actor, 'share_instrument_converted', 'share_instrument', id, { shares: i.shares, capital: r.capital });
    return { shares: i.shares, capital: r.capital, ...nos };
  });
}

/** Konvertibeln återbetalas eller optionerna förfaller */
export async function close(actor: Actor, id: number, input: Record<string, unknown>) {
  ownerOnly(actor);
  const d = date(input, 'date', 'Datum', false) || today();
  return sql.begin(async (tx) => {
    const i = await lock(tx, actor, id);
    let voucherId: number | null = null;
    if (i.kind === 'convertible') {
      voucherId = (await createVoucher(tx, { actor, date: d, description: `Återbetalt konvertibelt lån: ${i.holder_name}`, lines: fromSigned([{ account: CONVERTIBLE, amount: i.amount }, { account: 1930, amount: -i.amount }]), sourceType: 'share_instrument', sourceId: id })).id;
    }
    await tx`UPDATE share_instruments SET status = ${i.kind === 'convertible' ? 'repaid' : 'expired'}, closed_on = ${d}, close_voucher_id = ${voucherId} WHERE id = ${id}`;
    return i.kind;
  });
}
