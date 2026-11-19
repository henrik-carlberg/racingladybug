import Link from 'next/link';
import { requireCompany } from '@/lib/server/auth';
import { Flash, type SP } from '@/components/ui';
import { KIND_LABEL, listAlerts, pendingBankChanges, scanUnusual } from '@/lib/services/fraud';
import { decide, resolve } from './actions';

export const dynamic = 'force-dynamic';
const LINK: Record<string, (id: number) => string> = { supplier_invoice: (id) => `/leverantorsfakturor/${id}`, voucher: (id) => `/verifikationer/${id}`, bank_transaction: () => '/bank/avstamning' };
const FIELD: Record<string, string> = { bankgiro: 'Bankgiro', plusgiro: 'Plusgiro', bank_account: 'Kontonummer' };

export default async function Control({ params, searchParams }: { params: Promise<{ cid: string }>; searchParams: SP }) {
  const { cid } = await params;
  const ctx = await requireCompany(cid, { perm: 'ledger' });
  const id = ctx.company.id, b = `/c/${id}`;
  await scanUnusual(id).catch(() => 0);
  const [changes, open, closed] = await Promise.all([pendingBankChanges(id), listAlerts(id, 'open'), listAlerts(id, 'closed')]);
  const others = open.filter((a) => a.kind !== 'bank_change');
  const canAttest = ctx.can('attest');
  return (
    <div style={{ maxWidth: 960 }}>
      <h1>Varningar och kontroll</h1>
      <p className="muted">Skydd mot fakturabedrägerier och fel: nya bankuppgifter hos leverantörer gäller först när en annan person har godkänt dem, möjliga dubbletter spärras från attest och betalning, och ovanliga utbetalningar och bokningar flaggas för granskning.</p>
      <Flash searchParams={searchParams} />

      <h2>Nya bankuppgifter att godkänna ({changes.length})</h2>
      {changes.length === 0 && <p className="small muted">Inga ändringar väntar.</p>}
      {changes.map((c) => (
        <div key={c.id} className="card stack bank-change">
          <div><b><Link href={`${b}/leverantorer/${c.supplier_id}`}>{c.supplier}</Link></b> <span className="small muted">ändrat av {c.by ?? 'okänd'} {c.at}</span></div>
          <table className="small"><tbody>{Object.keys(c.new_values).map((k) => <tr key={k}><td>{FIELD[k] ?? k}</td><td><s>{c.old_values[k] || '–'}</s></td><td>→ <b>{c.new_values[k] || '–'}</b></td></tr>)}</tbody></table>
          <p className="small" style={{ margin: 0 }}>⚠️ Bedragare skickar ofta ”nya bankuppgifter” via e-post. Ring leverantören på ett nummer du redan har – inte numret i meddelandet – och bekräfta innan du godkänner. Fakturor till leverantören kan inte betalas så länge ändringen väntar.</p>
          {canAttest ? (
            <div className="row" style={{ alignItems: 'end' }}>
              <form action={decide.bind(null, id, c.id, true)} className="row" style={{ alignItems: 'end', flex: '3 1 400px' }}>
                <label style={{ flex: '2 1 240px' }}>Hur kontrollerade du?<input name="comment" placeholder="T.ex. ringde Anna på leverantören, 08-123 45 67" /></label>
                <label className="check" style={{ flex: '1 1 200px' }}><input type="checkbox" name="verified" /> Jag har bekräftat med leverantören</label>
                <div style={{ flex: '0 0 auto' }}><button>Godkänn</button></div>
              </form>
              <form action={decide.bind(null, id, c.id, false)}><input type="hidden" name="comment" value="Avslagen" /><button className="secondary">Avslå</button></form>
            </div>
          ) : <p className="small muted" style={{ margin: 0 }}>En person med attesträtt godkänner ändringen.</p>}
        </div>
      ))}

      <h2>Att granska ({others.length})</h2>
      {others.length === 0 && <p className="small muted">Inga öppna varningar.</p>}
      {others.map((a) => (
        <div key={a.id} className="card stack alert" data-kind={a.kind}>
          <div><span className="badge warn">{KIND_LABEL[a.kind]}</span> <b>{a.title}</b> <span className="small muted">{a.created}</span></div>
          <div className="small">{a.detail} {LINK[a.entity] && <Link href={`${b}${LINK[a.entity](a.entity_id)}`}>Öppna</Link>}</div>
          <form className="row" style={{ alignItems: 'end' }} action={resolve.bind(null, id, a.id, 'ok')}>
            <label style={{ flex: '3 1 300px' }}>Kommentar<input name="comment" required placeholder="Vad har du kontrollerat?" /></label>
            <div style={{ flex: '0 0 auto' }}><button className="secondary">Kontrollerad – inget fel</button></div>
            <div style={{ flex: '0 0 auto' }}><button className="link" formAction={resolve.bind(null, id, a.id, 'confirmed')}>Det är ett fel</button></div>
          </form>
        </div>
      ))}

      {closed.length > 0 && (<>
        <h2>Hanterade</h2>
        <div className="table-wrap"><table className="small"><thead><tr><th>Datum</th><th>Varning</th><th>Resultat</th><th>Kommentar</th></tr></thead>
          <tbody>{closed.map((a) => <tr key={a.id} className="closed-alert"><td>{a.resolved}</td><td>{KIND_LABEL[a.kind]}: {a.title}</td><td>{a.status === 'ok' ? 'Kontrollerad' : 'Fel/avslagen'}{a.by ? ` (${a.by})` : ''}</td><td>{a.comment}</td></tr>)}</tbody></table></div>
      </>)}
    </div>
  );
}
