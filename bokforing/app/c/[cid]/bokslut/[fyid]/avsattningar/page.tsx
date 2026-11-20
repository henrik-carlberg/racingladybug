import Link from 'next/link';
import { notFound } from 'next/navigation';
import { requireCompany } from '@/lib/server/auth';
import { NotFoundError } from '@/lib/errors';
import { Flash, type SP } from '@/components/ui';
import { kr, today } from '@/lib/format';
import { COMMITMENT_LABEL, PROVISION_LABEL } from '@/lib/provisions';
import { overview } from '@/lib/services/provisions';
import { addCommitment, addProvision, endCommitment, move, warranty } from './actions';

export const dynamic = 'force-dynamic';

/** Avsättningar, ställda säkerheter och eventualförpliktelser i bokslutet – förs till noterna i årsredovisningen */
export default async function Provisions({ params, searchParams }: { params: Promise<{ cid: string; fyid: string }>; searchParams: SP }) {
  const { cid, fyid } = await params;
  const ctx = await requireCompany(cid, { perm: 'ledger' });
  const id = ctx.company.id;
  const sp = await searchParams;
  const rate = typeof sp.rate === 'string' ? sp.rate : '';
  const o = await overview(id, Number(fyid), rate || undefined).catch((e) => { if (e instanceof NotFoundError) notFound(); throw e; });
  const f = o.fy;
  return (
    <div style={{ maxWidth: 900 }}>
      <h1>Avsättningar och åtaganden {f.start_date.slice(0, 4)}</h1>
      <p className="small"><Link href={`/c/${id}/bokslut/${f.id}`}>← Bokslutet</Link> · <Link href={`/c/${id}/bokslut/${f.id}/arsredovisning`}>Årsredovisning</Link></p>
      <Flash searchParams={searchParams} />
      <h2>Avsättningar</h2>
      <p className="small">En avsättning är en skuld som är säker eller sannolik men osäker till belopp eller tidpunkt – till exempel garantiåtaganden eller en pågående tvist.</p>
      {o.all.map((p) => (
        <details key={p.id} className="card stack provision" data-desc={p.description}>
          <summary><b>{p.label}</b>: {p.description} — {p.account}, saldo <span className="prov-balance">{kr(p.balance)}</span> kr</summary>
          {!f.closed && <form action={move.bind(null, id, f.id, p.id)} className="row">
            <label>Bokför<select name="kind"><option value="set">Avsättning (kostnad {p.cost_account})</option><option value="use">Ianspråktagande (betalt)</option><option value="release">Upplösning (återförs mot {p.cost_account})</option></select></label>
            <label>Datum<input type="date" name="date" defaultValue={f.end_date < today() ? f.end_date : today()} required /></label>
            <label>Belopp (kr)<input name="amount" required /></label>
            <div style={{ flex: '0 0 auto' }}><button>Bokför</button></div>
          </form>}
          {p.kind === 'warranty' && !f.closed && <form action={warranty.bind(null, id, f.id, p.id)} className="row warranty">
            <label>Garantikostnad i procent av försäljningen<input name="rate_pct" defaultValue={rate} required style={{ width: '6rem' }} /></label>
            <div style={{ flex: '0 0 auto' }}><button className="secondary">Beräkna och bokför per {f.end_date}</button></div>
          </form>}
          {p.kind === 'warranty' && o.proposal && <p className="small warranty-proposal" style={{ margin: 0 }}>Årets försäljning {kr(o.proposal.sales)} kr × {o.proposal.ratePct} % = {kr(o.proposal.target)} kr.
            {o.proposal.taxMax != null ? ` Skattemässigt avdragsgillt högst ${kr(o.proposal.taxMax)} kr utifrån de två senaste årens garantiutgifter${o.proposal.nonDeductible ? ` – ${kr(o.proposal.nonDeductible)} kr läggs till i deklarationen` : ''}.` : ' Det finns ingen historik för den skattemässiga gränsen – den bygger på faktiska garantiutgifter de två senaste åren.'}</p>}
        </details>
      ))}
      {!f.closed && <form action={addProvision.bind(null, id, f.id)} className="card row add-provision">
        <label>Typ<select name="kind">{Object.entries(PROVISION_LABEL).map(([k, l]) => <option key={k} value={k}>{l}</option>)}</select></label>
        <label style={{ flex: '1 1 220px' }}>Beskrivning<input name="description" required maxLength={300} placeholder="T.ex. Garanti på sålda maskiner" /></label>
        <label>Kostnadskonto<input name="cost_account" defaultValue="6900" style={{ width: '6rem' }} /></label>
        <div style={{ flex: '0 0 auto' }}><button className="secondary">Lägg upp avsättning</button></div>
      </form>}
      {o.provisions.length > 0 && <table className="prov-note"><thead><tr><th>Avsättning</th><th className="num">Ingående</th><th className="num">Avsatt</th><th className="num">Ianspråktaget</th><th className="num">Återfört</th><th className="num">Utgående</th></tr></thead>
        <tbody>{o.provisions.map((r) => <tr key={r.id}><td>{r.description}</td><td className="num">{kr(r.opening)}</td><td className="num">{kr(r.set)}</td><td className="num">{kr(r.used)}</td><td className="num">{kr(r.released)}</td><td className="num prov-closing">{kr(r.closing)}</td></tr>)}</tbody></table>}

      <h2>Ställda säkerheter och eventualförpliktelser per {f.end_date}</h2>
      <div className="grid">
        <div className="card stat"><div className="label">Ställda säkerheter</div><div className="value com-pledges">{kr(o.note.pledgeTotal)}</div></div>
        <div className="card stat"><div className="label">Eventualförpliktelser</div><div className="value com-contingent">{kr(o.note.contingentTotal)}</div></div>
      </div>
      <table><tbody>{o.commitments.map((c) => (
        <tr key={c.id} className="commitment"><td>{COMMITMENT_LABEL[c.kind]}</td><td>{c.description}{c.beneficiary ? ` (till förmån för ${c.beneficiary})` : ''}</td><td className="num">{kr(c.amount)}</td><td className="small">från {c.from_date}</td>
          <td>{!f.closed && <form action={endCommitment.bind(null, id, f.id, c.id)} className="row"><input type="date" name="to_date" defaultValue={today()} aria-label="Upphörde" /><button className="secondary small">Upphört</button></form>}</td></tr>))}
        {!o.commitments.length && <tr><td className="muted">Inga registrerade.</td></tr>}</tbody></table>
      <form action={addCommitment.bind(null, id, f.id)} className="card row add-commitment">
        <label>Typ<select name="kind">{Object.entries(COMMITMENT_LABEL).map(([k, l]) => <option key={k} value={k}>{l}</option>)}</select></label>
        <label style={{ flex: '1 1 200px' }}>Beskrivning<input name="description" required maxLength={300} placeholder="T.ex. Företagsinteckning i banken" /></label>
        <label>Till förmån för<input name="beneficiary" maxLength={200} /></label>
        <label>Belopp (kr)<input name="amount" required style={{ width: '8rem' }} /></label>
        <label>Från<input type="date" name="from_date" defaultValue={f.start_date} required /></label>
        <div style={{ flex: '0 0 auto' }}><button className="secondary">Registrera</button></div>
      </form>
      <p className="small muted">Uppgifterna förs automatiskt till noterna Avsättningar och Ställda säkerheter och eventualförpliktelser i årsredovisningen.</p>
    </div>
  );
}
