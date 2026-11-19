import Link from 'next/link';
import { requireCompany } from '@/lib/server/auth';
import { Flash, type SP } from '@/components/ui';
import { kr, today } from '@/lib/format';
import { CHARGE_KINDS } from '@/lib/intercompany';
import { balances, eliminations, linkedCompanies, listCharges } from '@/lib/services/intercompany';
import { addCharge, run, stop } from './actions';

export const dynamic = 'force-dynamic';

export default async function Intercompany({ params, searchParams }: { params: Promise<{ cid: string }>; searchParams: SP }) {
  const { cid } = await params;
  const ctx = await requireCompany(cid, { perm: 'ledger' });
  const id = ctx.company.id, sp = await searchParams;
  const year = Number(sp.ar) || Number(today().slice(0, 4));
  const [linked, bal, charges, elim] = await Promise.all([linkedCompanies(id), balances(id, ctx.user.id), listCharges(id), eliminations(id, `${year}-01-01`, `${year}-12-31`)]);
  const owner = ctx.role === 'owner';
  return (
    <div style={{ maxWidth: 1000 }}>
      <h1>Koncerninterna flöden</h1>
      <p className="muted">Fakturor till ett koncernbolag (kunden har bolagets organisationsnummer) blir automatiskt en leverantörsfaktura hos mottagaren. Mellanhavandena stäms av åt båda håll och underlaget används vid elimineringen i <Link href="/koncern">koncernrapporten</Link>.</p>
      <Flash searchParams={searchParams} />
      {linked.length === 0 ? <div className="card">Bolaget är inte kopplat till någon koncern. Koppla moder- och dotterbolag under <Link href="/koncern">Koncern</Link>.</div> : (<>
        <h2>Mellanhavanden</h2>
        <div className="table-wrap"><table className="ic-balances"><thead><tr><th>Koncernbolag</th><th className="num">Vår fordran</th><th className="num">Deras skuld till oss</th><th className="num">Vår skuld</th><th className="num">Deras fordran på oss</th><th>Avstämning</th></tr></thead>
          <tbody>{bal.map((b) => (
            <tr key={b.company.id} className="ic-row"><td><b>{b.company.name}</b><div className="small muted">{b.company.relation}</div></td>
              <td className="num">{kr(b.receivable)}</td><td className="num">{b.theirPayable != null ? kr(b.theirPayable) : '–'}</td><td className="num">{kr(b.payable)}</td><td className="num">{b.theirReceivable != null ? kr(b.theirReceivable) : '–'}</td>
              <td>{!b.access ? <span className="small muted">Du har inte tillgång till bolaget</span> : b.out!.ok && b.in!.ok ? <span className="badge ok">Stämmer</span>
                : <span className="badge warn ic-diff">Skiljer {kr(b.out!.ok ? b.in!.diff : b.out!.diff)}</span>}</td></tr>
          ))}</tbody></table></div>

        <h2>Koncernavgifter</h2>
        {charges.length > 0 && <table className="small charges"><tbody>{charges.map((c) => <tr key={c.id}><td>{CHARGE_KINDS[c.kind].label} till {c.target}</td>
          <td className="num">{c.kind === 'management_fee' ? `${kr(c.amount)} kr/mån` : `${String(c.rate_pct).replace('.', ',')} % på ${kr(c.principal)} kr`}</td>
          <td>från {c.start_period}{c.last_period ? `, fakturerad t.o.m. ${c.last_period}` : ''}</td><td>{c.active ? (owner && <form action={stop.bind(null, id, c.id)}><button className="link">Avsluta</button></form>) : 'Avslutad'}</td></tr>)}</tbody></table>}
        {owner && (<>
          <form action={addCharge.bind(null, id)} className="card stack">
            <div className="row">
              <label>Till<select name="target_company_id">{linked.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}</select></label>
              <label>Typ<select name="kind"><option value="management_fee">Management fee (25 % moms)</option><option value="interest">Koncernränta på lån (momsfri)</option></select></label>
              <label>Från månad<input name="start_period" defaultValue={today().slice(0, 7)} /></label>
            </div>
            <div className="row"><label>Avgift per månad (kr)<input name="amount" inputMode="decimal" /></label><label>eller lånebelopp (kr)<input name="principal" inputMode="decimal" /></label><label>och ränta (%)<input name="rate_pct" inputMode="decimal" /></label></div>
            <div><button className="secondary">Lägg upp avgift</button></div>
            <p className="small muted" style={{ margin: 0 }}>Varje månad skapas och bokförs en faktura till koncernbolaget, som blir en leverantörsfaktura hos mottagaren. Prissätt på marknadsmässiga villkor.</p>
          </form>
          {charges.some((c) => c.active) && <form action={run.bind(null, id)} className="actions"><button>Fakturera förfallna månader nu</button></form>}
        </>)}

        <h2>Elimineringsunderlag {year}</h2>
        <div className="table-wrap"><table className="ic-elim"><thead><tr><th>Faktura</th><th>Datum</th><th>Till</th><th className="num">Netto</th><th className="num">Moms</th><th>Hos mottagaren</th></tr></thead>
          <tbody>{elim.map((e) => <tr key={e.number}><td>{e.number}</td><td>{e.date}</td><td>{e.target}</td><td className="num">{kr(e.net)}</td><td className="num">{kr(e.vat)}</td>
            <td>{e.mirrored ? <span className="badge ok">Speglad</span> : <span className="small" style={{ color: 'var(--danger)' }}>{e.message || 'Inte speglad'}</span>}</td></tr>)}
            {elim.length === 0 && <tr><td colSpan={6} className="muted">Inga koncerninterna fakturor {year}.</td></tr>}
            {elim.length > 0 && <tr className="sum"><td colSpan={3}>Att eliminera (koncernintern försäljning)</td><td className="num">{kr(elim.reduce((s, e) => s + e.net, 0))}</td><td colSpan={2}></td></tr>}</tbody></table></div>
      </>)}
    </div>
  );
}
