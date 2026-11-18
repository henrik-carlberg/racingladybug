import { requireCompany } from '@/lib/server/auth';
import { type SP } from '@/components/ui';
import { kr, today } from '@/lib/format';
import { parseAmount } from '@/lib/money';
import { CAR_DEFAULTS, carBenefitMonthly, carBenefitYearly } from '@/lib/payroll-extras';

export const dynamic = 'force-dynamic';

export default async function CarBenefit({ params, searchParams }: { params: Promise<{ cid: string }>; searchParams: SP }) {
  const { cid } = await params;
  await requireCompany(cid);
  const sp = await searchParams;
  const year = Number(sp.year ?? today().slice(0, 4));
  const d = CAR_DEFAULTS[year] ?? CAR_DEFAULTS[2026];
  const n = (k: string, def = 0) => parseAmount(String(sp[k] ?? '')) ?? def;
  const price = n('price'), extras = n('extras'), reduction = n('reduction'), tax = n('tax');
  const pbb = n('pbb', d.pbb);
  const slr = Number(String(sp.slr ?? d.slr).replace(',', '.')) || d.slr;
  const yearly = price ? carBenefitYearly({ newCarPrice: price, extras, reduction, vehicleTax: tax, pbb, slr }) : 0;
  const f = (v: number) => (v ? (v / 100).toFixed(0) : '');
  return (
    <div style={{ maxWidth: 760 }}>
      <h1>Bilförmån</h1>
      <p className="muted">Förmånsvärdet för en förmånsbil räknas enligt Skatteverkets schablon: 0,29 prisbasbelopp + nybilspriset × (70 % av statslåneräntan + 1 %) + 13 % av nybilspriset + fordonsskatten.
        Kontrollera prisbasbelopp, statslåneränta och eventuell nedsättning för miljöbil hos Skatteverket – Skatteverkets bilförmånsberäkning gäller.</p>
      <form className="card stack">
        <div className="row">
          <label>Inkomstår<input name="year" defaultValue={year} inputMode="numeric" /></label>
          <label>Prisbasbelopp (kr)<input name="pbb" defaultValue={f(pbb)} inputMode="decimal" /></label>
          <label>Statslåneränta 30 nov året före (%)<input name="slr" defaultValue={String(slr).replace('.', ',')} inputMode="decimal" /></label>
        </div>
        <div className="row">
          <label>Nybilspris (kr)<input name="price" defaultValue={f(price)} inputMode="decimal" required /></label>
          <label>Extrautrustning (kr)<input name="extras" defaultValue={f(extras)} inputMode="decimal" /></label>
          <label>Nedsättning miljöbil (kr)<input name="reduction" defaultValue={f(reduction)} inputMode="decimal" /></label>
          <label>Fordonsskatt per år (kr)<input name="tax" defaultValue={f(tax)} inputMode="decimal" /></label>
        </div>
        <div><button className="secondary">Räkna ut</button></div>
      </form>
      {yearly > 0 && (
        <div className="card">
          <div className="row"><span>Förmånsvärde per år</span><b style={{ textAlign: 'right' }}>{kr(yearly)} kr</b></div>
          <div className="row"><span>Per månad (läggs som förmån på lönespecen)</span><b className="car-monthly" style={{ textAlign: 'right' }}>{kr(carBenefitMonthly(yearly))} kr</b></div>
          <p className="small muted" style={{ marginBottom: 0 }}>Ange månadsbeloppet som bilförmån på den anställda under Lön → Anställda. Det läggs då till som skattepliktig förmån i varje lönekörning och ingår i skatte- och avgiftsunderlaget. Betalar den anställda drivmedel själv eller gör nettolöneavdrag minskar värdet – justera på lönespecen.</p>
        </div>
      )}
    </div>
  );
}
