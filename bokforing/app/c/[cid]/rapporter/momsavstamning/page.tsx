import Link from 'next/link';
import { requireCompany } from '@/lib/server/auth';
import { type SP } from '@/components/ui';
import { kr, today } from '@/lib/format';
import { defaultVatPeriod } from '@/lib/vat-recon';
import { reconcile } from '@/lib/services/vat-recon';

export const dynamic = 'force-dynamic';
const ISO = /^\d{4}-\d{2}-\d{2}$/;

export default async function VatRecon({ params, searchParams }: { params: Promise<{ cid: string }>; searchParams: SP }) {
  const { cid } = await params;
  const { company } = await requireCompany(cid, { perm: 'ledger' });
  const sp = await searchParams;
  const [df, dt] = defaultVatPeriod(company.vat_period, today());
  const from = ISO.test(String(sp.from)) ? String(sp.from) : df, to = ISO.test(String(sp.to)) ? String(sp.to) : dt;
  const r = await reconcile(company.id, from, to);
  const b = `/c/${company.id}`;
  return (
    <div style={{ maxWidth: 1100 }}>
      <h1>Momsavstämning</h1>
      <form className="card row">
        <label>Från<input type="date" name="from" defaultValue={from} /></label>
        <label>Till<input type="date" name="to" defaultValue={to} /></label>
        <div style={{ flex: '0 0 auto' }}><button className="secondary">Visa</button></div>
      </form>
      <p className="small">Innan momsdeklarationen lämnas: varje verifikation i perioden med försäljning, moms eller inköp med omvänd skattskyldighet kontrolleras – att momsen motsvarar momssatsen för intäktskontot,
        att momsfri försäljning inte har utgående moms och att omvänd skattskyldighet har både underlag, utgående och ingående moms. Bokförd EU-försäljning jämförs med den periodiska sammanställningen.</p>
      <div className={`card ${r.deviations.length ? 'warn' : ''} vr-summary`}>{r.vouchers} verifikationer kontrollerade · <strong className="vr-count">{r.deviations.length}</strong> med avvikelser</div>

      <h2>Rutor</h2>
      <table className="vr-boxes"><thead><tr><th>Ruta</th><th>Beskrivning</th><th className="num">Belopp</th></tr></thead>
        <tbody>{r.boxes.filter((x) => x.amount).map((x) => <tr key={x.box} data-box={x.box}><td>{x.box}</td><td>{x.label}</td><td className="num">{kr(x.amount)}</td></tr>)}</tbody></table>
      <ul className="stack" style={{ listStyle: 'none', padding: 0 }}>{r.checks.map((c) => <li key={c.key} className={`card small vr-check ${c.ok ? 'ok' : 'warn'}`} data-key={c.key}><b>{c.ok ? '✅' : '⚠️'} {c.title}</b><div>{c.detail}</div></li>)}</ul>

      <h2>Avvikelser per verifikation</h2>
      <table className="vr-deviations"><thead><tr><th>Verifikation</th><th>Datum</th><th>Text</th><th>Avvikelse</th></tr></thead>
        <tbody>{r.deviations.map((v) => <tr key={v.id} className="vr-row" data-keys={v.issues.map((i) => i.key).join(' ')}><td><Link href={`${b}/verifikationer/${v.id}`}>{v.label}</Link></td><td>{v.date}</td><td className="small">{v.description}</td>
          <td className="small">{v.issues.map((i) => <div key={i.key + i.text}>{i.text}</div>)}</td></tr>)}
          {!r.deviations.length && <tr><td colSpan={4} className="muted">Inga avvikelser.</td></tr>}</tbody></table>

      <h2>EU-försäljning mot periodisk sammanställning</h2>
      <table className="vr-eu"><thead><tr><th></th><th className="num">Bokfört (kr)</th><th className="num">Periodisk sammanställning (kr)</th><th className="num">Skillnad</th></tr></thead>
        <tbody>{r.eu.map((e) => <tr key={e.label} className={e.ok ? '' : 'warn'} data-ok={e.ok ? '1' : '0'}><td>{e.label}</td><td className="num">{e.ledger.toLocaleString('sv-SE')}</td><td className="num">{e.ps.toLocaleString('sv-SE')}</td><td className="num">{e.diff.toLocaleString('sv-SE')}</td></tr>)}</tbody></table>
      {r.euMissing.length > 0 && <p className="small warn">Kunder utan momsregistreringsnummer: {r.euMissing.join(', ')}.</p>}
      {r.euManual.length > 0 && <p className="small vr-eu-manual">EU-försäljning bokad utan faktura (kommer inte med i sammanställningen): {r.euManual.map((v) => <Link key={v.id} href={`${b}/verifikationer/${v.id}`}>{v.label} </Link>)}</p>}
      <p className="small"><Link href={`${b}/rapporter/moms?from=${from}&to=${to}`}>Till momsrapporten</Link> · <Link href={`${b}/rapporter/eu`}>Till EU-handel</Link></p>
    </div>
  );
}
