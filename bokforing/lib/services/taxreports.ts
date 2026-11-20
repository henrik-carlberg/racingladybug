import 'server-only';
import { sql } from '@/lib/db';
import { NotFoundError, ValidationError } from '@/lib/errors';
import { accountSums, fiscalYears, openingBalances, type FiscalYear } from '@/lib/server/ledger';
import { auditBy } from '@/lib/server/audit';
import { ink2Form, neForm, sruBlankets, sruFields, sruInfo, type Sums } from '@/lib/taxforms';
import { taxPeriod } from '@/lib/deadlines';
import { agmMinutesHtml, annualReportHtml, keyFigures, simplifiedClosingHtml, type AnnualReportInput, type YearFigures } from '@/lib/annualreport';
import { agiId } from '@/lib/validate';
import type { Actor } from './actor';
import { createDocument, sendDocument } from './documents';
import { str } from './input';

async function company(companyId: number) {
  const [c] = await sql<{ name: string; orgnr: string; company_type: 'AB' | 'EF' | 'HB' | 'KB'; address: string; postal_code: string; city: string; email: string; phone: string }[]>`
    SELECT name, orgnr, company_type, address, postal_code, city, email, phone FROM companies WHERE id = ${companyId}`;
  return c;
}

/** Saldon för ett räkenskapsår. Om årets resultat inte är bokfört (8999) läggs det på eget kapital i utgående balans. */
export async function yearFigures(companyId: number, fy: FiscalYear, type: 'AB' | 'EF' | 'HB' | 'KB'): Promise<YearFigures> {
  const opening = await openingBalances(companyId, fy.start_date);
  const period = await accountSums(companyId, fy.start_date, fy.end_date);
  const result: Sums = new Map();
  const closing: Sums = new Map(opening);
  let pl = 0;
  for (const [n, v] of period) {
    if (n >= 3000) { result.set(n, v); if (n <= 8989) pl += v; }
    else closing.set(n, (closing.get(n) ?? 0) + v);
  }
  if (!(period.get(8999) ?? 0)) {
    const eq = type === 'AB' ? 2099 : 2019;
    closing.set(eq, (closing.get(eq) ?? 0) + pl);
  }
  const label = fy.start_date.slice(0, 4) === fy.end_date.slice(0, 4) ? fy.end_date.slice(0, 4) : `${fy.start_date.slice(0, 4)}/${fy.end_date.slice(2, 4)}`;
  return { label, start: fy.start_date, end: fy.end_date, result, closing, opening };
}

async function getFy(companyId: number, fyId: number) {
  const all = await fiscalYears(companyId);
  const fy = all.find((y) => y.id === fyId);
  if (!fy) throw new NotFoundError('Räkenskapsåret');
  return { fy, all };
}

export async function taxForms(companyId: number, fyId: number) {
  const c = await company(companyId);
  const { fy } = await getFy(companyId, fyId);
  const y = await yearFigures(companyId, fy, c.company_type);
  return c.company_type === 'AB'
    ? { type: 'AB' as const, fy, ink2: ink2Form(y.closing, y.result, y.opening), period: taxPeriod(fy.end_date) }
    : { type: 'EF' as const, fy, ne: neForm(y.closing, y.result), period: taxPeriod(fy.end_date) };
}

/** SRU-filer för filöverföring till Skatteverket. AB: INK2, INK2R, INK2S. EF: NE (bilaga till INK1). */
export async function sruFiles(companyId: number, fyId: number, userName: string): Promise<{ info: string; blankets: string; period: string }> {
  const c = await company(companyId);
  if (c.company_type === 'HB' || c.company_type === 'KB') throw new ValidationError('SRU-fil för INK4 skapas inte här – underlaget till INK4 och delägarnas N3B finns under Delägare');
  if (!c.postal_code || !c.city) throw new ValidationError('Fyll i bolagets postnummer och ort under Inställningar – de krävs i SRU-filen');
  const f = await taxForms(companyId, fyId);
  const ownerPnr = c.company_type === 'EF' ? (Number(c.orgnr.slice(0, 2)) > new Date().getFullYear() % 100 ? '19' : '20') + c.orgnr.replace(/\D/g, '') : undefined;
  const id = agiId(c.orgnr, c.company_type, ownerPnr);
  const info = sruInfo({ id, name: c.name, address: c.address, postalCode: c.postal_code, city: c.city, email: c.email, phone: c.phone, contact: userName });
  const base = { id, name: c.name, fyStart: f.fy.start_date, fyEnd: f.fy.end_date };
  const blankets = f.type === 'AB'
    ? sruBlankets([
        { ...base, form: `INK2-${f.period}`, fields: sruFields(f.ink2.page1) },
        { ...base, form: `INK2R-${f.period}`, fields: sruFields([...f.ink2.balance, ...f.ink2.income]) },
        { ...base, form: `INK2S-${f.period}`, fields: sruFields(f.ink2.adjustments) },
      ])
    : sruBlankets([{ ...base, form: `NE-${f.period}`, fields: sruFields([...f.ne.balance, ...f.ne.income, ...f.ne.adjustments]) }]);
  return { info, blankets, period: f.period };
}

// ---------- Årsredovisning / årsbokslut ----------

export interface YearendData { activity?: string; events?: string; dividend?: number; board?: { name: string; role: string }[]; place?: string; auditorWaived?: boolean }

export async function getYearendData(companyId: number, fyId: number): Promise<YearendData> {
  const [r] = await sql<{ data: YearendData }[]>`SELECT data FROM yearend_reports WHERE company_id = ${companyId} AND fiscal_year_id = ${fyId}`;
  return r?.data ?? {};
}

export async function saveYearendData(actor: Actor, fyId: number, data: YearendData) {
  await getFy(actor.companyId, fyId);
  if (data.dividend != null && (!Number.isInteger(data.dividend) || data.dividend < 0)) throw new ValidationError('Ogiltig utdelning');
  await sql`INSERT INTO yearend_reports (company_id, fiscal_year_id, data, updated_by) VALUES (${actor.companyId}, ${fyId}, ${sql.json(data as never)}, ${actor.userId})
    ON CONFLICT (company_id, fiscal_year_id) DO UPDATE SET data = EXCLUDED.data, updated_by = EXCLUDED.updated_by, updated_at = now()`;
  await auditBy(sql, actor, 'update', 'yearend_report', fyId);
}

/** Medelantal anställda: summan av antal anställda med lön per månad / antal månader i året */
async function averageEmployees(companyId: number, fy: FiscalYear): Promise<number> {
  const [r] = await sql<{ total: number }[]>`
    SELECT COALESCE(SUM(n), 0)::int AS total FROM (
      SELECT r.period, count(DISTINCT p.employee_id) AS n FROM payroll_runs r JOIN payslips p ON p.run_id = r.id
      WHERE r.company_id = ${companyId} AND r.status = 'booked' AND r.payment_date BETWEEN ${fy.start_date} AND ${fy.end_date} GROUP BY r.period) x`;
  const months = Math.round((Date.parse(fy.end_date) - Date.parse(fy.start_date)) / (30.44 * 86400_000));
  return Math.round(r.total / Math.max(months, 1));
}

export async function annualReport(companyId: number, fyId: number): Promise<{ html: string; data: YearendData; figures: ReturnType<typeof keyFigures>; input?: AnnualReportInput }> {
  const c = await company(companyId);
  const { fy, all } = await getFy(companyId, fyId);
  const data = await getYearendData(companyId, fyId);
  const earlier = all.filter((y) => y.end_date < fy.start_date).slice(0, 3); // fiscalYears är sorterade nyast först
  const years: YearFigures[] = [];
  for (const y of [fy, ...earlier]) {
    const fig = await yearFigures(companyId, y, c.company_type);
    if (y !== fy && fig.result.size === 0 && [...fig.closing.values()].every((v) => !v)) break;
    years.push(fig);
  }
  const [members] = await sql<{ names: string[] }[]>`SELECT array_agg(u.name ORDER BY u.name) AS names FROM memberships m JOIN users u ON u.id = m.user_id
    WHERE m.company_id = ${companyId} AND m.role = 'owner'`;
  const board = data.board?.length ? data.board : (members.names ?? []).map((n) => ({ name: n, role: 'Styrelseledamot' }));
  if (c.company_type === 'HB' || c.company_type === 'KB') {
    const { overview: partnerOverview } = await import('./partnership');
    const { partnershipClosingHtml } = await import('@/lib/annualreport');
    const po = await partnerOverview(companyId, fyId);
    return { html: partnershipClosingHtml({ company: c, type: c.company_type, years, partners: po.rows }), data, figures: keyFigures(years[0]) };
  }
  if (c.company_type === 'EF') {
    const ne = neForm(years[0].closing, years[0].result);
    return {
      html: simplifiedClosingHtml({ owner: board[0]?.name ?? '', company: c, fyStart: fy.start_date, fyEnd: fy.end_date, income: ne.income, balance: ne.balance }),
      data, figures: keyFigures(years[0]),
    };
  }
  const [fw] = await sql<{ f: string }[]>`SELECT accounting_framework AS f FROM companies WHERE id = ${companyId}`;
  let k3: AnnualReportInput['k3'];
  if (fw?.f === 'K3') {
    const { k3Extras } = await import('./k3');
    const x = await k3Extras(companyId, fyId);
    k3 = { ...x, untaxed: -[...years[0].closing].filter(([n]) => n >= 2100 && n <= 2199).reduce((s, [, v]) => s + v, 0) };
  }
  let brf: AnnualReportInput['brf'];
  const [of] = await sql<{ f: string | null }[]>`SELECT org_form AS f FROM companies WHERE id = ${companyId}`;
  if (of?.f === 'brf') { const { keyFigures: brfKeys } = await import('./brf'); brf = await brfKeys(companyId, Number(fy.end_date.slice(0, 4))); }
  const { leasingNote } = await import('./leasing');
  const leasing = await leasingNote(companyId, fy.end_date);
  const input: AnnualReportInput = {
    company: c, years, activity: data.activity ?? '', events: data.events ?? '', dividend: data.dividend ?? 0,
    board, employees: await averageEmployees(companyId, fy), place: data.place ?? c.city, k3, brf, leasing: leasing.total ? leasing : undefined,
  };
  return { html: annualReportHtml(input), data: { ...data, board }, figures: keyFigures(years[0]), input };
}

/** Skapar årsstämmoprotokoll och skickar det för e-signering (ordförande signerar inloggad, övriga via länk) */
export async function createAgmMinutes(actor: Actor, fyId: number, input: Record<string, unknown>, origin: string) {
  const c = await company(actor.companyId);
  if (c.company_type !== 'AB') throw new ValidationError('Årsstämma hålls bara i aktiebolag');
  const { fy } = await getFy(actor.companyId, fyId);
  const data = await getYearendData(actor.companyId, fyId);
  const y = await yearFigures(actor.companyId, fy, 'AB');
  const k = keyFigures(y);
  const retained = -[...y.closing].filter(([n]) => (n >= 2000 && n <= 2079) || (n >= 2090 && n <= 2099)).reduce((s, [, v]) => s + v, 0) - k.result;
  const [u] = await sql<{ name: string }[]>`SELECT name FROM users WHERE id = ${actor.userId}`;
  const board = (data.board ?? []).map((b) => b.name);
  const others = String(input.co_signers ?? '').split('\n').map((l) => l.trim()).filter(Boolean).map((l) => {
    const m = l.match(/^(.*?)[,;\s]+(\S+@\S+)$/);
    if (!m) throw new ValidationError(`Ange justerare som "Namn, e-post": ${l}`);
    return { name: m[1].trim(), email: m[2] };
  });
  const html = agmMinutesHtml({
    company: c, fyStart: fy.start_date, fyEnd: fy.end_date, date: str(input, 'date', { required: true, label: 'Datum' }), place: str(input, 'place') || c.city,
    chair: u.name, attendees: [u.name, ...others.map((o) => o.name)], result: k.result, retained, dividend: data.dividend ?? 0,
    board: board.length ? board : [u.name], auditorWaived: data.auditorWaived !== false,
  });
  const doc = await createDocument(actor, {
    title: `Årsstämmoprotokoll ${fy.end_date.slice(0, 4)} – ${c.name}`, html, source_module: 'bokslut', source_id: fyId,
    signers: [{ user_id: actor.userId, name: u.name }, ...others],
  });
  return sendDocument(actor, doc.id, origin);
}
