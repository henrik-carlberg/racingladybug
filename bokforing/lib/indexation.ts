// Indexuppräkning. Priser i öre.

/** Faktor mot basmånaden: indexförändringen gånger den andel av priset som är indexreglerad; med golv sänks priset aldrig under baspriset */
export function indexFactor(o: { base: number; current: number; share: number; floor: boolean }) {
  const f = 1 + (o.current / o.base - 1) * o.share / 100;
  return Math.round((o.floor ? Math.max(1, f) : f) * 1e6) / 1e6;
}

/** Nytt pris räknas från baspriset (inte från förra årets pris), så att avrundningar inte ackumuleras */
export const indexedPrice = (basePrice: number, factor: number) => Math.round(basePrice * factor);

export function change(oldPrice: number, newPrice: number) {
  return { diff: newPrice - oldPrice, pct: oldPrice ? Math.round((newPrice - oldPrice) / oldPrice * 1000) / 10 : 0 };
}
