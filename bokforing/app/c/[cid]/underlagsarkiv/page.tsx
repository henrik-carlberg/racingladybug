import Link from 'next/link';
import { requireCompany } from '@/lib/server/auth';
import { Flash, type SP } from '@/components/ui';
import { today } from '@/lib/format';
import { archiveYears, documents } from '@/lib/services/doc-archive';
import { archive, tag, unarchive, untag, verify } from './actions';

export const dynamic = 'force-dynamic';
const SRC: Record<string, string> = { pdf: 'Text ur PDF', file: 'Text ur filen', ocr: 'Avläst (OCR)', none: 'Ingen text' };
const size = (n: number) => (n > 1e6 ? `${(n / 1e6).toFixed(1).replace('.', ',')} MB` : `${Math.max(1, Math.round(n / 1000))} kB`);

export default async function DocumentArchive({ params, searchParams }: { params: Promise<{ cid: string }>; searchParams: SP }) {
  const { cid } = await params;
  const ctx = await requireCompany(cid, { perm: 'ledger' });
  const id = ctx.company.id, b = `/c/${id}`;
  const sp = await searchParams;
  const years = await archiveYears(id);
  const t = today();
  const fyId = Number(sp.ar) || years.find((y) => y.start_date <= t && y.end_date >= t)?.id || years[0]?.id;
  if (!fyId) return <p>Lägg upp ett räkenskapsår först.</p>;
  const tagFilter = typeof sp.tagg === 'string' ? sp.tagg : undefined;
  const { fy, docs, tags, retention } = await documents(id, fyId, { tag: tagFilter });
  const y = years.find((x) => x.id === fyId)!;
  const owner = ctx.role === 'owner';
  return (
    <div style={{ maxWidth: 1000 }}>
      <h1>Dokumentarkiv</h1>
      <Flash searchParams={searchParams} />
      <p className="small">{years.map((x, i) => <span key={x.id}>{i > 0 && ' · '}{x.id === fyId ? <b>{x.start_date.slice(0, 4)}</b> : <Link href={`${b}/underlagsarkiv?ar=${x.id}`}>{x.start_date.slice(0, 4)}</Link>}{x.archived_at && ' 🔒'}</span>)}</p>
      <form action={`${b}/sok`} className="card row" role="search">
        <input type="hidden" name="arkiverade" value="1" />
        <label style={{ flex: '3 1 320px' }}>Sök i underlagens text (även OCR)<input name="q" type="search" placeholder="T.ex. leverantörens namn eller fakturanummer" /></label>
        <div style={{ flex: '0 0 auto', alignSelf: 'end' }}><button className="secondary">Sök</button></div>
      </form>
      <div className="card stack archive-year">
        <div><b>Räkenskapsår {fy.start_date} – {fy.end_date}</b> · {docs.length} underlag{tagFilter ? ` med taggen ${tagFilter}` : ''}</div>
        <div className="small">Sparas till och med <b className="retention">{retention}</b> (bokföringslagen: sju år efter utgången av det kalenderår då räkenskapsåret avslutades){retention < t && <span className="badge ok" style={{ marginLeft: '.4rem' }}>Får gallras</span>}.
          {' '}<a href={`${b}/arkiv/${fy.id}`}>Ladda ned arkivpaket (zip)</a></div>
        {y.archived_at ? (
          <div className="row" style={{ alignItems: 'center' }}>
            <span className="badge archived">🔒 Arkiverat {y.archived_at}{y.by ? ` av ${y.by}` : ''}</span>
            <code className="small seal" title="Kontrollsumma (SHA-256)">{y.archive_seal?.slice(0, 16)}…</code>
            <form action={verify.bind(null, id, fy.id)}><button className="secondary">Kontrollera att inget har ändrats</button></form>
            {owner && <form action={unarchive.bind(null, id, fy.id)}><button className="link">Återställ</button></form>}
          </div>
        ) : y.closed ? (
          owner && <form action={archive.bind(null, id, fy.id)} className="row" style={{ alignItems: 'center' }}><button className="secondary">Arkivera året</button>
            <span className="small muted">Året förseglas med en kontrollsumma över alla verifikationer och underlag och tas bort ur standardsökningen. Allt finns kvar och kan sökas fram.</span></form>
        ) : <div className="small muted">Året kan arkiveras när det är stängt i bokslutet.</div>}
      </div>
      {tags.length > 0 && <p className="small">Taggar: {tagFilter ? <Link href={`${b}/underlagsarkiv?ar=${fy.id}`}>alla</Link> : <b>alla</b>}{tags.map((x) => <span key={x.tag}> · {x.tag === tagFilter ? <b>{x.tag}</b> : <Link href={`${b}/underlagsarkiv?ar=${fy.id}&tagg=${encodeURIComponent(x.tag)}`}>{x.tag}</Link>} ({x.n})</span>)}</p>}
      <div className="table-wrap"><table className="docs">
        <thead><tr><th>Datum</th><th>Dokument</th><th>Hör till</th><th>Sökbar text</th><th>Taggar</th></tr></thead>
        <tbody>{docs.map((d) => (
          <tr key={d.id} className="doc-row" data-id={d.id}>
            <td>{d.date}</td>
            <td><a href={`${b}/underlag/${d.id}`} target="_blank">{d.filename}</a><div className="small muted">{size(d.size)}</div></td>
            <td>{d.voucher_id ? <Link href={`${b}/verifikationer/${d.voucher_id}`}>{d.voucher}</Link> : d.supplier_invoice_id ? <Link href={`${b}/leverantorsfakturor/${d.supplier_invoice_id}`}>Leverantörsfaktura</Link> : <span className="muted">–</span>}</td>
            <td className="small">{d.text_source ? SRC[d.text_source] : <span className="muted">Läses in…</span>}</td>
            <td>{d.tags.map((x) => <form key={x} action={untag.bind(null, id, fy.id, d.id, x)} style={{ display: 'inline' }}><span className="badge tag">{x} <button className="link" aria-label={`Ta bort taggen ${x}`}>×</button></span> </form>)}
              <form action={tag.bind(null, id, fy.id, d.id)} style={{ display: 'inline-flex', gap: '.3rem' }}><input name="tag" placeholder="Ny tagg" aria-label="Ny tagg" style={{ width: '7rem' }} /><button className="link">Lägg till</button></form></td>
          </tr>
        ))}{docs.length === 0 && <tr><td colSpan={5} className="muted">Inga underlag för året.</td></tr>}</tbody>
      </table></div>
    </div>
  );
}
