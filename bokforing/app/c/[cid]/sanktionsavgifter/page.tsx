import Link from 'next/link';
import { requireCompany } from '@/lib/server/auth';
import { Flash, type SP } from '@/components/ui';
import { kr, today } from '@/lib/format';
import { KINDS, PAY_FROM } from '@/lib/penalties';
import { overview } from '@/lib/services/penalties';
import { addAction, reviewAction } from './actions';

export const dynamic = 'force-dynamic';

export default async function Penalties({ params, searchParams }: { params: Promise<{ cid: string }>; searchParams: SP }) {
  const { cid } = await params;
  const sp = await searchParams;
  const { company } = await requireCompany(cid, { perm: 'ledger' });
  const id = company.id;
  const o = await overview(id, Number(sp.fy) || undefined);
  return (
    <div style={{ maxWidth: 1050 }}>
      <h1>Sanktionsavgifter och böter</h1>
      <Flash searchParams={searchParams} />
      <p className="small">Förseningsavgifter, skattetillägg, böter, viten, felparkeringsavgifter och andra sanktionsavgifter får inte dras av, och inte heller kostnadsränta på skattekontot.
        De bokförs på 6992 respektive 8423 och läggs tillbaka i deklarationen (INK2S ruta 4.3c). Verifikationer som ser ut att innehålla en sådan avgift på ett avdragsgillt konto visas nedan så att de kan föras om.</p>
      {o.years.length > 1 && <p className="small">Räkenskapsår: {o.years.map((y) => <Link key={y.id} href={`/c/${id}/sanktionsavgifter?fy=${y.id}`} style={{ marginRight: '.5rem', fontWeight: y.id === o.fy?.id ? 700 : 400 }}>{y.start_date.slice(0, 4)}{y.start_date.slice(5) !== '01-01' ? `/${y.end_date.slice(2, 4)}` : ''}</Link>)}</p>}
      {o.fy && <>
        <h2>Ej avdragsgilla kostnader {o.fy.start_date} – {o.fy.end_date}</h2>
        <table className="pn-accounts"><tbody>{o.accounts.map((a) => <tr key={a.account} data-account={a.account}><td>{a.account} {a.name}</td><td className="num">{kr(a.amount)}</td></tr>)}
          <tr><th>Att lägga tillbaka i deklarationen (ruta 4.3c)</th><th className="num pn-total">{kr(o.total)}</th></tr></tbody></table>

        {o.suspicious.length > 0 && <><h2>Kontrollera</h2>
          <div className="card small pn-warning">Följande verifikationer ser ut att innehålla sanktionsavgifter eller böter men är bokförda på avdragsgilla konton.</div>
          <table className="pn-suspicious"><thead><tr><th>Verifikation</th><th>Datum</th><th>Text</th><th>Konto</th><th className="num">Belopp</th><th></th></tr></thead>
            <tbody>{o.suspicious.map((s) => <tr key={`${s.voucher_id}-${s.account}`} className="pn-row" data-account={s.account}><td><Link href={`/c/${id}/verifikationer/${s.voucher_id}`}>{s.number}</Link></td><td>{s.date}</td><td>{s.description}</td><td>{s.account}</td><td className="num">{kr(s.amount)}</td>
              <td><form action={reviewAction.bind(null, id, s.voucher_id, s.account, 'reclassed')} style={{ display: 'inline' }}><button className="link">För om till 6992</button></form>{' '}
                <form action={reviewAction.bind(null, id, s.voucher_id, s.account, 'ignored')} style={{ display: 'inline' }}><button className="link">Avdragsgill – ignorera</button></form></td></tr>)}</tbody></table></>}

        <h2>Registrerade avgifter</h2>
        <table className="pn-list"><thead><tr><th>Datum</th><th>Avgift</th><th>Myndighet</th><th>Referens</th><th>Konto</th><th className="num">Belopp</th></tr></thead>
          <tbody>{o.penalties.map((p) => <tr key={p.id}><td>{p.date}</td><td>{KINDS[p.kind]?.label ?? p.kind}</td><td>{p.authority}</td><td>{p.reference}</td><td>{p.account} / {p.credit_account}</td><td className="num">{kr(p.amount)}</td></tr>)}
            {!o.penalties.length && <tr><td colSpan={6} className="muted">Inga registrerade avgifter.</td></tr>}</tbody></table>
      </>}

      <h2>Ny avgift</h2>
      <form action={addAction.bind(null, id)} className="card row pn-add">
        <label>Avgift<select name="kind">{Object.entries(KINDS).map(([k, v]) => <option key={k} value={k}>{v.label}</option>)}</select></label>
        <label>Myndighet<input name="authority" maxLength={100} /></label>
        <label>Referens<input name="reference" maxLength={60} /></label>
        <label>Datum<input type="date" name="date" defaultValue={today()} required /></label>
        <label>Belopp<input name="amount" inputMode="decimal" required /></label>
        <label>Betald från<select name="credit_account">{Object.entries(PAY_FROM).map(([k, v]) => <option key={k} value={k}>{k} {v}</option>)}</select></label>
        <button>Bokför avgift</button>
      </form>
    </div>
  );
}
