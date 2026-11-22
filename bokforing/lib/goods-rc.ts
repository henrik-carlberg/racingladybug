// Omvänd skattskyldighet för vissa varor inom Sverige (ML 2023:200 kap. 16): säljaren tar inte ut moms, köparen redovisar den (ren logik).
export type GoodsCategory = 'electronics' | 'metals' | 'gold' | 'scrap';
export const CATEGORY: Record<GoodsCategory, { label: string; min: number }> = {
  electronics: { label: 'Mobiltelefoner, datorkretsar, surfplattor, bärbara datorer och spelkonsoler (minst 100 000 kr per faktura)', min: 10000000 },
  metals: { label: 'Vissa metaller (bl.a. koppar, zink, nickel, aluminium)', min: 0 },
  gold: { label: 'Guldmaterial och investeringsguld (vid frivillig skattskyldighet)', min: 0 },
  scrap: { label: 'Avfall, skrot och returmaterial', min: 0 },
};
export const GOODS_RC_ACCOUNT = 3232;

/** Kontroll av fakturan: köparen ska vara ett företag i Sverige och elektronik kräver att värdet exkl. moms är minst 100 000 kr */
export function goodsRcError(o: { category: string; net: number; buyerIsCompany: boolean; buyerCountry: string }): string | null {
  const c = CATEGORY[o.category as GoodsCategory];
  if (!c) return 'Välj varuslag för omvänd skattskyldighet';
  if (!o.buyerIsCompany) return 'Omvänd skattskyldighet för varor gäller bara när köparen är ett företag (ange organisationsnummer)';
  if (o.buyerCountry && o.buyerCountry.toUpperCase() !== 'SE') return 'Omvänd skattskyldighet för varor gäller köpare i Sverige';
  if (o.net < c.min) return `Under ${Math.round(c.min / 100).toLocaleString('sv-SE')} kr exkl. moms gäller vanlig moms för elektronik`;
  return null;
}

const ELECTRONICS = /(mobil|telefon|iphone|smartphone|surfplatt|ipad|tablet|bärbar dator|laptop|spelkonsol|playstation|xbox|processor|datorkrets|integrerad krets|cpu|gpu)/i;
const METALS = /(skrot|koppar|zink|nickel|alumin|metallskrot|returmaterial|avfall|guld)/i;
/** Varning: fakturan har vanlig moms men ser ut att gälla varor där köparen ska redovisa momsen */
export function goodsRcWarning(o: { rcKind: string; buyerIsCompany: boolean; net: number; lines: { description: string }[] }): string | null {
  if (o.rcKind || !o.buyerIsCompany) return null;
  const text = o.lines.map((l) => l.description).join(' ');
  if (METALS.test(text)) return 'Fakturan verkar gälla metaller, guld eller skrot – där gäller omvänd skattskyldighet och säljaren ska inte ta ut moms';
  if (ELECTRONICS.test(text) && o.net >= CATEGORY.electronics.min) return 'Fakturan verkar gälla mobiltelefoner, datorkretsar eller liknande för minst 100 000 kr – där gäller omvänd skattskyldighet och säljaren ska inte ta ut moms';
  return null;
}
