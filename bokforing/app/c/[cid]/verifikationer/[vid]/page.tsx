import Link from 'next/link';
import { notFound } from 'next/navigation';
import { sql } from '@/lib/db';
import { requireCompany } from '@/lib/server/auth';
import { Flash, type SP } from '@/components/ui';
import { kr, today } from '@/lib/format';
import { reverse, uploadAttachment } from '../actions';

export const dynamic = 'force-dynamic';

const SOURCE: Record<string, string> = {
  invoice: 'Kundfaktura', invoice_payment: 'Inbetalning kundfaktura', supplier_invoice: 'Leverantörsfaktura',
  supplier_payment: 'Betalning leverantörsfaktura', payroll: 'Lönekörning', vat: 'Momsavräkning', bank: 'Bankavstämning', manual: 'Manuell', reversal: 'Rättelse',
};

export default async function VoucherPage({ params, searchParams }: { params: Promise<{ cid: string; vid: string }>; searchParams: SP }) {
  const { cid, vid } = await params;
  const { company } = await requireCompany(cid);
  const [v] = await sql<{ id: number; series: string; number: number; date: string; description: string; source_type: string; corrects_id: number | null; created_by: string; created_at: string }[]>`
    SELECT v.id, v.series, v.number, to_char(v.date,'YYYY-MM-DD') AS date, v.description, v.source_type, v.corrects_id,
      u.name AS created_by, to_char(v.created_at AT TIME ZONE 'Europe/Stockholm','YYYY-MM-DD HH24:MI') AS created_at
    FROM vouchers v JOIN users u ON u.id = v.created_by WHERE v.id = ${Number(vid)} AND v.company_id = ${company.id}`;
  if (!v) notFound();
  const lines = await sql<{ account_number: number; name: string | null; debit: number; credit: number; description: string; cc: string | null; project: string | null }[]>`
    SELECT l.account_number, a.name, l.debit, l.credit, l.description, cc.code AS cc, p.name AS project FROM voucher_lines l
    LEFT JOIN accounts a ON a.company_id = ${company.id} AND a.number = l.account_number
    LEFT JOIN cost_centers cc ON cc.id = l.cost_center_id LEFT JOIN projects p ON p.id = l.project_id WHERE l.voucher_id = ${v.id} ORDER BY l.id`;
  const files = await sql<{ id: number; filename: string }[]>`SELECT id, filename FROM attachments WHERE voucher_id = ${v.id} ORDER BY id`;
  const [corr] = await sql<{ id: number; label: string }[]>`SELECT id, series || number AS label FROM vouchers WHERE corrects_id = ${v.id}`;
  const [orig] = v.corrects_id ? await sql<{ id: number; label: string }[]>`SELECT id, series || number AS label FROM vouchers WHERE id = ${v.corrects_id}` : [];
  const b = `/c/${company.id}`;
  const d = lines.reduce((s, l) => s + l.debit, 0);
  const c = lines.reduce((s, l) => s + l.credit, 0);
  return (
    <>
      <h1>Verifikation {v.series}{v.number}</h1>
      <Flash searchParams={searchParams} />
      <div className="card">
        <div className="row">
          <div><div className="muted small">Datum</div>{v.date}</div>
          <div><div className="muted small">Typ</div>{SOURCE[v.source_type] ?? v.source_type}</div>
          <div><div className="muted small">Bokförd av</div>{v.created_by}, {v.created_at}</div>
        </div>
        <p style={{ marginBottom: 0 }}><b>{v.description}</b></p>
        {orig && <p className="small">Rättar <Link href={`${b}/verifikationer/${orig.id}`}>{orig.label}</Link></p>}
        {corr && <p className="small" style={{ color: 'var(--danger)' }}>Rättad genom <Link href={`${b}/verifikationer/${corr.id}`}>{corr.label}</Link></p>}
      </div>
      <table>
        <thead><tr><th>Konto</th><th>Namn</th><th>Text</th><th className="num">Debet</th><th className="num">Kredit</th></tr></thead>
        <tbody>
          {lines.map((l, i) => (
            <tr key={i}><td>{l.account_number}</td><td>{l.name}</td><td className="small">{l.description}{(l.cc || l.project) && <span className="muted">{l.description ? ' · ' : ''}{[l.cc && `KS ${l.cc}`, l.project && `Projekt ${l.project}`].filter(Boolean).join(' · ')}</span>}</td>
              <td className="num">{l.debit ? kr(l.debit) : ''}</td><td className="num">{l.credit ? kr(l.credit) : ''}</td></tr>
          ))}
          <tr className="sum"><td colSpan={3}>Summa</td><td className="num">{kr(d)}</td><td className="num">{kr(c)}</td></tr>
        </tbody>
      </table>

      <h2>Underlag</h2>
      {files.length === 0 ? <p className="muted">Inget digitalt underlag bifogat.</p> : (
        <ul>{files.map((f) => <li key={f.id}><a href={`${b}/underlag/${f.id}`} target="_blank">{f.filename}</a></li>)}</ul>
      )}
      <form action={uploadAttachment.bind(null, company.id, v.id)} className="row card">
        <label>Lägg till underlag<input type="file" name="file" accept="image/*,application/pdf" required /></label>
        <div style={{ flex: '0 0 auto' }}><button className="secondary">Ladda upp</button></div>
      </form>

      {!corr && v.source_type !== 'reversal' && (
        <>
          <h2>Rätta verifikationen</h2>
          <p className="muted small">Skapar en rättelseverifikation med omvända belopp. Bokför därefter en ny, korrekt verifikation.
            {v.source_type !== 'manual' && ' Obs! Verifikationen skapades automatiskt – rätta hellre via fakturan/lönekörningen om det är möjligt.'}</p>
          <form action={reverse.bind(null, company.id, v.id)} className="row card">
            <label>Datum<input type="date" name="date" defaultValue={today()} required /></label>
            <label style={{ flex: '3 1 300px' }}>Orsak<input name="reason" required placeholder="T.ex. fel konto" /></label>
            <div style={{ flex: '0 0 auto' }}><button className="danger">Bokför rättelse</button></div>
          </form>
        </>
      )}
    </>
  );
}
