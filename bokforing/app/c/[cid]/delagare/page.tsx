import Link from 'next/link';
import { redirect } from 'next/navigation';
import { requireCompany } from '@/lib/server/auth';
import { Flash, type SP } from '@/components/ui';
import { kr, today } from '@/lib/format';
import { MAX_PARTNERS, partnerAccounts } from '@/lib/partnership';
import { overview } from '@/lib/services/partnership';
import { save, transaction } from './actions';

export const dynamic = 'force-dynamic';

export default async function Partners({ params, searchParams }: { params: Promise<{ cid: string }>; searchParams: SP }) {
  const { cid } = await params;
  const sp = await searchParams;
  const ctx = await requireCompany(cid, { perm: 'ledger' });
  const c = ctx.company;
  if (c.company_type !== 'HB' && c.company_type !== 'KB') redirect(`/c/${c.id}/agare`);
  const o = await overview(c.id, Number(sp.fy) || undefined);
  const kb = c.company_type === 'KB';
  const slots = Array.from({ length: MAX_PARTNERS }, (_, i) => o.partners[i] ?? null);
  return (
    <div style={{ maxWidth: 1000 }}>
      <h1>Delägare</h1>
      <p className="muted">{kb ? 'Kommanditbolag' : 'Handelsbolag'}: bolaget beskattas inte själv – årets resultat fördelas på delägarna efter bolagsavtalet och beskattas hos dem (N3B för fysiska personer). Varje delägare har ett eget kapitalkonto.</p>
      <Flash searchParams={searchParams} />

      {o.fy && o.partners.length > 0 && (<>
        <div className="row"><b>Räkenskapsår {o.fy.start_date} – {o.fy.end_date}</b>{o.years.map((y) => y.id !== o.fy!.id && <Link key={y.id} href={`?fy=${y.id}`} className="small">{y.start_date.slice(0, 4)}</Link>)}</div>
        <div className="table-wrap"><table className="capital">
          <thead><tr><th>Delägare</th><th className="num">Andel</th><th className="num">Ingående</th><th className="num">Insättningar</th><th className="num">Uttag</th><th className="num">Andel av resultatet</th><th className="num">Utgående</th></tr></thead>
          <tbody>{o.rows.map((r) => (
            <tr key={r.n} className="partner-row"><td><b>{r.name}</b>{r.limited && <span className="small muted"> kommanditdelägare</span>}<div className="small muted">konto {partnerAccounts(r.n).capital}–{partnerAccounts(r.n).result}</div></td>
              <td className="num">{r.sharePct.toLocaleString('sv-SE')} %</td><td className="num">{kr(r.opening)}</td><td className="num deposits">{kr(r.contributions)}</td><td className="num withdrawals">{kr(r.withdrawals)}</td>
              <td className="num share">{kr(r.result)}{!o.booked && <div className="small muted">preliminärt</div>}</td><td className="num closing">{kr(r.closing)}</td></tr>
          ))}</tbody>
        </table></div>

        <h2>Underlag till INK4 och delägarnas N3B</h2>
        <p className="small">Bokfört resultat {kr(o.resultBefore ?? 0)} kr{o.nonDeductible ? `, ej avdragsgilla kostnader ${kr(o.nonDeductible)} kr läggs till` : ''}. Bolaget lämnar INK4 med INK4R och INK4S; varje fysisk delägare för in sin andel på N3B, juridiska delägare i sin egen deklaration.</p>
        <table className="n3b"><thead><tr><th>Delägare</th><th className="num">Andel</th><th className="num">Överskott</th><th className="num">Underskott</th></tr></thead>
          <tbody>{o.n3b.map((r) => <tr key={r.n} className="n3b-row"><td>{r.name}{r.limitedCapped && <div className="small" style={{ color: 'var(--warn)' }}>Underskottet begränsas till insatsen</div>}</td><td className="num">{r.share.toLocaleString('sv-SE')} %</td><td className="num surplus">{kr(r.surplus)}</td><td className="num deficit">{kr(r.deficit)}</td></tr>)}</tbody></table>

        <form action={transaction.bind(null, c.id)} className="card row" style={{ marginTop: 16 }}>
          <label>Delägare<select name="partner">{o.partners.map((p) => <option key={p.n} value={p.n}>{p.name}</option>)}</select></label>
          <label>Typ<select name="kind"><option value="withdrawal">Eget uttag</option><option value="contribution">Egen insättning</option></select></label>
          <label>Belopp (kr)<input name="amount" inputMode="decimal" required /></label><label>Datum<input type="date" name="date" defaultValue={today()} /></label>
          <label>Konto<input name="bank_account" defaultValue="1930" style={{ width: 70 }} /></label><button className="secondary">Bokför</button>
        </form>
      </>)}

      <h2>Delägare och andelar</h2>
      {ctx.role === 'owner' ? (
        <form action={save.bind(null, c.id)} className="card stack">
          {slots.map((p, i) => (
            <div key={i} className="row">
              <label style={{ flex: '2 1 200px' }}>Delägare {i + 1}<input name={`name_${i + 1}`} defaultValue={p?.name ?? ''} required={i < 2} /></label>
              <label>Person-/orgnr<input name={`identity_${i + 1}`} defaultValue={p?.identity ?? ''} /></label>
              <label>Typ<select name={`kind_${i + 1}`} defaultValue={p?.kind ?? 'person'}><option value="person">Fysisk person</option><option value="company">Juridisk person</option></select></label>
              <label>Andel %<input name={`share_${i + 1}`} defaultValue={p ? String(p.sharePct) : ''} inputMode="decimal" style={{ width: 80 }} /></label>
              {kb && <><label className="check"><input type="checkbox" name={`limited_${i + 1}`} defaultChecked={p?.limited} /> Kommanditdelägare</label>
                <label>Insats (kr)<input name={`contribution_${i + 1}`} defaultValue={p?.contribution ? String(p.contribution / 100) : ''} inputMode="decimal" style={{ width: 110 }} /></label></>}
            </div>
          ))}
          <div><button>Spara delägare</button></div>
          <p className="small muted" style={{ margin: 0 }}>Andelarna i resultatet ska summera till 100 %. {kb ? 'Minst en komplementär (obegränsat ansvar) och minst en kommanditdelägare.' : 'Alla delägare har obegränsat ansvar.'}</p>
        </form>
      ) : <p className="muted">Ägaren lägger in delägarna.</p>}
    </div>
  );
}
