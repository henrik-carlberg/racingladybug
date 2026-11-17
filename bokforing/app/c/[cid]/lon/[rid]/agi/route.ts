import { sql } from '@/lib/db';
import { requireCompany } from '@/lib/server/auth';
import { buildAgiXml } from '@/lib/agi';
import { agiId } from '@/lib/validate';

export async function GET(_req: Request, { params }: { params: Promise<{ cid: string; rid: string }> }) {
  const { cid, rid } = await params;
  const { company, user } = await requireCompany(cid);
  const [run] = await sql<{ period: string; status: string }[]>`SELECT period, status FROM payroll_runs WHERE id = ${Number(rid)} AND company_id = ${company.id}`;
  if (!run) return new Response('Hittades inte', { status: 404 });
  if (run.status !== 'booked') return new Response('Lönekörningen måste bokföras innan AGI kan skapas', { status: 400 });
  // Summera alla bokförda körningar med samma redovisningsperiod (en per period i dagsläget)
  const slips = await sql<{ personal_number: string; gross: number; benefits: number; tax: number; fee: number }[]>`
    SELECT e.personal_number, SUM(p.gross_cash)::bigint AS gross, SUM(p.benefits)::bigint AS benefits, SUM(p.tax)::bigint AS tax, SUM(p.employer_fee)::bigint AS fee
    FROM payslips p JOIN employees e ON e.id = p.employee_id JOIN payroll_runs r ON r.id = p.run_id
    WHERE r.company_id = ${company.id} AND r.period = ${run.period} AND r.status = 'booked'
    GROUP BY e.personal_number ORDER BY e.personal_number`;
  const ownerPnr = company.company_type === 'EF'
    ? (Number(company.orgnr.slice(0, 2)) > new Date().getFullYear() % 100 ? '19' : '20') + company.orgnr.replace(/\D/g, '')
    : undefined;
  if (!company.phone) return new Response('Ange telefonnummer under Inställningar – det krävs som kontaktuppgift i AGI.', { status: 400 });
  try {
    const xml = buildAgiXml({
      period: run.period,
      employer: { agId: agiId(company.orgnr, company.company_type, ownerPnr), contactName: user.name, contactPhone: company.phone, contactEmail: user.email },
      individuals: slips.map((s) => ({ personalNumber: s.personal_number, specNumber: 1, grossCash: s.gross, benefits: s.benefits, tax: s.tax })),
      totalEmployerFees: slips.reduce((a, s) => a + s.fee, 0),
      totalTax: slips.reduce((a, s) => a + s.tax, 0),
      programName: 'Bokforing',
    });
    return new Response(xml, {
      headers: { 'Content-Type': 'application/xml; charset=utf-8', 'Content-Disposition': `attachment; filename="AGI_${run.period}.xml"` },
    });
  } catch (e) {
    return new Response(e instanceof Error ? e.message : 'Fel', { status: 400 });
  }
}
