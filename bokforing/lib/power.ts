// Egen elproduktion. Belopp i öre, energi i kWh.
export const POWER_SALES = 3060, CERT_SALES = 3061, VAT_OUT = 2611;
/** Skattereduktion för mikroproduktion, öre per kWh per inkomstår. Saknas året är nivån inte känd här – kontrollera hos Skatteverket. */
export const REDUCTION_ORE: Record<number, number> = { 2021: 60, 2022: 60, 2023: 60, 2024: 60, 2025: 60 };
export const REDUCTION_MAX_KWH = 30000;

/** Underlag för skattereduktionen: inmatad (såld) el, högst den el som köpts från nätet och högst 30 000 kWh per år */
export function reduction(year: number, soldKwh: number, boughtKwh: number) {
  const basis = Math.min(soldKwh, boughtKwh, REDUCTION_MAX_KWH);
  const rate = REDUCTION_ORE[year];
  return { basis: Math.round(basis * 10) / 10, rate: rate ?? null, amount: rate != null ? Math.round(basis * rate) : null };
}

export function saleLines(net: number, vatRate: number, income: number, bank = 1930) {
  const vat = Math.round(net * vatRate / 100);
  return [{ account: bank, amount: net + vat }, { account: income, amount: -net }, ...(vat ? [{ account: VAT_OUT, amount: -vat }] : [])];
}

/** Årets sammanställning och återbetalningstid (investering / årets intäkter) */
export function yearSummary(months: { produced_kwh: number; sold_kwh: number; sold_amount: number }[], certificates: number, investment: number) {
  const produced = months.reduce((s, m) => s + m.produced_kwh, 0), sold = months.reduce((s, m) => s + m.sold_kwh, 0);
  const revenue = months.reduce((s, m) => s + m.sold_amount, 0) + certificates;
  return { produced: Math.round(produced * 10) / 10, sold: Math.round(sold * 10) / 10, own: Math.round((produced - sold) * 10) / 10, revenue,
    payback: revenue > 0 && investment > 0 ? Math.round(investment / revenue * 10) / 10 : null };
}
