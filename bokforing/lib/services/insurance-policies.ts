import 'server-only';
import { sql } from '@/lib/db';
import { ConflictError, NotFoundError, ValidationError } from '@/lib/errors';
import { auditBy } from '@/lib/server/audit';
import { createVoucher } from '@/lib/server/ledger';
import { fromSigned } from '@/lib/ledger-lines';
import { parseAmount } from '@/lib/money';
import { today } from '@/lib/format';
import { INSURANCE_COST, PREPAID, dueCost, yearlyCost, periodLines, reclassLines, renewalDue } from '@/lib/insurance-policies';
import type { Actor } from './actor';
import { date, str } from './input';

const NAMES: Record<number, string> = { [PREPAID]: 'Övriga förutbetalda kostnader och upplupna intäkter', [INSURANCE_COST]: 'Företagsförsäkringar' };

export async function overview(companyId: number) {
  const t = today();
  const list = await sql<{ id: number; insurer: string; kind: string; policy_no: string; premium: number; start: string; end: string; deductible: number; coverage: string; recognized: number; prepaid_voucher_id: number | null }[]>`
    SELECT id, insurer, kind, policy_no, premium::float8 AS premium, to_char(start_date,'YYYY-MM-DD') AS start, to_char(end_date,'YYYY-MM-DD') AS end, deductible::float8 AS deductible, coverage, recognized::float8 AS recognized, prepaid_voucher_id
    FROM insurance_policies WHERE company_id = ${companyId} ORDER BY end_date DESC, insurer`;
  const claims = await sql<{ insurer: string; description: string; status: string; compensation: number | null }[]>`SELECT insurer, description, status, compensation::float8 AS compensation FROM damage_claims WHERE company_id = ${companyId} AND insurer <> ''`;
  const policies = list.map((p) => ({ ...p, active: p.start <= t && p.end >= t, renewalIn: renewalDue(p.end, t), due: dueCost(p.premium, p.start, p.end, t), claims: claims.filter((c) => c.insurer.toLowerCase() === p.insurer.toLowerCase()) }));
  const byKind = new Map<string, number>();
  for (const p of policies.filter((x) => x.active)) {
    byKind.set(p.kind, (byKind.get(p.kind) ?? 0) + yearlyCost(p.premium, p.start, p.end));
  }
  return { policies, byKind: [...byKind].map(([kind, yearly]) => ({ kind, yearly })).sort((a, b) => b.yearly - a.yearly), pending: policies.filter((p) => p.prepaid_voucher_id).reduce((s, p) => s + Math.max(0, p.due - p.recognized), 0) };
}

/** Försäkringen registreras; har premien kostnadsförts på 6310 kan den föras om till förutbetald kostnad och periodiseras */
export async function add(actor: Actor, input: Record<string, unknown>) {
  const premium = parseAmount(String(input.premium ?? '').trim());
  if (premium == null || premium <= 0) throw new ValidationError('Ange premien i kronor');
  const deductible = String(input.deductible ?? '').trim() ? parseAmount(String(input.deductible)) : 0;
  if (deductible == null || deductible < 0) throw new ValidationError('Ogiltig självrisk');
  const start = date(input, 'start_date', 'Gäller från'), end = date(input, 'end_date', 'Gäller till');
  if (end <= start) throw new ValidationError('Försäkringsperioden ska sluta efter att den börjar');
  return sql.begin(async (tx) => {
    let voucherId: number | null = null;
    if (input.reclass === 'on') {
      for (const n of [PREPAID, INSURANCE_COST]) await tx`INSERT INTO accounts (company_id, number, name) VALUES (${actor.companyId}, ${n}, ${NAMES[n]}) ON CONFLICT DO NOTHING`;
      voucherId = (await createVoucher(tx, { actor, date: start > today() ? today() : start, description: `Försäkringspremie ${str(input, 'insurer')} ${str(input, 'kind')}: förutbetald kostnad`, lines: fromSigned(reclassLines(premium)), sourceType: 'insurance_policy' })).id;
    }
    const [r] = await tx<{ id: number }[]>`INSERT INTO insurance_policies ${tx({ company_id: actor.companyId, insurer: str(input, 'insurer', { required: true, label: 'Försäkringsbolag', max: 100 }), kind: str(input, 'kind', { required: true, label: 'Försäkring', max: 100 }),
      policy_no: str(input, 'policy_no', { max: 60 }), premium, start_date: start, end_date: end, deductible, coverage: str(input, 'coverage', { max: 500 }), prepaid_voucher_id: voucherId, created_by: actor.userId })} RETURNING id`;
    await auditBy(tx, actor, 'insurance_policy', 'insurance_policy', r.id, { premium });
    return r.id;
  });
}

/** Periodisering: den del av premierna som hör till förfluten tid kostnadsförs från 1790 */
export async function periodize(actor: Actor, input: Record<string, unknown>) {
  const d = date(input, 'date', 'Datum', false) || today();
  return sql.begin(async (tx) => {
    const list = await tx<{ id: number; premium: number; start: string; end: string; recognized: number }[]>`SELECT id, premium::float8 AS premium, to_char(start_date,'YYYY-MM-DD') AS start, to_char(end_date,'YYYY-MM-DD') AS end, recognized::float8 AS recognized
      FROM insurance_policies WHERE company_id = ${actor.companyId} AND prepaid_voucher_id IS NOT NULL FOR UPDATE`;
    let total = 0;
    for (const p of list) {
      const amount = dueCost(p.premium, p.start, p.end, d) - p.recognized;
      if (amount <= 0) continue;
      await tx`UPDATE insurance_policies SET recognized = recognized + ${amount} WHERE id = ${p.id}`;
      total += amount;
    }
    if (!total) throw new ConflictError('Premierna är redan periodiserade fram till datumet');
    await createVoucher(tx, { actor, date: d, description: `Periodisering av försäkringspremier t.o.m. ${d}`, lines: fromSigned(periodLines(total)), sourceType: 'insurance_policy' });
    return total;
  });
}

/** Förnyelse: en ny period med ny premie (den gamla försäkringen ligger kvar i historiken) */
export async function renew(actor: Actor, id: number, input: Record<string, unknown>) {
  const [p] = await sql<{ insurer: string; kind: string; policy_no: string; deductible: number; coverage: string; end: string; reclassed: boolean }[]>`SELECT insurer, kind, policy_no, deductible::float8 AS deductible, coverage, to_char(end_date,'YYYY-MM-DD') AS end,
    prepaid_voucher_id IS NOT NULL AS reclassed FROM insurance_policies WHERE id = ${id} AND company_id = ${actor.companyId}`;
  if (!p) throw new NotFoundError('Försäkringen');
  const start = new Date(Date.parse(p.end) + 864e5).toISOString().slice(0, 10);
  const end = date(input, 'end_date', 'Ny period till');
  return add(actor, { insurer: p.insurer, kind: p.kind, policy_no: p.policy_no, premium: input.premium, deductible: String(p.deductible / 100), coverage: p.coverage, start_date: start, end_date: end, reclass: p.reclassed ? 'on' : '' });
}
