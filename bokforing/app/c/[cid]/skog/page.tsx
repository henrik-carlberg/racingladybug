import { requireCompany } from '@/lib/server/auth';
import { Flash, type SP } from '@/components/ui';
import { kr, today } from '@/lib/format';
import { KIND_LABEL } from '@/lib/forest';
import { overview } from '@/lib/services/forest';
import { addSale, deposit, saveSettings, setDeduction, withdraw } from './actions';

export const dynamic = 'force-dynamic';
const krIn = (o: number) => (o ? String(o / 100).replace('.', ',') : '0');

/** Skogskonto, skogsskadekonto och skogsavdrag för enskild näringsidkare */
export default async function Forest({ params, searchParams }: { params: Promise<{ cid: string }>; searchParams: SP }) {
  const { cid } = await params;
  const sp = await searchParams;
  const { company } = await requireCompany(cid, { perm: 'ledger' });
  if (company.company_type !== 'EF') return <div style={{ maxWidth: 800 }}><h1>Skogsbruk</h1><p className="sk-not-ef">Skogskonto, skogsskadekonto och skogsavdrag finns för enskild näringsverksamhet. Ett aktiebolag med skogsbruk periodiserar i stället med periodiseringsfond och avskrivningar.</p></div>;
  const year = /^\d{4}$/.test(String(sp.ar ?? '')) ? Number(sp.ar) : Number(today().slice(0, 4));
  const o = await overview(company.id, year);
  const Y = <input type="hidden" name="tax_year" value={year} />;
  return (
    <div style={{ maxWidth: 1000 }}>
      <h1>Skogsbruk</h1>
      <Flash searchParams={searchParams} />
      <p className="small">Likvid från avverkning kan sättas in på skogskonto (högst 60 % för rotpost och avverkningsuppdrag, 40 % för leveransvirke) eller skogsskadekonto (80 % respektive 50 %)
        och dras av som kostnad för beskattningsåret. Uttag beskattas det år de görs. Skogsavdrag får göras med högst 50 % av rotpostintäkt och 30 % av leveransvirke,
        sammanlagt högst halva anskaffningsvärdet för skogen. Insättning och skogsavdrag redovisas i NE-bilagan.</p>
      <form className="row" method="get"><label>Beskattningsår<input name="ar" defaultValue={year} style={{ width: '6rem' }} /></label><div style={{ flex: '0 0 auto' }}><button className="secondary">Visa</button></div></form>
      <div className="grid">
        <div className="card stat"><div className="label">Kvar att sätta in på skogskonto {year}</div><div className="value sk-room-skog">{kr(o.room.skog)}</div></div>
        <div className="card stat"><div className="label">Kvar att sätta in på skogsskadekonto {year}</div><div className="value sk-room-skada">{kr(o.room.skada)}</div></div>
        <div className="card stat"><div className="label">Saldo skogskonto</div><div className="value sk-bal-skog">{kr(o.balance.skog)}</div></div>
        <div className="card stat"><div className="label">Högsta skogsavdrag {year}</div><div className="value sk-ded-max">{kr(o.deductionRoom.max)}</div></div>
      </div>
      <h2>Likvider {year}</h2>
      <table className="sk-sales"><tbody>{o.sales.map((s) => <tr key={s.id}><td>{s.date}</td><td>{KIND_LABEL[s.kind]}</td><td className="num">{kr(s.amount)}</td><td>{s.note}</td></tr>)}</tbody></table>
      <form action={addSale.bind(null, company.id)} className="card row">
        <label>Datum<input type="date" name="date" defaultValue={`${year}-${today().slice(5)}`} /></label>
        <label>Slag<select name="kind">{Object.entries(KIND_LABEL).map(([k, v]) => <option key={k} value={k}>{v}</option>)}</select></label>
        <label>Likvid exkl. moms (kr)<input name="amount" required style={{ width: '9rem' }} /></label>
        <label>Notering<input name="note" maxLength={200} /></label>
        <div style={{ flex: '0 0 auto' }}><button className="secondary">Registrera likvid</button></div>
      </form>
      <h2>Insättning och uttag</h2>
      <div className="row" style={{ alignItems: 'start' }}>
        <form action={deposit.bind(null, company.id)} className="card stack sk-deposit" style={{ flex: 1 }}>{Y}
          <label>Konto<select name="account"><option value="skog">Skogskonto</option><option value="skada">Skogsskadekonto</option></select></label>
          <label>Belopp (kr)<input name="amount" required /></label>
          <label>Datum<input type="date" name="date" defaultValue={today()} /></label>
          <div><button>Bokför insättning för {year}</button></div>
        </form>
        <form action={withdraw.bind(null, company.id)} className="card stack sk-withdraw" style={{ flex: 1 }}>
          <label>Konto<select name="account"><option value="skog">Skogskonto</option><option value="skada">Skogsskadekonto</option></select></label>
          <label>Belopp (kr)<input name="amount" required /></label>
          <label>Datum<input type="date" name="date" defaultValue={today()} /></label>
          <div><button className="secondary">Bokför uttag</button></div>
        </form>
      </div>
      <h2>Skogsavdrag och NE-bilagan {year}</h2>
      <table className="sk-ne"><tbody>
        <tr><td>Insättning på skogskonto och skogsskadekonto (avdrag)</td><td className="num sk-ne-deposit">{kr(o.deposited.skog + o.deposited.skada)}</td></tr>
        <tr><td>Uttag från skogskonto och skogsskadekonto (intäkt)</td><td className="num sk-ne-withdrawn">{kr(o.withdrawnThisYear)}</td></tr>
        <tr><td>Skogsavdrag (av årets intäkter {kr(o.deductionRoom.ofIncome)}, kvar av halva anskaffningsvärdet {kr(o.deductionRoom.total)})</td><td className="num sk-ne-ded">{kr(o.deduction)}</td></tr>
      </tbody></table>
      <form action={setDeduction.bind(null, company.id)} className="row">{Y}
        <label>Skogsavdrag (kr)<input name="amount" defaultValue={krIn(o.deduction)} style={{ width: '9rem' }} /></label>
        <div style={{ flex: '0 0 auto' }}><button className="secondary">Spara skogsavdrag</button></div>
      </form>
      <form action={saveSettings.bind(null, company.id)} className="card row" style={{ marginTop: '1rem' }}>{Y}
        <label>Anskaffningsvärde för skogen, skogsavdragsunderlag (kr)<input name="acquisition_value" defaultValue={krIn(o.settings.acquisition_value)} /></label>
        <label>Skogsavdrag gjorda före appen (kr)<input name="used_before" defaultValue={krIn(o.settings.used_before)} /></label>
        <div style={{ flex: '0 0 auto' }}><button className="secondary">Spara</button></div>
      </form>
    </div>
  );
}
