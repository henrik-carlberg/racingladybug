import 'server-only';
import { sql } from '@/lib/db';
import { addDays, today } from '@/lib/format';
import { companyDeadlines } from './deadlines';
import { likelyLate } from './forecast';

export interface Todo { key: string; title: string; count: number; href: string; level: 'danger' | 'warn' | 'info' }

/** Allt som väntar på någon i bolaget – visas på översikten och som siffra i menyn */
export async function companyTodos(companyId: number, opts: { modules: string[]; owner: boolean; userId: number }): Promise<Todo[]> {
  const t = today();
  const b = `/c/${companyId}`;
  const has = (m: string) => opts.modules.includes(m);
  const [c] = await sql<Record<string, number | boolean>[]>`
    SELECT
      (SELECT count(*)::int FROM supplier_invoices WHERE company_id = ${companyId} AND status = 'booked') AS attest,
      (SELECT count(*)::int FROM invoices WHERE company_id = ${companyId} AND reduction_status = 'to_request') AS rotrut,
      (SELECT count(*)::int FROM client_questions WHERE company_id = ${companyId} AND status = 'open' AND asked_by IS DISTINCT FROM ${opts.userId} AND NOT needs_document) AS questions,
      (SELECT count(*)::int FROM client_questions WHERE company_id = ${companyId} AND status = 'open' AND asked_by IS DISTINCT FROM ${opts.userId} AND needs_document) AS documents,
      (SELECT count(*)::int FROM comment_mentions m JOIN comments cm ON cm.id = m.comment_id WHERE m.user_id = ${opts.userId} AND m.seen_at IS NULL AND cm.company_id = ${companyId}) AS mentions,
      (SELECT count(*)::int FROM client_questions WHERE company_id = ${companyId} AND status = 'answered' AND asked_by = ${opts.userId}) AS answers,
      (SELECT count(*)::int FROM invoice_checkouts WHERE company_id = ${companyId} AND status = 'mismatch') AS card_issues,
      (SELECT count(*)::int FROM inbox_documents WHERE company_id = ${companyId} AND status IN ('ready','failed')) AS inbox,
      (SELECT count(*)::int FROM supplier_invoices WHERE company_id = ${companyId} AND status = 'approved' AND due_date <= ${addDays(t, 7)}) AS pay,
      (SELECT count(*)::int FROM invoices WHERE company_id = ${companyId} AND status = 'booked' AND due_date < ${t}) AS overdue,
      (SELECT count(*)::int FROM invoices WHERE company_id = ${companyId} AND status = 'draft') AS drafts,
      (SELECT count(*)::int FROM bank_transactions WHERE company_id = ${companyId} AND status = 'unmatched') AS bank,
      (SELECT count(*)::int FROM absences WHERE company_id = ${companyId} AND status = 'requested') AS absence,
      (SELECT count(*)::int FROM exp_claims WHERE company_id = ${companyId} AND status = 'submitted') AS claims,
      (SELECT count(*)::int FROM res_bookings WHERE company_id = ${companyId} AND status = 'pending' AND ends_at > now()) AS bookings,
      (SELECT dpa_accepted_at IS NULL FROM companies WHERE id = ${companyId}) AS no_dpa,
      (SELECT totp_enabled_at IS NULL FROM users WHERE id = ${opts.userId})
        AND NOT EXISTS (SELECT 1 FROM passkeys WHERE user_id = ${opts.userId}) AS no_mfa`;
  const late = (await likelyLate(companyId).catch(() => [])).length;
  const deadlines = (await companyDeadlines(companyId)).filter((d) => d.status === 'overdue' || d.status === 'soon');
  const n = (k: string) => Number(c[k] ?? 0);
  const list: (Todo | false)[] = [
    deadlines.some((d) => d.status === 'overdue') && { key: 'deadline', title: 'Försenade deadlines', count: deadlines.filter((d) => d.status === 'overdue').length, href: `${b}/deadlines`, level: 'danger' },
    n('overdue') > 0 && { key: 'overdue', title: 'Förfallna kundfakturor', count: n('overdue'), href: has('reskontra') ? `${b}/m/reskontra` : `${b}/fakturor`, level: 'danger' },
    n('pay') > 0 && { key: 'pay', title: 'Leverantörsfakturor att betala inom en vecka', count: n('pay'), href: `${b}/leverantorsfakturor/betalning`, level: 'warn' },
    n('documents') > 0 && { key: 'documents', title: 'Underlag att skicka in', count: n('documents'), href: `${b}/fragor`, level: 'warn' },
    n('mentions') > 0 && { key: 'mentions', title: 'Kommentarer där du nämns', count: n('mentions'), href: `${b}/kommentarer`, level: 'warn' },
    n('questions') > 0 && { key: 'questions', title: 'Frågor att svara på', count: n('questions'), href: `${b}/fragor`, level: 'warn' },
    n('answers') > 0 && { key: 'answers', title: 'Nya svar på dina frågor', count: n('answers'), href: `${b}/fragor`, level: 'info' },
    n('card_issues') > 0 && { key: 'card_issues', title: 'Kortbetalningar att kontrollera', count: n('card_issues'), href: `${b}/installningar/betalningar`, level: 'warn' },
    n('rotrut') > 0 && { key: 'rotrut', title: 'ROT/RUT att begära från Skatteverket', count: n('rotrut'), href: `${b}/fakturor/rotrut`, level: 'warn' },
    n('inbox') > 0 && { key: 'inbox', title: 'Fakturor i inkorgen att granska', count: n('inbox'), href: `${b}/leverantorsfakturor/inkorg`, level: 'warn' },
    n('attest') > 0 && { key: 'attest', title: 'Leverantörsfakturor att attestera', count: n('attest'), href: `${b}/leverantorsfakturor`, level: 'warn' },
    has('utlagg') && n('claims') > 0 && { key: 'claims', title: 'Utläggsräkningar att attestera', count: n('claims'), href: `${b}/m/utlagg`, level: 'warn' },
    n('absence') > 0 && { key: 'absence', title: 'Ledighetsansökningar', count: n('absence'), href: `${b}/lon/franvaro`, level: 'warn' },
    has('resurser') && n('bookings') > 0 && { key: 'bookings', title: 'Bokningar att godkänna', count: n('bookings'), href: `${b}/m/resurser`, level: 'warn' },
    n('bank') > 0 && { key: 'bank', title: 'Banktransaktioner att stämma av', count: n('bank'), href: `${b}/bank/avstamning`, level: 'info' },
    late > 0 && { key: 'likely_late', title: 'Fakturor som troligen blir sena (kunden brukar betala sent)', count: late, href: has('reskontra') ? `${b}/m/reskontra` : `${b}/fakturor?status=booked`, level: 'info' },
    n('drafts') > 0 && { key: 'drafts', title: 'Fakturautkast', count: n('drafts'), href: `${b}/fakturor`, level: 'info' },
    deadlines.some((d) => d.status === 'soon') && { key: 'soon', title: 'Deadlines inom två veckor', count: deadlines.filter((d) => d.status === 'soon').length, href: `${b}/deadlines`, level: 'info' },
    opts.owner && c.no_dpa === true && { key: 'dpa', title: 'Godkänn personuppgiftsbiträdesavtalet', count: 1, href: `${b}/installningar/gdpr`, level: 'info' },
    c.no_mfa === true && { key: 'mfa', title: 'Slå på tvåstegsverifiering för ditt konto', count: 1, href: '/konto', level: 'info' },
  ];
  return list.filter((x): x is Todo => !!x);
}

/** Antal saker som kräver handling (exkl. tips) – siffran i menyn */
export const urgentCount = (todos: Todo[]) => todos.filter((x) => x.level !== 'info').reduce((s, x) => s + x.count, 0);
