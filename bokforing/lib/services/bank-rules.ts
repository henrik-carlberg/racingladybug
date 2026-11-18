import 'server-only';
import { sql } from '@/lib/db';
import { NotFoundError, ValidationError } from '@/lib/errors';
import { auditBy } from '@/lib/server/audit';
import { learnKey, pickRule, ruleMatches, STARTER_RULES, type BankRule, type RuleTx } from '@/lib/bank/rules';
import type { Actor } from './actor';
import { int, optInt, str } from './input';

export interface RuleOut extends BankRule { hits: number; last_used_at: string | null; open_matches?: number }

const COLS = () => sql`id, name, pattern, direction, amount_min::int AS "amountMin", amount_max::int AS "amountMax", account, vat_rate AS "vatRate",
  description, auto, priority, hits, to_char(last_used_at,'YYYY-MM-DD') AS last_used_at`;

export async function listRules(companyId: number): Promise<RuleOut[]> {
  return [...await sql<RuleOut[]>`SELECT ${COLS()} FROM bank_rules WHERE company_id = ${companyId} ORDER BY priority DESC, name`];
}

function readRule(input: Record<string, unknown>) {
  const pattern = str(input, 'pattern', { required: true, label: 'Sökord' }).toLowerCase().replace(/\s+/g, ' ').trim();
  if (pattern.replace(/[*\s]/g, '').length < 2) throw new ValidationError('Sökordet måste vara minst två tecken');
  const direction = str(input, 'direction') || 'any';
  if (!['in', 'out', 'any'].includes(direction)) throw new ValidationError('Ogiltig riktning');
  const vat = optInt(input, 'vat_rate', 'Moms') ?? 0;
  if (![0, 6, 12, 25].includes(vat)) throw new ValidationError('Momssats måste vara 0, 6, 12 eller 25');
  const min = optInt(input, 'amount_min', 'Lägsta belopp');
  const max = optInt(input, 'amount_max', 'Högsta belopp');
  if (min != null && max != null && min > max) throw new ValidationError('Lägsta belopp är större än högsta');
  return {
    name: str(input, 'name') || pattern, pattern, direction, amount_min: min, amount_max: max,
    account: int(input, 'account', 'Konto'), vat_rate: vat, description: str(input, 'description'),
    auto: input.auto === true || input.auto === 'on' || input.auto === 'true', priority: optInt(input, 'priority', 'Prioritet') ?? 0,
  };
}

async function checkAccount(companyId: number, account: number) {
  const [a] = await sql`SELECT 1 FROM accounts WHERE company_id = ${companyId} AND number = ${account} AND active`;
  if (!a) throw new ValidationError(`Kontot ${account} finns inte eller är inaktivt i kontoplanen`);
  if (account >= 1900 && account <= 1999) throw new ValidationError('Välj motkontot, inte ett bankkonto');
}

export async function createRule(actor: Actor, input: Record<string, unknown>) {
  const r = readRule(input);
  await checkAccount(actor.companyId, r.account);
  const [{ id }] = await sql<{ id: number }[]>`INSERT INTO bank_rules ${sql({ ...r, company_id: actor.companyId, created_by: actor.userId })} RETURNING id`;
  await auditBy(sql, actor, 'create', 'bank_rule', id, r);
  return id;
}

export async function updateRule(actor: Actor, id: number, input: Record<string, unknown>) {
  const r = readRule(input);
  await checkAccount(actor.companyId, r.account);
  const res = await sql`UPDATE bank_rules SET ${sql(r)} WHERE id = ${id} AND company_id = ${actor.companyId}`;
  if (!res.count) throw new NotFoundError('Regeln');
  await auditBy(sql, actor, 'update', 'bank_rule', id, r);
}

export async function deleteRule(actor: Actor, id: number) {
  const res = await sql`DELETE FROM bank_rules WHERE id = ${id} AND company_id = ${actor.companyId}`;
  if (!res.count) throw new NotFoundError('Regeln');
  await auditBy(sql, actor, 'delete', 'bank_rule', id);
}

/** Lägger till startreglerna som saknas (bara för konton som finns i kontoplanen) */
export async function addStarterRules(actor: Actor) {
  const existing = new Set((await listRules(actor.companyId)).map((r) => r.pattern));
  const accounts = new Set((await sql<{ number: number }[]>`SELECT number FROM accounts WHERE company_id = ${actor.companyId} AND active`).map((a) => a.number));
  let n = 0;
  for (const r of STARTER_RULES) {
    if (existing.has(r.pattern) || !accounts.has(r.account)) continue;
    await sql`INSERT INTO bank_rules ${sql({ company_id: actor.companyId, name: r.name, pattern: r.pattern, direction: r.direction, amount_min: r.amountMin, amount_max: r.amountMax,
      account: r.account, vat_rate: r.vatRate, description: r.description, created_by: actor.userId })}`;
    n++;
  }
  await auditBy(sql, actor, 'add_starter_rules', 'company', actor.companyId, { count: n });
  return n;
}

export interface AccountSuggestion {
  account: number; accountName: string; vatRate: number; description: string;
  source: 'rule' | 'history'; ruleId: number | null; ruleName: string; auto: boolean; count: number;
}

/** Kontoförslag per transaktion: först regler, därefter hur samma motpart har bokförts tidigare (minst 2 gånger, samma konto) */
export async function accountSuggestions(companyId: number, txs: (RuleTx & { id: number })[]): Promise<Map<number, AccountSuggestion>> {
  const out = new Map<number, AccountSuggestion>();
  if (!txs.length) return out;
  const rules = await listRules(companyId);
  const names = new Map((await sql<{ number: number; name: string }[]>`SELECT number, name FROM accounts WHERE company_id = ${companyId}`).map((a) => [a.number, a.name]));
  const keys = [...new Set(txs.map((t) => learnKey(t)).filter(Boolean))];
  const history = keys.length ? await sql<{ key: string; account: number; vat: number; dir: number; description: string; n: number; total: number }[]>`
    SELECT learn_key AS key, booked_account AS account, booked_vat AS vat, sign(amount)::int AS dir, max(description) AS description, count(*)::int AS n,
      sum(count(*)) OVER (PARTITION BY learn_key, sign(amount))::int AS total
    FROM bank_transactions WHERE company_id = ${companyId} AND learn_key IN ${sql(keys)} AND booked_account IS NOT NULL AND rule_id IS NULL
    GROUP BY learn_key, booked_account, booked_vat, sign(amount)` : [];
  for (const t of txs) {
    const r = pickRule(rules, t);
    if (r) {
      out.set(t.id, { account: r.account, accountName: names.get(r.account) ?? '', vatRate: r.vatRate, description: r.description || t.counterparty || t.description,
        source: 'rule', ruleId: r.id, ruleName: r.name, auto: r.auto, count: r.hits });
      continue;
    }
    const key = learnKey(t);
    const h = history.filter((x) => x.key === key && x.dir === Math.sign(t.amount)).sort((a, b) => b.n - a.n)[0];
    // Bara om motparten har bokförts likadant minst två gånger och det är den klart vanligaste konteringen
    if (h && h.n >= 2 && h.n / h.total >= 0.75) {
      out.set(t.id, { account: h.account, accountName: names.get(h.account) ?? '', vatRate: h.vat ?? 0, description: t.counterparty || t.description,
        source: 'history', ruleId: null, ruleName: '', auto: false, count: h.n });
    }
  }
  return out;
}

/** Antal öppna transaktioner som en regel skulle träffa (visas på regelsidan) */
export async function openMatches(companyId: number, rules: RuleOut[]) {
  const txs = await sql<(RuleTx & { id: number })[]>`SELECT id, amount, description, reference, counterparty FROM bank_transactions WHERE company_id = ${companyId} AND status = 'unmatched'`;
  for (const r of rules) r.open_matches = txs.filter((t) => ruleMatches(r, t)).length;
  return rules;
}
