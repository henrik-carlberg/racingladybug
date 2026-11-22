import Link from 'next/link';
import { requireCompany } from '@/lib/server/auth';
import { Flash, type SP } from '@/components/ui';
import { kr, today } from '@/lib/format';
import { overview } from '@/lib/services/recurring-supplier';
import { addTemplate, create, toggle } from './actions';

export const dynamic = 'force-dynamic';
const COLOR: Record<string, string> = { missing: 'var(--danger)', deviation: 'var(--warn)', received: 'var(--ok, inherit)', upcoming: 'inherit' };

/** Återkommande leverantörsfakturor med bevakning */
export default async function Recurring({ params, searchParams }: { params: Promise<{ cid: string }>; searchParams: SP }) {
  const { cid } = await params;
  const { company } = await requireCompany(cid, { perm: 'purchasing' });
  const o = await overview(company.id);
  const b = `/c/${company.id}`;
  return (
    <div style={{ maxWidth: 1100 }}>
      <p><Link href={`${b}/leverantorsfakturor`}>← Leverantörsfakturor</Link></p>
      <h1>Återkommande leverantörsfakturor</h1>
      <Flash searchParams={searchParams} />
      <p className="small">Lägg upp hyra, leasing, abonnemang och andra löpande kostnader som mallar. Varje månad bevakas att fakturan har kommit in och att beloppet stämmer (högst 5 % avvikelse).
        Skickar leverantören ingen faktura varje månad (t.ex. hyra enligt avtal) kan månadens faktura skapas från mallen och attesteras som vanligt.</p>
      <div className="grid">
        <div className="card stat"><div className="label">Saknade fakturor</div><div className="value rs-missing">{o.missing}</div></div>
        <div className="card stat"><div className="label">Avvikande belopp</div><div className="value rs-deviation">{o.deviations}</div></div>
      </div>
      {o.rows.map((r) => (
        <section key={r.id} className="card stack rs-template" data-desc={r.description} style={{ margin: '1rem 0' }}>
          <h3 style={{ margin: 0 }}>{r.supplier}: {r.description} <span className="small muted">{kr(r.total)} kr/mån · konto {r.account} · förfaller den {r.due_day} · {r.start_period}{r.end_period ? `–${r.end_period}` : ' och framåt'}{r.active ? '' : ' · pausad'}</span></h3>
          <div className="row" style={{ flexWrap: 'wrap' }}>{r.months.map((m) => (
            <div key={m.period} className={`small rs-month rs-${m.status}`} data-period={m.period} style={{ color: COLOR[m.status], minWidth: '9rem' }}>
              <b>{m.period}</b> {m.label}{m.actual != null ? ` (${kr(m.actual)})` : ''}
              {m.invoiceId ? <> · <Link href={`${b}/leverantorsfakturor/${m.invoiceId}`}>faktura</Link></> : r.active && <form action={create.bind(null, company.id, r.id, m.period)} style={{ display: 'inline' }}><button className="link">Skapa från mallen</button></form>}
            </div>))}</div>
          <form action={toggle.bind(null, company.id, r.id, !r.active)}><button className="link">{r.active ? 'Pausa' : 'Aktivera'}</button></form>
        </section>
      ))}
      <form action={addTemplate.bind(null, company.id)} className="card row">
        <label>Leverantör<select name="supplier_id" required>{o.suppliers.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}</select></label>
        <label>Beskrivning<input name="description" required maxLength={200} placeholder="T.ex. Hyra kontor" /></label>
        <label>Belopp inkl. moms (kr)<input name="total" required style={{ width: '8rem' }} /></label>
        <label>Varav moms (kr)<input name="vat" defaultValue="0" style={{ width: '7rem' }} /></label>
        <label>Konto<input name="account" required defaultValue="5010" style={{ width: '5rem' }} /></label>
        <label>Förfallodag<input name="due_day" defaultValue="25" style={{ width: '4rem' }} /></label>
        <label>Från månad<input type="month" name="start_period" defaultValue={today().slice(0, 7)} /></label>
        <label>Till månad<input type="month" name="end_period" /></label>
        <div style={{ flex: '0 0 auto' }}><button>Spara mall</button></div>
      </form>
    </div>
  );
}
