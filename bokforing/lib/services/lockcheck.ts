import 'server-only';
import { sql } from '@/lib/db';
import { periodOf } from '@/lib/assets';

export interface LockCheck { key: string; ok: boolean; title: string; detail: string; href: string }

/** Kontroller innan perioden låses till och med ett datum */
export async function lockChecks(companyId: number, until: string): Promise<LockCheck[]> {
  const b = `/c/${companyId}`;
  const [c] = await sql<Record<string, number | string | null>[]>`SELECT
    (SELECT count(*)::int FROM bank_transactions WHERE company_id = ${companyId} AND status = 'unmatched' AND booking_date <= ${until}) AS bank,
    (SELECT count(*)::int FROM invoices WHERE company_id = ${companyId} AND status = 'draft' AND invoice_date <= ${until}) AS drafts,
    (SELECT count(*)::int FROM inbox_documents WHERE company_id = ${companyId} AND status IN ('ready','failed','pending')) AS inbox,
    (SELECT count(*)::int FROM vouchers v WHERE v.company_id = ${companyId} AND v.date <= ${until} AND v.date > COALESCE((SELECT locked_until FROM companies WHERE id = ${companyId}), '1900-01-01')
       AND v.source_type IN ('manual','receipt','supplier_invoice') AND NOT EXISTS (SELECT 1 FROM attachments a WHERE a.voucher_id = v.id)
       AND NOT EXISTS (SELECT 1 FROM attachments a JOIN supplier_invoices si ON si.id = a.supplier_invoice_id WHERE si.voucher_id = v.id)) AS no_attachment,
    (SELECT max(to_char(date,'YYYY-MM-DD')) FROM vouchers WHERE company_id = ${companyId} AND source_type = 'vat') AS last_vat,
    (SELECT count(*)::int FROM assets a WHERE a.company_id = ${companyId} AND a.status = 'active' AND a.dep_start <= ${until}
       AND COALESCE((SELECT max(period) FROM asset_depreciations d WHERE d.asset_id = a.id), '0000-00') < ${periodOf(until)}) AS depreciation,
    (SELECT count(*)::int FROM accruals x WHERE x.company_id = ${companyId} AND x.first_period <= ${periodOf(until)}
       AND (SELECT count(*) FROM accrual_postings p WHERE p.accrual_id = x.id AND p.period <= ${periodOf(until)}) <
           LEAST(x.months, (EXTRACT(YEAR FROM ${until}::date)::int * 12 + EXTRACT(MONTH FROM ${until}::date)::int) - (substr(x.first_period,1,4)::int * 12 + substr(x.first_period,6,2)::int) + 1)) AS accruals`;
  const n = (k: string) => Number(c[k] ?? 0);
  const lastVat = c.last_vat as string | null;
  return [
    { key: 'bank', ok: !n('bank'), title: 'Banken är avstämd', detail: n('bank') ? `${n('bank')} banktransaktioner till och med ${until} är inte avstämda` : 'Alla transaktioner är avstämda', href: `${b}/bank/avstamning` },
    { key: 'vat', ok: !!lastVat && lastVat >= until, title: 'Momsen är redovisad', detail: lastVat ? `Senaste momsavräkning ${lastVat}` : 'Ingen momsavräkning är bokförd', href: `${b}/rapporter/moms` },
    { key: 'drafts', ok: !n('drafts'), title: 'Inga fakturautkast i perioden', detail: n('drafts') ? `${n('drafts')} utkast är daterade i perioden` : 'Inga utkast', href: `${b}/fakturor` },
    { key: 'inbox', ok: !n('inbox'), title: 'Inkorgen är hanterad', detail: n('inbox') ? `${n('inbox')} leverantörsfakturor väntar i inkorgen` : 'Inkorgen är tom', href: `${b}/leverantorsfakturor/inkorg` },
    { key: 'attachments', ok: !n('no_attachment'), title: 'Underlag finns', detail: n('no_attachment') ? `${n('no_attachment')} verifikationer saknar underlag` : 'Alla verifikationer har underlag', href: `${b}/verifikationer` },
    { key: 'depreciation', ok: !n('depreciation'), title: 'Avskrivningar är bokförda', detail: n('depreciation') ? `${n('depreciation')} tillgångar saknar avskrivning till och med ${periodOf(until)}` : 'Avskrivningarna är bokförda', href: `${b}/anlaggningar` },
    { key: 'accruals', ok: !n('accruals'), title: 'Periodiseringar är bokförda', detail: n('accruals') ? `${n('accruals')} periodiseringar har månader kvar att bokföra` : 'Periodiseringarna är bokförda', href: `${b}/periodiseringar` },
  ];
}
