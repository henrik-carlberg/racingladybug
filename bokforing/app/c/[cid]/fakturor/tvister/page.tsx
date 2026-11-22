import Link from 'next/link';
import { requireCompany } from '@/lib/server/auth';
import { Flash, type SP } from '@/components/ui';
import { kr, today } from '@/lib/format';
import { overview } from '@/lib/services/disputes';
import { closeAction, openAction, settleAction } from './actions';

export const dynamic = 'force-dynamic';

const STATUS: Record<string, string> = { open: 'Pågår', settled: 'Förlikning', withdrawn: 'Avslutad', paid: 'Betald' };

export default async function Disputes({ params, searchParams }: { params: Promise<{ cid: string }>; searchParams: SP }) {
  const { cid } = await params;
  const { company } = await requireCompany(cid, { perm: 'invoicing' });
  const id = company.id;
  const { disputes, candidates } = await overview(id);
  const t = today();
  return (
    <div style={{ maxWidth: 1000 }}>
      <h1>Tvistiga fakturor</h1>
      <p className="small"><Link href={`/c/${id}/fakturor`}>← Fakturor</Link></p>
      <Flash searchParams={searchParams} />
      <p className="small">När kunden invänder mot en faktura pausas påminnelser, dröjsmålsränta, inkasso och betalningsföreläggande tills tvisten är avslutad.
        En förlikning bokförs som en nedsättning av priset: kunden betalar det avtalade beloppet och resten krediteras med momsreduktion (debet 3730 och 2611, kredit 1510).</p>
      <table className="dp-list"><thead><tr><th>Faktura</th><th>Kund</th><th>Sedan</th><th>Invändning</th><th className="num">Kvar</th><th>Status</th><th></th></tr></thead>
        <tbody>{disputes.map((d) => (
          <tr key={d.id} className="dp-row" data-number={d.number} data-status={d.status}><td><Link href={`/c/${id}/fakturor/${d.invoice_id}`}>{d.number}</Link></td><td>{d.customer}</td><td>{d.opened_on}</td><td className="small">{d.reason}</td>
            <td className="num dp-remaining">{kr(d.remaining)}</td>
            <td className="small">{STATUS[d.status]}{d.closed_on && ` ${d.closed_on}`}{d.status === 'settled' && <div>Betalt {kr(d.agreed_amount ?? 0)} kr, nedsatt {kr(d.reduction ?? 0)} kr</div>}</td>
            <td>{d.status === 'open' && <div className="stack" style={{ gap: '.25rem' }}>
              <form action={settleAction.bind(null, id, d.id)} className="row" style={{ gap: '.25rem' }}><input name="agreed" placeholder="Avtalat belopp" inputMode="decimal" style={{ width: '8rem' }} /><input type="date" name="date" defaultValue={t} /><button className="link">Förlikning</button></form>
              <form action={closeAction.bind(null, id, d.id)} className="row" style={{ gap: '.25rem' }}><input type="date" name="date" defaultValue={t} /><button className="link">Avsluta tvisten</button></form>
            </div>}</td></tr>))}
          {!disputes.length && <tr><td colSpan={7} className="muted">Inga tvister.</td></tr>}</tbody></table>
      <h2>Markera faktura som tvistig</h2>
      <form action={openAction.bind(null, id)} className="card stack">
        <div className="row">
          <label>Faktura<select name="invoice_id" required>{candidates.map((c) => <option key={c.id} value={c.id}>{c.number} – {c.customer} ({kr(c.remaining)} kr)</option>)}</select></label>
          <label>Datum<input type="date" name="date" defaultValue={t} required /></label>
        </div>
        <label>Vad kunden invänder<textarea name="reason" rows={2} maxLength={1000} required /></label>
        <div><button>Markera som tvistig</button></div>
      </form>
    </div>
  );
}
