import Link from 'next/link';
import { requireCompany } from '@/lib/server/auth';
import { type SP } from '@/components/ui';
import { kr } from '@/lib/format';
import { highlightParts } from '@/lib/doc-text';
import { archiveYears } from '@/lib/services/doc-archive';
import { KIND_LABEL, searchAll, type HitKind } from '@/lib/services/search';

export const dynamic = 'force-dynamic';

export default async function Search({ params, searchParams }: { params: Promise<{ cid: string }>; searchParams: SP }) {
  const { cid } = await params;
  const ctx = await requireCompany(cid);
  const id = ctx.company.id, b = `/c/${id}`;
  const sp = await searchParams;
  const q = String(sp.q ?? '').slice(0, 200);
  const year = Number(sp.year) || undefined;
  const all = sp.arkiverade === '1';
  const can = (p: Parameters<typeof ctx.can>[0]) => ctx.role === 'auditor' || ctx.can(p);
  const [hits, years] = await Promise.all([q ? searchAll(id, q, { can, year, includeArchived: all, limit: 25 }) : Promise.resolve([]), archiveYears(id)]);
  const groups = (Object.keys(KIND_LABEL) as HitKind[]).map((k) => [k, hits.filter((h) => h.kind === k)] as const).filter(([, h]) => h.length);
  const archivedYears = years.filter((y) => y.archived_at);
  return (
    <div style={{ maxWidth: 960 }}>
      <h1>Sök i allt</h1>
      <form className="card row search-form" role="search">
        <label style={{ flex: '3 1 320px' }}>Sök efter text, belopp, fakturanummer, OCR eller namn<input name="q" type="search" defaultValue={q} autoFocus placeholder="T.ex. hyra mars, 1 250,00 eller 1009" /></label>
        <label>År<select name="year" defaultValue={year ?? ''}><option value="">Alla år</option>{[...new Set(years.map((y) => Number(y.end_date.slice(0, 4))))].map((y) => <option key={y} value={y}>{y}</option>)}</select></label>
        <label className="check" style={{ flex: '0 0 auto', alignSelf: 'end' }}><input type="checkbox" name="arkiverade" value="1" defaultChecked={all} /> Även arkiverade år</label>
        <div style={{ flex: '0 0 auto', alignSelf: 'end' }}><button>Sök</button></div>
      </form>
      <p className="small muted">Söker i verifikationer, kund- och leverantörsfakturor, kunder, leverantörer, banktransaktioner och texten i underlagen – även inskannade kvitton och PDF:er. Du ser bara det du har behörighet till.
        {archivedYears.length > 0 && !all && ' Arkiverade år ingår inte om du inte kryssar i rutan.'}</p>
      {q && hits.length === 0 && <div className="card">Inga träffar på ”{q}”. Prova färre eller kortare ord.</div>}
      {groups.map(([k, list]) => (
        <section key={k} className="search-group" data-kind={k}>
          <h2>{KIND_LABEL[k]} <span className="small muted">({list.length})</span></h2>
          <ul className="stack" style={{ listStyle: 'none', padding: 0 }}>{list.map((h) => (
            <li key={`${k}${h.id}`} className="card search-hit">
              <div className="header" style={{ margin: 0 }}><Link href={`${b}${h.href}`}><b>{h.title}</b></Link>
                <span className="small muted">{h.date}{h.amount != null ? ` · ${kr(h.amount)} kr` : ''}{h.archived && <span className="badge" style={{ marginLeft: '.4rem' }}>Arkiverat år</span>}</span></div>
              {h.snippet && <div className="small">{highlightParts(h.snippet).map((p, i) => (p.hit ? <mark key={i}>{p.text}</mark> : <span key={i}>{p.text}</span>))}</div>}
            </li>
          ))}</ul>
        </section>
      ))}
    </div>
  );
}
