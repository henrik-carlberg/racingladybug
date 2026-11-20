import { requireCompany } from '@/lib/server/auth';
import { Flash, type SP } from '@/components/ui';
import { kr, today } from '@/lib/format';
import { overview } from '@/lib/services/restaurant';
import { mealVat, meals, representation, z } from './actions';

export const dynamic = 'force-dynamic';

export default async function Restaurant({ params, searchParams }: { params: Promise<{ cid: string }>; searchParams: SP }) {
  const { cid } = await params;
  const sp = await searchParams;
  const ctx = await requireCompany(cid, { perm: 'ledger' });
  const c = ctx.company;
  const t = today();
  const period = /^\d{4}-\d{2}$/.test(String(sp.period ?? '')) ? String(sp.period) : t.slice(0, 7);
  const o = await overview(c.id, period);
  const unbooked = o.meals.filter((m) => !m.booked).reduce((s, m) => s + m.vat, 0);
  const v = (x: number) => String(x / 100).replace('.', ',');
  return (
    <div style={{ maxWidth: 1050 }}>
      <h1>Hotell och restaurang</h1>
      <p className="muted">Dagskassa med mat (12 %) och alkohol (25 %) och kortdricks, personalmat med kostförmån och uttagsmoms, och representation med blandad moms.</p>
      <Flash searchParams={searchParams} />

      <h2>Dagskassa (Z-rapport)</h2>
      <form action={z.bind(null, c.id)} className="card stack">
        <div className="row"><label>Datum<input type="date" name="date" defaultValue={t} /></label><label>Kassa<input name="register" defaultValue="Restaurang" /></label><label>Z-rapport nr<input name="z_number" required /></label></div>
        <div className="row"><label>Mat och alkoholfri dryck inkl. moms 12 % (kr)<input name="food" inputMode="decimal" /></label><label>Alkohol inkl. moms 25 % (kr)<input name="alcohol" inputMode="decimal" /></label><label>Kortdricks (kr)<input name="tips" inputMode="decimal" /></label></div>
        <div className="row"><label>Kontant (kr)<input name="pay_cash" inputMode="decimal" /></label><label>Kort (kr)<input name="pay_card" inputMode="decimal" /></label><label>Swish (kr)<input name="pay_swish" inputMode="decimal" /></label>
          <label className="check" style={{ alignSelf: 'end' }}><input type="checkbox" name="allow_diff" /> Kassadifferens (högst 100 kr)</label></div>
        <div><button>Bokför dagskassan</button></div>
        <span className="small muted">Mat och alkoholfri dryck på restaurang och avhämtning har 12 % moms, alkohol 25 %. Kortdricks är personalens: den bokas som skuld (2897) och betalas ut med lönen som skattepliktig lön. Skuld till personalen just nu: <b className="tips-liability">{kr(o.tipsLiability)}</b> kr.</span>
      </form>
      {o.reports.length > 0 && <table className="small z-reports"><thead><tr><th>Datum</th><th>Kassa</th><th>Z</th><th className="num">Mat 12 %</th><th className="num">Alkohol 25 %</th><th className="num">Dricks</th></tr></thead>
        <tbody>{o.reports.map((r) => <tr key={r.date + r.z_number}><td>{r.date}</td><td>{r.register}</td><td>{r.z_number}</td><td className="num">{kr(r.data.gross['12'] ?? 0)}</td><td className="num">{kr(r.data.gross['25'] ?? 0)}</td><td className="num">{kr(r.data.tips ?? 0)}</td></tr>)}</tbody></table>}

      <h2 id="personalmat">Personalmat {period}</h2>
      <p className="small muted">Fri eller subventionerad mat är en skattepliktig kostförmån: förmånsvärdet enligt Skatteverkets schablon minus vad den anställde betalar läggs på lönen. Restaurangen redovisar dessutom uttagsmoms 12 % på förmånsvärdet. Kontrollera schablonvärdena för året.</p>
      <form method="get" className="row"><label>Månad<input type="month" name="period" defaultValue={period} /></label><button className="secondary">Visa</button></form>
      <form action={meals.bind(null, c.id)} className="card row">
        <input type="hidden" name="period" value={period} />
        <label>Anställd<select name="employee_id" required>{o.employees.map((e) => <option key={e.id} value={e.id}>{e.name}</option>)}</select></label>
        <label>Frukostar<input name="breakfasts" inputMode="numeric" style={{ width: 70 }} /></label><label>Luncher<input name="lunches" inputMode="numeric" style={{ width: 70 }} /></label><label>Middagar<input name="dinners" inputMode="numeric" style={{ width: 70 }} /></label>
        <label>Betalat själv (kr)<input name="paid" inputMode="decimal" style={{ width: 100 }} /></label>
        <label>Värde frukost/lunch/middag (kr)<span className="row"><input name="v_breakfast" defaultValue={v(o.values.breakfast)} style={{ width: 60 }} /><input name="v_lunch" defaultValue={v(o.values.lunch)} style={{ width: 60 }} /><input name="v_dinner" defaultValue={v(o.values.dinner)} style={{ width: 60 }} /></span></label>
        <button className="secondary" disabled={!o.employees.length}>Registrera</button>
      </form>
      {o.meals.length > 0 && <>
        <table className="meals"><thead><tr><th>Anställd</th><th className="num">Frukost</th><th className="num">Lunch</th><th className="num">Middag</th><th className="num">Förmånsvärde</th><th className="num">Betalat</th><th className="num">Till lönen</th><th className="num">Uttagsmoms</th><th></th></tr></thead>
          <tbody>{o.meals.map((m) => <tr key={m.id} className="meal-row"><td>{m.name}</td><td className="num">{m.breakfasts}</td><td className="num">{m.lunches}</td><td className="num">{m.dinners}</td><td className="num">{kr(m.value)}</td><td className="num">{kr(m.paid)}</td><td className="num taxable">{kr(m.taxable)}</td><td className="num vat">{kr(m.vat)}</td><td className="small">{m.booked ? 'Bokförd' : ''}</td></tr>)}</tbody></table>
        <form action={mealVat.bind(null, c.id)} className="actions"><input type="hidden" name="period" value={period} /><button disabled={!unbooked}>Bokför uttagsmoms {kr(unbooked)} kr</button></form>
      </>}

      <h2 id="representation">Representation</h2>
      <form action={representation.bind(null, c.id)} className="card stack">
        <div className="row"><label>Datum<input type="date" name="date" defaultValue={t} /></label><label>Mat inkl. moms 12 % (kr)<input name="food" inputMode="decimal" /></label><label>Dryck med alkohol inkl. moms 25 % (kr)<input name="drinks" inputMode="decimal" /></label><label>Antal deltagare<input name="persons" inputMode="numeric" required style={{ width: 80 }} /></label>
          <label>Betalt med<select name="bank_account"><option value="1930">Företagskonto</option><option value="1910">Kassa</option><option value="2890">Privat utlägg</option></select></label></div>
        <label>Syfte och deltagare<input name="purpose" required placeholder="T.ex. förhandling med leverantör, Anna och Bo från Grossisten AB" /></label>
        <div><button className="secondary">Bokför representation</button></div>
        <span className="small muted">Måltider vid representation är inte avdragsgilla (6072). Momsen får dras av på högst 300 kr exkl. moms per person, fördelat på mat och dryck.</span>
      </form>
    </div>
  );
}
