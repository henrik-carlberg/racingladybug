// Fåmansföretag (ren logik): utdelningsplan för flera ägare, sparat utdelningsutrymme år för år och kapitalförsäkring. Belopp i öre.
export const CAPITAL_INSURANCE = 1385;      // Värde av kapitalförsäkring
export const INSURANCE_WRITEDOWN = 8270;    // Nedskrivning av kapitalförsäkring
export const YIELD_TAX_RATE = 0.30;

/** Utdelning fördelas efter ägarandel; per ägare inom och över gränsbeloppet samt största utdelning som ryms inom alla gränsbelopp */
export function dividendPlan(total: number, owners: { id: number; name: string; share: number; limit: number }[]) {
  const sum = owners.reduce((s, o) => s + o.share, 0);
  let left = total;
  const rows = owners.map((o, i) => {
    const amount = i === owners.length - 1 ? left : Math.round((total * o.share) / (sum || 100));
    left -= amount;
    const within = Math.min(amount, Math.max(0, o.limit));
    return { ...o, amount, within, above: amount - within, tax: Math.round(within * 0.2) };
  });
  const maxWithin = owners.length && sum ? Math.floor(Math.min(...owners.map((o) => (o.share > 0 ? (Math.max(0, o.limit) * sum) / o.share : Infinity)))) : 0;
  return { rows, maxWithin: Number.isFinite(maxWithin) ? maxWithin : 0, above: rows.reduce((s, r) => s + r.above, 0) };
}

/** Sparat utdelningsutrymme till år Y: sparat belopp från den senast sparade K10 före Y, annars det manuellt angivna */
export function savedSpaceFor(year: number, history: { year: number; saved_next: number }[], manual: number) {
  const prev = history.filter((h) => h.year < year).sort((a, b) => b.year - a.year)[0];
  if (!prev) return { amount: manual, from: null as number | null };
  // Ett hoppat år (ingen K10) förs ändå vidare – utrymmet finns kvar så länge ägaren har aktierna
  return { amount: prev.saved_next, from: prev.year };
}

/**
 * Avkastningsskatt på kapitalförsäkring (lag 1990:661): kapitalunderlag = värdet vid årets ingång + premier under året
 * (premier andra halvåret till halva beloppet), schablonränta = statslåneräntan 30 november året före + 1 procentenhet, lägst 1,25 %, skattesats 30 %.
 */
export function yieldTax(o: { valueJan1: number; premiumsH1: number; premiumsH2: number; slr: number }) {
  const base = Math.max(0, o.valueJan1) + Math.max(0, o.premiumsH1) + Math.max(0, o.premiumsH2) / 2;
  const rate = Math.max(o.slr + 1, 1.25);
  return { base: Math.round(base), rate, tax: Math.round((base * rate) / 100 * YIELD_TAX_RATE) };
}

/** Kapitalförsäkringen redovisas till anskaffningsvärde; bestående värdenedgång under bokfört värde skrivs ned */
export function insuranceWritedown(booked: number, marketValue: number) {
  return Math.max(0, booked - Math.max(0, marketValue));
}
