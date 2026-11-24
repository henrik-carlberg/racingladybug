import 'server-only';
import { sql } from '@/lib/db';
import { ConflictError, NotFoundError, ValidationError } from '@/lib/errors';
import { auditBy } from '@/lib/server/audit';
import { today } from '@/lib/format';
import { FREQUENCIES, KINDS, matrix, periodOf, riskScore, status, type Frequency } from '@/lib/internal-control';
import type { Actor } from './actor';
import { int, optInt, str } from './input';

export async function overview(companyId: number) {
  const t = today(), year = t.slice(0, 4);
  const risks = await sql<{ id: number; area: string; description: string; likelihood: number; impact: number; owner: string }[]>`SELECT id, area, description, likelihood, impact, owner FROM ic_risks WHERE company_id = ${companyId} ORDER BY likelihood * impact DESC, id`;
  const controls = await sql<{ id: number; risk_id: number | null; name: string; kind: keyof typeof KINDS; frequency: Frequency; owner: string; start_period: string }[]>`SELECT id, risk_id, name, kind, frequency, owner, start_period FROM ic_controls WHERE company_id = ${companyId} AND active ORDER BY name`;
  const runs = controls.length ? await sql<{ control_id: number; period: string; performed_on: string; ok: boolean; deviation: string }[]>`SELECT control_id, period, to_char(performed_on,'YYYY-MM-DD') AS performed_on, ok, deviation FROM ic_runs WHERE company_id = ${companyId} AND control_id IN ${sql(controls.map((c) => c.id))} ORDER BY performed_on DESC, id DESC` : [];
  const list = controls.map((c) => {
    const own = runs.filter((r) => r.control_id === c.id);
    return { ...c, runs: own.slice(0, 6), ...status(c.frequency, c.start_period, own.map((r) => r.period), t), deviationsYtd: own.filter((r) => !r.ok && r.performed_on.startsWith(year)).length };
  });
  return {
    risks: risks.map((r) => ({ ...r, ...riskScore(r.likelihood, r.impact), controls: list.filter((c) => c.risk_id === r.id).length })),
    matrix: matrix(risks), controls: list,
    summary: { controls: list.length, missing: list.filter((c) => c.missing).length, deviations: list.reduce((s, c) => s + c.deviationsYtd, 0), uncovered: risks.filter((r) => riskScore(r.likelihood, r.impact).level !== 'low' && !list.some((c) => c.risk_id === r.id)).length },
  };
}

const scale = (input: Record<string, unknown>, k: string, label: string) => { const v = int(input, k, label); if (v < 1 || v > 5) throw new ValidationError(`${label} ska vara 1–5`); return v; };

export async function addRisk(actor: Actor, input: Record<string, unknown>) {
  await sql`INSERT INTO ic_risks ${sql({ company_id: actor.companyId, area: str(input, 'area', { required: true, label: 'Område', max: 100 }), description: str(input, 'description', { required: true, label: 'Risk', max: 500 }),
    likelihood: scale(input, 'likelihood', 'Sannolikhet'), impact: scale(input, 'impact', 'Konsekvens'), owner: str(input, 'owner', { max: 100 }), created_by: actor.userId })}`;
}

export async function addControl(actor: Actor, input: Record<string, unknown>) {
  const kind = String(input.kind), freq = String(input.frequency) as Frequency;
  if (!Object.prototype.hasOwnProperty.call(KINDS, kind)) throw new ValidationError('Välj typ av kontroll');
  if (!Object.prototype.hasOwnProperty.call(FREQUENCIES, freq)) throw new ValidationError('Välj frekvens');
  const riskId = optInt(input, 'risk_id');
  if (riskId) { const [r] = await sql`SELECT 1 FROM ic_risks WHERE id = ${riskId} AND company_id = ${actor.companyId}`; if (!r) throw new NotFoundError('Risken'); }
  await sql`INSERT INTO ic_controls ${sql({ company_id: actor.companyId, risk_id: riskId ?? null, name: str(input, 'name', { required: true, label: 'Kontroll', max: 150 }), kind, frequency: freq,
    owner: str(input, 'owner', { max: 100 }), start_period: String(input.start_period ?? '').trim() || periodOf(freq, today()), created_by: actor.userId })}`;
}

/** Utförd kontroll för en period, med eller utan avvikelse */
export async function perform(actor: Actor, controlId: number, input: Record<string, unknown>) {
  const [c] = await sql<{ frequency: Frequency }[]>`SELECT frequency FROM ic_controls WHERE id = ${controlId} AND company_id = ${actor.companyId} AND active`;
  if (!c) throw new NotFoundError('Kontrollen');
  const period = String(input.period ?? '').trim();
  const valid = c.frequency === 'monthly' ? /^\d{4}-(0[1-9]|1[0-2])$/ : c.frequency === 'quarterly' ? /^\d{4}-K[1-4]$/ : /^\d{4}$/;
  if (!valid.test(period)) throw new ValidationError('Ogiltig period');
  if (period > periodOf(c.frequency, today())) throw new ValidationError('Perioden har inte börjat än');
  const ok = input.result !== 'deviation';
  const deviation = str(input, 'deviation', { max: 1000 });
  if (!ok && !deviation) throw new ValidationError('Beskriv avvikelsen');
  try {
    await sql`INSERT INTO ic_runs ${sql({ control_id: controlId, company_id: actor.companyId, period, performed_on: today(), ok, deviation, created_by: actor.userId })}`;
  } catch (e) { if (String((e as Error).message).includes('ic_runs_control_id_period_key')) throw new ConflictError('Kontrollen är redan utförd för perioden'); throw e; }
  await auditBy(sql, actor, 'ic_run', 'ic_control', controlId, { period, ok });
  return { period, ok };
}
