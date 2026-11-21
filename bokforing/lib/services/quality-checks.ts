import 'server-only';
import { sql } from '@/lib/db';
import { NotFoundError } from '@/lib/errors';
import { auditBy } from '@/lib/server/audit';
import { accountSums } from '@/lib/server/ledger';
import { qcSummary, qualityChecks } from '@/lib/quality-checks';
import type { Actor } from './actor';
import { checkIntegrity } from './integrity';
import { str } from './input';

async function fy(companyId: number, fyId: number) {
  const [f] = await sql<{ id: number; start_date: string; end_date: string; closed: boolean }[]>`SELECT id, to_char(start_date,'YYYY-MM-DD') AS start_date, to_char(end_date,'YYYY-MM-DD') AS end_date, closed FROM fiscal_years WHERE id = ${fyId} AND company_id = ${companyId}`;
  if (!f) throw new NotFoundError('Räkenskapsåret');
  return f;
}

/** Kontrollerna för räkenskapsåret med kvitteringar */
export async function yearChecks(companyId: number, fyId: number) {
  const f = await fy(companyId, fyId);
  const balances = new Map((await sql<{ account: number; b: number }[]>`SELECT l.account_number AS account, SUM(l.debit - l.credit)::float8 AS b FROM voucher_lines l JOIN vouchers v ON v.id = l.voucher_id
    WHERE v.company_id = ${companyId} AND v.date <= ${f.end_date} AND l.account_number < 3000 GROUP BY l.account_number`).map((r) => [r.account, r.b]));
  const year = new Map([...await accountSums(companyId, f.start_date, f.end_date, { excludeVatSettlements: true })].map(([k, v]) => [k, Number(v)]));
  const last = new Map((await sql<{ account: number; d: string }[]>`SELECT l.account_number AS account, to_char(max(v.date),'YYYY-MM-DD') AS d FROM voucher_lines l JOIN vouchers v ON v.id = l.voucher_id
    WHERE v.company_id = ${companyId} AND v.date <= ${f.end_date} GROUP BY l.account_number`).map((r) => [r.account, r.d]));
  const names = new Map((await sql<{ number: number; name: string }[]>`SELECT number, name FROM accounts WHERE company_id = ${companyId}`).map((a) => [a.number, a.name]));
  const b = `/c/${companyId}`;
  const findings = qualityChecks({ end: f.end_date, balances, year, lastMovement: last, names }).map((x) => ({ ...x,
    href: x.key.startsWith('vat:') ? `${b}/rapporter/moms` : x.account ? `${b}/rapporter/huvudbok?account=${x.account}&from=${f.start_date}&to=${f.end_date}` : `${b}/rapporter` }));
  const { capitalWarning } = await import('./capital-control');
  const cw = await capitalWarning(companyId, f.end_date);
  if (cw) findings.unshift({ key: 'capital:deficit', level: 'error', title: 'Eget kapital understiger halva aktiekapitalet', detail: `Bokfört eget kapital ${(cw.equity / 100).toLocaleString('sv-SE')} kr, aktiekapital ${(cw.shareCapital / 100).toLocaleString('sv-SE')} kr`,
    action: 'Styrelsen ska genast upprätta en kontrollbalansräkning (aktiebolagslagen 25 kap.) och kalla till kontrollstämma om kapitalbristen kvarstår.', href: `${b}/kontrollbalans` });
  const { overview: loans } = await import('./owner-loans');
  const ol = await loans(companyId);
  if (ol.prohibited) findings.unshift({ key: 'loan:prohibited', level: 'error', title: 'Förbjudna lån till ägare eller närstående', detail: `Utestående ${(ol.prohibited / 100).toLocaleString('sv-SE')} kr`,
    action: 'Lånet ska återbetalas (aktiebolagslagen 21 kap.). Reglera det eller kvitta mot beslutad utdelning.', href: `${b}/lan-till-agare` });
  else if (ol.unregistered) findings.push({ key: 'loan:unregistered', level: 'warn', title: 'Fordran på delägare eller närstående (1685) utan registrerat lån', detail: `Saldo ${(ol.unregistered / 100).toLocaleString('sv-SE')} kr`,
    action: 'Registrera vem lånet avser så att låneförbudet kan bedömas.', href: `${b}/lan-till-agare` });
  for (const i of await checkIntegrity(companyId)) if (i.severity === 'error')
    findings.unshift({ key: `integrity:${i.key}`, level: 'error', title: i.title, detail: i.detail, action: 'Rätta verifikationen innan bokslutet – bokföringen måste vara hel.', href: i.href ?? `${b}/verifikationer` });
  const acks = await sql<{ key: string; note: string; by: string | null; at: string }[]>`SELECT a.key, a.note, u.name AS by, to_char(a.acked_at,'YYYY-MM-DD') AS at
    FROM quality_acks a LEFT JOIN users u ON u.id = a.acked_by WHERE a.company_id = ${companyId} AND a.fiscal_year_id = ${fyId}`;
  const ack = new Map(acks.map((a) => [a.key, a]));
  return { fy: f, findings: findings.map((x) => ({ ...x, ack: ack.get(x.key) ?? null })), summary: qcSummary(findings, new Set(ack.keys())) };
}

/** Kvitterar en avvikelse med en förklaring (t.ex. "Checkkredit, flyttas vid bokslut") – fel i bokföringens integritet kan inte kvitteras */
export async function acknowledge(actor: Actor, fyId: number, input: Record<string, unknown>) {
  await fy(actor.companyId, fyId);
  const key = str(input, 'key', { required: true, label: 'Kontroll', max: 200 });
  if (key.startsWith('integrity:')) throw new NotFoundError('Kontrollen');
  const { findings } = await yearChecks(actor.companyId, fyId);
  if (!findings.some((f) => f.key === key)) throw new NotFoundError('Kontrollen');
  const note = str(input, 'note', { required: true, label: 'Förklaring', max: 500 });
  await sql`INSERT INTO quality_acks ${sql({ company_id: actor.companyId, fiscal_year_id: fyId, key, note, acked_by: actor.userId })}
    ON CONFLICT (company_id, fiscal_year_id, key) DO UPDATE SET note = EXCLUDED.note, acked_by = EXCLUDED.acked_by, acked_at = now()`;
  await auditBy(sql, actor, 'quality_ack', 'fiscal_year', fyId, { key, note });
}

export async function unacknowledge(actor: Actor, fyId: number, key: string) {
  await fy(actor.companyId, fyId);
  await sql`DELETE FROM quality_acks WHERE company_id = ${actor.companyId} AND fiscal_year_id = ${fyId} AND key = ${key}`;
  await auditBy(sql, actor, 'quality_unack', 'fiscal_year', fyId, { key });
}
