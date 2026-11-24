import { requireCompany } from '@/lib/server/auth';
import { Flash, type SP } from '@/components/ui';
import { kr } from '@/lib/format';
import { KINDS, PRESETS } from '@/lib/authorizations';
import { overview } from '@/lib/services/authorizations';
import { addAction, renewAction, revokeAction } from './actions';

export const dynamic = 'force-dynamic';
const STATUS: Record<string, string> = { valid: 'Giltig', expiring: 'Går snart ut', expired: 'Har gått ut', open: 'Tills vidare', revoked: 'Återkallad' };

export default async function Authorizations({ params, searchParams }: { params: Promise<{ cid: string }>; searchParams: SP }) {
  const { cid } = await params;
  const { company, role } = await requireCompany(cid, { perm: 'ledger' });
  const id = company.id;
  const o = await overview(id);
  const owner = role === 'owner';
  return (
    <div style={{ maxWidth: 1100 }}>
      <h1>Fullmakter, tillstånd och certifikat</h1>
      <Flash searchParams={searchParams} />
      <p className="small">Håll reda på vem som får företräda bolaget hos myndigheter och banker, och på bolagets tillstånd och certifikat. Du får en påminnelse 90 dagar innan något går ut.
        En återkallad fullmakt ska också meddelas motparten – i registret finns den kvar med datum och skäl.</p>
      {o.alerts.map((a) => <div key={a.id} className="card small au-alert" data-name={a.name}>{KINDS[a.kind]} {a.name}{a.holder && ` (${a.holder})`} {a.expiry!.status === 'expired' ? `gick ut ${a.valid_until}` : `går ut ${a.valid_until} (om ${a.expiry!.days} dagar)`}.</div>)}
      {(['power_of_attorney', 'permit', 'certificate'] as const).map((k) => <div key={k}><h2>{KINDS[k] === 'Fullmakt' ? 'Fullmakter' : KINDS[k] === 'Tillstånd' ? 'Tillstånd' : 'Certifikat'}</h2>
        <table className={`small au-list au-${k}`}><thead><tr><th>Benämning</th><th>Motpart</th>{k === 'power_of_attorney' && <th>Ombud</th>}<th>Omfattning</th><th>Giltig</th><th>Status</th><th></th></tr></thead>
          <tbody>{o.list.filter((a) => a.kind === k).map((a) => <tr key={a.id} className="au-row" data-name={a.name} data-status={a.expiry?.status ?? a.status}><td>{a.name}{a.reference && <div className="muted">{a.reference}</div>}{a.cost > 0 && <div className="muted">{kr(a.cost)} kr</div>}</td><td>{a.counterparty}</td>{k === 'power_of_attorney' && <td>{a.holder}</td>}
            <td>{a.scope}</td><td>{a.valid_from ?? ''}{a.valid_until ? ` – ${a.valid_until}` : a.valid_from ? ' –' : ''}</td><td>{a.status === 'active' ? STATUS[a.expiry!.status] : `${STATUS[a.status] ?? 'Avslutad'} ${a.revoked_on}: ${a.revoked_reason}`}</td>
            <td>{owner && a.status === 'active' && <><form action={renewAction.bind(null, id, a.id)} className="row" style={{ gap: '.25rem' }}><input type="date" name="valid_until" aria-label="Ny giltighet" /><button className="link">Förnya</button></form>
              <form action={revokeAction.bind(null, id, a.id)} className="row" style={{ gap: '.25rem' }}><input name="reason" placeholder="Skäl" required /><button className="link">{k === 'power_of_attorney' ? 'Återkalla' : 'Avsluta'}</button></form></>}</td></tr>)}
            {!o.list.some((a) => a.kind === k) && <tr><td colSpan={7} className="muted">Inga registrerade.</td></tr>}</tbody></table></div>)}
      <p className="small">Årliga kostnader för aktiva tillstånd och certifikat: {kr(o.yearlyCost)} kr</p>
      {owner && <><h2>Ny post</h2>
        <form action={addAction.bind(null, id)} className="card stack au-add">
          <div className="row">
            <label>Typ<select name="kind">{Object.entries(KINDS).map(([k, v]) => <option key={k} value={k}>{v}</option>)}</select></label>
            <label>Benämning<input name="name" list="au-presets" required maxLength={150} /></label>
            <datalist id="au-presets">{Object.values(PRESETS).flat().map((p) => <option key={p} value={p} />)}</datalist>
            <label>Motpart<input name="counterparty" maxLength={150} placeholder="Skatteverket, banken, certifieringsorgan …" /></label>
            <label>Ombud / gäller<input name="holder" maxLength={150} /></label>
          </div>
          <div className="row">
            <label>Omfattning<input name="scope" maxLength={500} /></label>
            <label>Referens<input name="reference" maxLength={100} /></label>
            <label>Gäller från<input type="date" name="valid_from" /></label>
            <label>Gäller till<input type="date" name="valid_until" /></label>
            <label>Kostnad per år<input name="cost" inputMode="decimal" style={{ width: '7rem' }} /></label>
          </div>
          <div><button>Spara</button></div>
        </form></>}
    </div>
  );
}
