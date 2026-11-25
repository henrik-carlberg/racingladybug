// Företagsvärdering (substansvärde, avkastningsvärde, EBIT-multipel) och skatt vid ägarskifte. Belopp i öre.
export const CORPORATE_TAX = 0.206;
export const SERVICE_TAX = 0.52; // uppskattad marginalskatt på den tjänstebeskattade delen

/** Justerat eget kapital: eget kapital + obeskattade reserver och övervärden efter latent skatt */
export const substanceValue = (o: { equity: number; untaxedReserves: number; surplus: number }) =>
  Math.round(o.equity + (o.untaxedReserves + o.surplus) * (1 - CORPORATE_TAX));
/** Avkastningsvärde: normaliserat resultat efter skatt delat med avkastningskravet */
export const earningsValue = (avgEbit: number, requiredReturnPct: number) => (requiredReturnPct > 0 ? Math.max(0, Math.round(avgEbit * (1 - CORPORATE_TAX) / (requiredReturnPct / 100))) : 0);
/** EBIT-multipel: rörelseresultat × multipel plus nettokassa (likvida medel minus räntebärande skulder) */
export const multipleValue = (avgEbit: number, multiple: number, netCash: number) => Math.max(0, Math.round(Math.max(0, avgEbit) * multiple + netCash));
export const average = (xs: number[]) => (xs.length ? Math.round(xs.reduce((a, x) => a + x, 0) / xs.length) : 0);

/** Skatt för säljaren av kvalificerade andelar (3:12): inom gränsbeloppet 20 %, därutöver tjänst upp till 100 IBB, sedan 20 %. Okvalificerade: 25 %. */
export function saleTax(o: { price: number; costBasis: number; limit: number; ibb: number; qualified: boolean; priorService?: number }) {
  const gain = Math.max(0, o.price - o.costBasis);
  if (!o.qualified) return { gain, within: 0, service: 0, above: gain, tax: Math.round(gain * 0.25), net: o.price - Math.round(gain * 0.25) };
  const within = Math.min(gain, Math.max(0, o.limit));
  const rest = gain - within;
  const service = Math.min(rest, Math.max(0, 100 * o.ibb * 100 - (o.priorService ?? 0)));
  const above = rest - service;
  const tax = Math.round(within * 0.2 + service * SERVICE_TAX + above * 0.2);
  return { gain, within, service, above, tax, net: o.price - tax };
}

/** Huvudsaklighetsprincipen: ersättning upp till omkostnadsbeloppet gör överlåtelsen till en gåva (ingen skatt, mottagaren tar över omkostnadsbeloppet) */
export const isGift = (price: number, costBasis: number) => price <= costBasis;

export const CHECKLIST: Record<'sale' | 'gift', { key: string; text: string }[]> = {
  sale: [
    { key: 'valuation', text: 'Värdering klar och avstämd med köparen (substans-, avkastnings- och multipelvärde)' },
    { key: 'dd', text: 'Due diligence: avtal, tvister, skatter, personal och immateriella rättigheter genomgångna' },
    { key: 'k10', text: 'Gränsbelopp och sparat utdelningsutrymme räknat i K10 för försäljningsåret' },
    { key: 'dividend', text: 'Utdelning före försäljningen övervägd (utnyttja gränsbeloppet)' },
    { key: 'spa', text: 'Aktieöverlåtelseavtal med garantier, tillträdesdag och betalningsvillkor' },
    { key: 'board', text: 'Styrelse, firmateckning och verklig huvudman ändrade hos Bolagsverket' },
    { key: 'shareregister', text: 'Aktieboken uppdaterad' },
    { key: 'karens', text: 'Karenstid: säljaren förstår att andelarna förblir kvalificerade i fem år om verksamhet fortsätter i närstående bolag' },
    { key: 'declaration', text: 'Försäljningen redovisas på K10 i deklarationen året efter' },
  ],
  gift: [
    { key: 'valuation', text: 'Värdering som underlag för fördelning mellan syskon/arvingar' },
    { key: 'deed', text: 'Gåvobrev med villkor (enskild egendom, hembud, förköp)' },
    { key: 'continuity', text: 'Mottagaren tar över omkostnadsbelopp och sparat utdelningsutrymme (kontinuitetsprincipen)' },
    { key: 'price', text: 'Eventuell ersättning understiger omkostnadsbeloppet (annars beskattas överlåtelsen som försäljning)' },
    { key: 'shareholders', text: 'Aktieägaravtal och bolagsordning tillåter överlåtelsen (hembud/samtycke)' },
    { key: 'board', text: 'Styrelse, firmateckning och verklig huvudman ändrade hos Bolagsverket' },
    { key: 'shareregister', text: 'Aktieboken uppdaterad' },
    { key: 'k10', text: 'Mottagaren lämnar K10 från och med året efter överlåtelsen' },
  ],
};
