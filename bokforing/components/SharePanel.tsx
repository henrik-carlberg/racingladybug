import { listShares } from '@/lib/services/custom-reports';
import { requestOrigin } from '@/lib/server/origin';
import { revoke, share } from '@/app/c/[cid]/rapporter/egna/actions';

/** Dela en rapport eller nyckeltalen med t.ex. banken eller styrelsen via en läsbar länk som slutar gälla */
export async function SharePanel({ companyId, back, kind, reportId, role, token }: { companyId: number; back: string; kind: 'report' | 'kpi'; reportId?: number; role?: string; token?: string | null }) {
  const shares = (await listShares(companyId)).filter((s) => s.kind === kind && (kind === 'kpi' || s.report));
  const origin = await requestOrigin();
  return (
    <section id="dela" className="card stack share-panel">
      <b>Dela med banken eller styrelsen</b>
      <p className="small muted" style={{ margin: 0 }}>Mottagaren behöver inget konto. Länken visar siffrorna som de är när den öppnas, kan inte ändra något och slutar gälla efter vald tid. Du kan återkalla den när som helst.</p>
      {token && <div>Länk: <code className="share-url">{`${origin}/delad/${token}`}</code></div>}
      <form action={share.bind(null, companyId, back, kind, reportId ?? null)} className="row" style={{ alignItems: 'end' }}>
        {kind === 'kpi' && <input type="hidden" name="role" value={role ?? 'styrelse'} />}
        <label style={{ flex: '2 1 220px' }}>Till vem? (för din egen översikt)<input name="label" placeholder="T.ex. Banken, styrelsemöte december" /></label>
        <label>Gäller i<select name="days" defaultValue="30"><option value="7">7 dagar</option><option value="30">30 dagar</option><option value="90">90 dagar</option></select></label>
        <div style={{ flex: '0 0 auto' }}><button className="secondary">Skapa delningslänk</button></div>
      </form>
      {shares.length > 0 && (
        <table className="small">
          <tbody>{shares.map((s) => (
            <tr key={s.id}><td>{s.label || (s.kind === 'kpi' ? `Nyckeltal (${s.role})` : s.report)}</td><td>{s.revoked ? 'Återkallad' : s.expired ? 'Har gått ut' : `Gäller till ${s.expires}`}</td><td>{s.views} visningar</td>
              <td className="num">{!s.revoked && !s.expired && <form action={revoke.bind(null, companyId, back, s.id)}><button className="link">Återkalla</button></form>}</td></tr>
          ))}</tbody>
        </table>
      )}
    </section>
  );
}
