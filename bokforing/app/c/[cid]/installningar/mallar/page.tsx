import { requireCompany } from '@/lib/server/auth';
import { Flash, type SP } from '@/components/ui';
import { PLACEHOLDERS, TEMPLATE_LABEL, renderTemplate, unknownPlaceholders } from '@/lib/email-templates';
import { allTemplates } from '@/lib/services/templates';
import { reset, save } from './actions';

export const dynamic = 'force-dynamic';

export default async function Templates({ params, searchParams }: { params: Promise<{ cid: string }>; searchParams: SP }) {
  const { cid } = await params;
  const { company } = await requireCompany(cid, { perm: 'invoicing' });
  const list = await allTemplates(company.id);
  const sample = { kund: 'Exempelkunden AB', företag: company.name, fakturanummer: '1042', belopp: '12 500,00 kr', förfallodatum: '2026-12-31', ocr: '104205', bankgiro: company.bankgiro || '123-4567',
    länk: 'https://…/f/…', meddelande: 'Tack för uppdraget!', att_betala: '12 560,00 kr' };
  return (
    <div style={{ maxWidth: 960 }}>
      <h1>E-postmallar</h1>
      <Flash searchParams={searchParams} />
      <p className="muted">Egna texter när fakturor, påminnelser och tack för betalningen skickas. Skriv fält inom klammer, t.ex. <code>{'{kund}'}</code> – de ersätts med rätt uppgifter. Fakturor på engelska använder alltid den engelska standardtexten.</p>
      <details className="card small"><summary>Fält du kan använda</summary><ul>{Object.entries(PLACEHOLDERS).map(([k, v]) => <li key={k}><code>{`{${k}}`}</code> – {v}</li>)}</ul></details>
      {list.map((t) => {
        const preview = renderTemplate(t, sample);
        const unknown = unknownPlaceholders(t);
        return (
          <section key={t.kind} id={t.kind} className="card">
            <div className="header" style={{ marginBottom: '.5rem' }}><h2 style={{ margin: 0 }}>{TEMPLATE_LABEL[t.kind]}</h2>{t.custom ? <span className="badge ok">Egen text</span> : <span className="badge">Standardtext</span>}</div>
            <div className="row" style={{ alignItems: 'flex-start' }}>
              <form action={save.bind(null, company.id, t.kind)} className="stack" style={{ flex: '1 1 380px' }}>
                <label>Ämne<input name="subject" defaultValue={t.subject} required /></label>
                <label>Text<textarea name="body" rows={10} defaultValue={t.body} required /></label>
                {t.kind === 'thanks' && <label className="check"><input type="checkbox" name="enabled" defaultChecked={t.custom && t.enabled} /> Skicka tack automatiskt när en faktura blir helt betald</label>}
                {unknown.length > 0 && <div className="check-item warn small">Okända fält: {unknown.map((u) => `{${u}}`).join(', ')}</div>}
                <div className="actions" style={{ margin: 0 }}><button className="secondary">Spara</button>{t.custom && <button className="link" formAction={reset.bind(null, company.id, t.kind)}>Återställ standardtext</button>}</div>
              </form>
              <div className="email-preview" style={{ flex: '1 1 320px' }}>
                <div className="small muted">Förhandsvisning</div>
                <b>{preview.subject}</b>
                <pre>{preview.body}</pre>
              </div>
            </div>
          </section>
        );
      })}
    </div>
  );
}
