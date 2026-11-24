import Link from 'next/link';
import { requireCompany } from '@/lib/server/auth';
import { Flash, type SP } from '@/components/ui';
import { kr, today } from '@/lib/format';
import { COST_KINDS, KINDS } from '@/lib/ip-rights';
import { halfPriceBase } from '@/lib/small-assets';
import { overview } from '@/lib/services/ip-rights';
import { addAction, costAction, lapseAction } from './actions';

export const dynamic = 'force-dynamic';

export default async function IpRights({ params, searchParams }: { params: Promise<{ cid: string }>; searchParams: SP }) {
  const { cid } = await params;
  const { company } = await requireCompany(cid, { perm: 'ledger' });
  const id = company.id;
  const { rights } = await overview(id);
  const t = today();
  return (
    <div style={{ maxWidth: 1100 }}>
      <h1>Immateriella rättigheter</h1>
      <Flash searchParams={searchParams} />
      <p className="small">Varumärken, patent, domäner och designskydd med registreringsnummer och förnyelsedatum. Ett varumärke skyddas i tio år åt gången och kan förnyas sex månader före och efter (med tilläggsavgift); patent och domäner har årsavgifter.
        Egna ansöknings-, förnyelse- och ombudskostnader kostnadsförs direkt. En köpt rättighet aktiveras som immateriell anläggningstillgång om utgiften är minst ett halvt prisbasbelopp ({kr(halfPriceBase(Number(t.slice(0, 4))))} kr) och skrivs av i <Link href={`/c/${id}/anlaggningar`}>anläggningsregistret</Link>.</p>
      {rights.filter((r) => r.renewal?.due || r.renewal?.overdue).map((r) => <div key={r.id} className="card small ip-renewal" data-name={r.name}>
        {KINDS[r.kind].label} {r.name} {r.renewal!.overdue ? <>skulle ha förnyats {r.renewal_date}{r.renewal!.grace && r.renewal!.grace >= t ? ` – kan fortfarande förnyas till ${r.renewal!.grace} mot tilläggsavgift` : ' – skyddet har löpt ut'}</> : <>förnyas {r.renewal_date} (om {r.renewal!.days} dagar){r.renewal!.opensOn ? `, kan förnyas från ${r.renewal!.opensOn}` : ''}</>}</div>)}
      <table className="ip-list"><thead><tr><th>Rättighet</th><th>Registrering</th><th>Förnyas</th><th className="num">Kostnadsfört</th><th className="num">Aktiverat</th><th>Ny utgift</th></tr></thead>
        <tbody>{rights.map((r) => (
          <tr key={r.id} className="ip-row" data-name={r.name} data-status={r.status}><td>{r.name}<div className="small muted">{KINDS[r.kind].label}{r.territory && ` · ${r.territory}`}</div></td>
            <td className="small">{r.registration_no}{r.registry && <div>{r.registry}</div>}{r.registered_on && <div className="muted">registrerad {r.registered_on}</div>}</td>
            <td className="small ip-renewal-date">{r.status === 'active' ? r.renewal_date ?? '–' : <>upphörd {r.lapsed_on}{r.asset_active && <div>Utrangera tillgången i anläggningsregistret</div>}</>}</td>
            <td className="num ip-expensed">{kr(r.expensed)}</td><td className="num ip-capitalized">{kr(r.capitalized)}</td>
            <td>{r.status === 'active' && <><form action={costAction.bind(null, id, r.id)} className="stack" style={{ gap: '.25rem' }}>
              <div className="row" style={{ gap: '.25rem' }}><select name="kind">{Object.entries(COST_KINDS).map(([k, v]) => <option key={k} value={k}>{v}</option>)}</select><input name="amount" placeholder="Belopp exkl. moms" inputMode="decimal" style={{ width: '8rem' }} /></div>
              <div className="row" style={{ gap: '.25rem' }}><input type="date" name="date" defaultValue={t} /><select name="credit_account"><option value="1930">Betald från 1930</option><option value="2440">Obetald (2440)</option></select>
                <select name="treatment" aria-label="Bokföring"><option value="">Automatiskt</option><option value="expensed">Kostnadsför</option><option value="capitalized">Aktivera</option></select><button className="link">Bokför</button></div></form>
              <form action={lapseAction.bind(null, id, r.id)}><button className="link">Upphört</button></form></>}
              {r.costs.length > 0 && <ul className="small ip-costs">{r.costs.map((c, i) => <li key={i}>{c.date} {COST_KINDS[c.kind]}: {kr(c.amount)} kr på {c.account}{c.voucher_id && <> (<Link href={`/c/${id}/verifikationer/${c.voucher_id}`}>ver</Link>)</>}</li>)}</ul>}</td></tr>))}
          {!rights.length && <tr><td colSpan={6} className="muted">Inga rättigheter registrerade.</td></tr>}</tbody></table>

      <h2>Ny rättighet</h2>
      <form action={addAction.bind(null, id)} className="card stack ip-add">
        <div className="row">
          <label>Typ<select name="kind">{Object.entries(KINDS).map(([k, v]) => <option key={k} value={k}>{v.label}</option>)}</select></label>
          <label>Benämning<input name="name" required maxLength={200} placeholder="Varumärke, uppfinning eller domännamn" /></label>
          <label>Registreringsnummer<input name="registration_no" maxLength={60} /></label>
          <label>Register<input name="registry" maxLength={100} placeholder="PRV, EUIPO, registrar …" /></label>
        </div>
        <div className="row">
          <label>Territorium<input name="territory" maxLength={100} placeholder="Sverige, EU …" /></label>
          <label>Registrerad<input type="date" name="registered_on" /></label>
          <label>Förnyas (tomt = enligt skyddstiden)<input type="date" name="renewal_date" /></label>
        </div>
        <div><button>Spara rättighet</button></div>
      </form>
    </div>
  );
}
