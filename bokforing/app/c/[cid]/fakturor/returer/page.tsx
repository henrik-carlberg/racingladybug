import Link from 'next/link';
import { requireCompany } from '@/lib/server/auth';
import { Flash, type SP } from '@/components/ui';
import { kr, today } from '@/lib/format';
import { REASONS } from '@/lib/returns';
import { invoiceLines, overview } from '@/lib/services/returns';
import { creditAction, openAction, rejectAction, replaceAction } from './actions';

export const dynamic = 'force-dynamic';

const STATUS: Record<string, string> = { received: 'Mottagen – väntar på beslut', credited: 'Krediterad', replaced: 'Ersättningsvara', rejected: 'Avslagen' };

export default async function Returns({ params, searchParams }: { params: Promise<{ cid: string }>; searchParams: SP }) {
  const { cid } = await params;
  const sp = await searchParams;
  const { company } = await requireCompany(cid, { perm: 'invoicing' });
  const id = company.id;
  const { cases, invoices, stats } = await overview(id);
  const t = today();
  const pick = Number(sp.invoice) || 0;
  const sel = pick ? await invoiceLines(id, pick).catch(() => null) : null;
  const dispositions = (c: (typeof cases)[number]) => c.lines.filter((l) => l.product_id).map((l) => (
    <label key={l.id} className="small">{l.product}<select name={`disposition_${l.id}`} defaultValue="restock"><option value="restock">Tillbaka i lager</option><option value="scrap">Kassera</option></select></label>));
  return (
    <div style={{ maxWidth: 1050 }}>
      <h1>Returer och reklamationer</h1>
      <p className="small"><Link href={`/c/${id}/fakturor`}>← Fakturor</Link></p>
      <Flash searchParams={searchParams} />
      <p className="small">Registrera vad kunden skickar tillbaka och besluta om kreditering, ersättningsvara eller avslag. Kreditering blir ett kreditfakturautkast för de returnerade raderna med samma pris, moms och konto som fakturan.
        Varor som finns som artiklar i lagret tas tillbaka till genomsnittligt anskaffningsvärde eller kasseras; en ersättningsvara levereras ur lagret utan ny faktura.</p>

      <table className="rt-list"><thead><tr><th>Ärende</th><th>Faktura</th><th>Kund</th><th>Mottagen</th><th>Orsak</th><th>Rader</th><th className="num">Värde exkl. moms</th><th>Status</th><th></th></tr></thead>
        <tbody>{cases.map((c) => (
          <tr key={c.id} className="rt-row" data-status={c.status} data-number={c.number}><td>R-{c.id}</td><td><Link href={`/c/${id}/fakturor/${c.invoice_id}`}>{c.number}</Link></td><td>{c.customer}</td><td>{c.opened_on}</td>
            <td className="small">{REASONS[c.reason]}{c.note && <div className="muted">{c.note}</div>}</td>
            <td className="small">{c.lines.map((l) => <div key={l.id}>{l.quantity} {l.unit} {l.description}{l.disposition && ` (${l.disposition === 'restock' ? 'i lager' : 'kasserad'})`}</div>)}</td>
            <td className="num rt-value">{kr(c.value)}</td>
            <td className="small">{STATUS[c.status]}{c.closed_on && ` ${c.closed_on}`}{c.credit_invoice_id && <div><Link href={`/c/${id}/fakturor/${c.credit_invoice_id}`}>Kreditfaktura{c.credit_status === 'draft' ? ' (utkast)' : ''}</Link></div>}</td>
            <td>{c.status === 'received' && <div className="stack" style={{ gap: '.25rem' }}>
              <form action={creditAction.bind(null, id, c.id)} className="stack" style={{ gap: '.25rem' }}>{dispositions(c)}<div className="row" style={{ gap: '.25rem' }}><input type="date" name="date" defaultValue={t} /><button className="link">Kreditera</button></div></form>
              <form action={replaceAction.bind(null, id, c.id)} className="stack" style={{ gap: '.25rem' }}>{dispositions(c)}<div className="row" style={{ gap: '.25rem' }}><input type="date" name="date" defaultValue={t} /><button className="link">Skicka ersättningsvara</button></div></form>
              <form action={rejectAction.bind(null, id, c.id)} className="row" style={{ gap: '.25rem' }}><input name="note" placeholder="Motivering" required style={{ width: '9rem' }} /><input type="date" name="date" defaultValue={t} /><button className="link">Avslå</button></form>
            </div>}</td></tr>))}
          {!cases.length && <tr><td colSpan={9} className="muted">Inga returer.</td></tr>}</tbody></table>

      <h2>Ny retur</h2>
      <form method="get" className="row">
        <label>Faktura<select name="invoice" defaultValue={pick || ''}><option value="">Välj faktura</option>{invoices.map((i) => <option key={i.id} value={i.id}>{i.number} – {i.customer} ({i.date})</option>)}</select></label>
        <button className="secondary">Visa rader</button>
      </form>
      {sel && <form action={openAction.bind(null, id)} className="card stack">
        <input type="hidden" name="invoice_id" value={sel.invoice.id} />
        <p className="small">Faktura {sel.invoice.number}, {sel.invoice.customer}</p>
        <table><thead><tr><th>Rad</th><th className="num">Fakturerat</th><th className="num">Kan returneras</th><th>Returneras</th></tr></thead>
          <tbody>{sel.lines.map((l) => <tr key={l.id} className="rt-line" data-description={l.description}><td>{l.description}{l.product_id ? '' : <span className="muted small"> (ingen lagerartikel)</span>}</td><td className="num">{l.quantity} {l.unit}</td><td className="num">{l.left}</td>
            <td><input name={`qty_${l.id}`} inputMode="decimal" style={{ width: '5rem' }} disabled={!l.left} /></td></tr>)}</tbody></table>
        <div className="row">
          <label>Orsak<select name="reason">{Object.entries(REASONS).map(([k, v]) => <option key={k} value={k}>{v}</option>)}</select></label>
          <label>Mottagen<input type="date" name="date" defaultValue={t} required /></label>
        </div>
        <label>Kundens beskrivning<textarea name="note" rows={2} maxLength={1000} /></label>
        <div><button>Registrera retur</button></div>
      </form>}

      <h2>Reklamationsorsaker</h2>
      <table className="rt-stats"><thead><tr><th>Orsak</th><th className="num">Ärenden</th><th className="num">Returnerat värde</th><th className="num">Avslaget värde</th></tr></thead>
        <tbody>{stats.reasons.map((r) => <tr key={r.reason} data-reason={r.reason}><td>{r.label}</td><td className="num">{r.cases}</td><td className="num">{kr(r.value)}</td><td className="num">{kr(r.rejected)}</td></tr>)}
          {!stats.reasons.length && <tr><td colSpan={4} className="muted">Ingen statistik ännu.</td></tr>}</tbody></table>
      {stats.products.length > 0 && <><h3>Per artikel</h3>
        <table className="rt-products"><thead><tr><th>Artikel</th><th className="num">Ärenden</th><th className="num">Antal</th></tr></thead>
          <tbody>{stats.products.map((p) => <tr key={p.product} data-product={p.product}><td>{p.product}</td><td className="num">{p.cases}</td><td className="num">{p.qty}</td></tr>)}</tbody></table></>}
    </div>
  );
}
