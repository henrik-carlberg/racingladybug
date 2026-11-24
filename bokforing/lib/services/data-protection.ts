import 'server-only';
import { sql } from '@/lib/db';
import { ConflictError, NotFoundError, ValidationError } from '@/lib/errors';
import { auditBy } from '@/lib/server/audit';
import { today } from '@/lib/format';
import { LEGAL_BASES, RISKS, closeBlockers, deadline, incidentDuties, type Risk } from '@/lib/data-protection';
import type { Actor } from './actor';
import { optInt, str } from './input';

type Incident = { id: number; discovered_at: Date; description: string; categories: string; subjects_count: number; risk: Risk; consequences: string; measures: string; reported_imy_at: Date | null; imy_ref: string; late_reason: string; subjects_informed_at: Date | null; closed_on: string | null };

export async function overview(companyId: number) {
  const activities = await sql<{ id: number; name: string; subjects: string; categories: string; purpose: string; legal_basis: keyof typeof LEGAL_BASES; recipients: string; retention: string; sensitive: boolean; third_country: boolean }[]>`
    SELECT id, name, subjects, categories, purpose, legal_basis, recipients, retention, sensitive, third_country FROM processing_activities WHERE company_id = ${companyId} ORDER BY name`;
  const rows = await sql<Incident[]>`SELECT id, discovered_at, description, categories, subjects_count, risk, consequences, measures, reported_imy_at, imy_ref, late_reason, subjects_informed_at, to_char(closed_on,'YYYY-MM-DD') AS closed_on
    FROM data_incidents WHERE company_id = ${companyId} ORDER BY closed_on NULLS FIRST, discovered_at DESC LIMIT 200`;
  const now = new Date();
  return { activities, incidents: rows.map((i) => ({ ...i, duties: incidentDuties(i.risk), deadline: deadline(i.discovered_at, now), blockers: closeBlockers(i) })) };
}

export async function addActivity(actor: Actor, input: Record<string, unknown>) {
  const basis = String(input.legal_basis);
  if (!Object.prototype.hasOwnProperty.call(LEGAL_BASES, basis)) throw new ValidationError('Välj rättslig grund');
  const sensitive = input.sensitive === 'on';
  if (sensitive && basis === 'legitimate') throw new ValidationError('Känsliga personuppgifter kan inte behandlas med stöd av berättigat intresse – ange undantag enligt art. 9.2 och en annan grund');
  await sql`INSERT INTO processing_activities ${sql({ company_id: actor.companyId, name: str(input, 'name', { required: true, label: 'Behandling', max: 150 }), subjects: str(input, 'subjects', { required: true, label: 'Registrerade', max: 300 }),
    categories: str(input, 'categories', { required: true, label: 'Personuppgifter', max: 500 }), purpose: str(input, 'purpose', { max: 500 }), legal_basis: basis, recipients: str(input, 'recipients', { max: 300 }),
    retention: str(input, 'retention', { max: 200 }), sensitive, third_country: input.third_country === 'on', created_by: actor.userId })}`;
  await auditBy(sql, actor, 'processing_activity', 'company', actor.companyId, {});
}

/** Incidenten registreras när den upptäcks; 72-timmarsfristen räknas därifrån */
export async function addIncident(actor: Actor, input: Record<string, unknown>) {
  const risk = String(input.risk) as Risk;
  if (!Object.prototype.hasOwnProperty.call(RISKS, risk)) throw new ValidationError('Bedöm risken för de registrerade');
  const at = String(input.discovered_at ?? '').trim();
  const discovered = at ? new Date(at) : new Date();
  if (Number.isNaN(discovered.getTime()) || discovered.getTime() > Date.now() + 60e3) throw new ValidationError('Ogiltig tidpunkt för upptäckten');
  const count = optInt(input, 'subjects_count') ?? 0;
  if (count < 0) throw new ValidationError('Ogiltigt antal registrerade');
  const [r] = await sql<{ id: number }[]>`INSERT INTO data_incidents ${sql({ company_id: actor.companyId, discovered_at: discovered, description: str(input, 'description', { required: true, label: 'Vad hände', max: 2000 }),
    categories: str(input, 'categories', { max: 500 }), subjects_count: count, risk, consequences: str(input, 'consequences', { max: 1000 }), measures: str(input, 'measures', { max: 1000 }), created_by: actor.userId })} RETURNING id`;
  await auditBy(sql, actor, 'data_incident', 'data_incident', r.id, { risk });
  return incidentDuties(risk);
}

const ownOpen = async (actor: Actor, id: number) => {
  const [i] = await sql<Incident[]>`SELECT id, discovered_at, description, categories, subjects_count, risk, consequences, measures, reported_imy_at, imy_ref, late_reason, subjects_informed_at, to_char(closed_on,'YYYY-MM-DD') AS closed_on
    FROM data_incidents WHERE id = ${id} AND company_id = ${actor.companyId}`;
  if (!i) throw new NotFoundError('Incidenten');
  if (i.closed_on) throw new ConflictError('Incidenten är avslutad');
  return i;
};

export async function update(actor: Actor, id: number, input: Record<string, unknown>) {
  const i = await ownOpen(actor, id);
  const imy = input.reported_imy === 'on' && !i.reported_imy_at, informed = input.informed === 'on' && !i.subjects_informed_at;
  const measures = str(input, 'measures', { max: 1000 }) || i.measures, lateReason = str(input, 'late_reason', { max: 1000 }) || i.late_reason;
  const ref = str(input, 'imy_ref', { max: 60 }) || i.imy_ref;
  await sql`UPDATE data_incidents SET measures = ${measures}, late_reason = ${lateReason}, imy_ref = ${ref},
    reported_imy_at = ${imy ? new Date() : i.reported_imy_at}, subjects_informed_at = ${informed ? new Date() : i.subjects_informed_at} WHERE id = ${id}`;
  await auditBy(sql, actor, 'data_incident_update', 'data_incident', id, { imy, informed });
}

export async function close(actor: Actor, id: number) {
  const i = await ownOpen(actor, id);
  const b = closeBlockers(i);
  if (b.length) throw new ValidationError(`Komplettera innan incidenten avslutas: ${b.join(', ')}`);
  await sql`UPDATE data_incidents SET closed_on = ${today()} WHERE id = ${id}`;
  await auditBy(sql, actor, 'data_incident_closed', 'data_incident', id, {});
}
