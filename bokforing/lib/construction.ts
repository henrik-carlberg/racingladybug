// Bygg och entreprenad (ren logik): ÄTA-arbeten, innehållna belopp och kontroll av omvänd byggmoms per fakturarad. Belopp i öre.
export const RETAINED_RECEIVABLE = 1682;  // Innehållna belopp hos kunder (fordran tills slutbesiktning/garantitid)
export const RETAINED_PAYABLE = 2446;     // Innehållna belopp till leverantörer och underentreprenörer
export const CUSTOMER_RECEIVABLE = 1510;
export const SUPPLIER_PAYABLE = 2440;

export type AtaKind = 'tillagg' | 'andring' | 'avgaende';
export const ATA_LABEL: Record<AtaKind, string> = { tillagg: 'Tilläggsarbete', andring: 'Ändringsarbete', avgaende: 'Avgående arbete' };
export interface ChangeOrder { kind: AtaKind; amount: number; cost: number; status: 'proposed' | 'approved' | 'rejected'; decided_on: string | null }

/** Avgående arbeten minskar kontraktssumman och kostnaden; övriga ökar (beloppen anges positiva) */
export function signed(kind: AtaKind, v: number) { return kind === 'avgaende' ? -Math.abs(v) : Math.abs(v); }

/** Godkända ÄTA per ett datum: ändring av kontraktsvärde och beräknad kostnad, samt det som väntar på beslut */
export function ataEffect(orders: ChangeOrder[], at: string) {
  let value = 0, cost = 0, pending = 0, pendingCount = 0;
  for (const o of orders) {
    if (o.status === 'approved' && o.decided_on && o.decided_on <= at) { value += signed(o.kind, o.amount); cost += signed(o.kind, o.cost); }
    if (o.status === 'proposed') { pending += signed(o.kind, o.amount); pendingCount++; }
  }
  return { value, cost, pending, pendingCount };
}

/** Innehållet belopp: procent av fakturans totalbelopp (inkl. moms), avrundat till hela kronor och aldrig mer än det obetalda */
export function retentionAmount(total: number, pct: number, open: number) {
  if (!(pct > 0 && pct <= 50)) throw new Error('Andelen ska vara mellan 0 och 50 %');
  return Math.min(open, Math.round((total * pct) / 100 / 100) * 100);
}

/** Kundsidan: fordran flyttas från kundfordringar till innehållna belopp; vid frisläppandet betalar kunden in den */
export function retentionLines(side: 'customer' | 'supplier', step: 'retain' | 'release', amount: number, bank = 1930) {
  if (side === 'customer') return step === 'retain'
    ? [{ account: RETAINED_RECEIVABLE, amount }, { account: CUSTOMER_RECEIVABLE, amount: -amount }]
    : [{ account: bank, amount }, { account: RETAINED_RECEIVABLE, amount: -amount }];
  return step === 'retain'
    ? [{ account: SUPPLIER_PAYABLE, amount }, { account: RETAINED_PAYABLE, amount: -amount }]
    : [{ account: RETAINED_PAYABLE, amount }, { account: bank, amount: -amount }];
}

// Skatteverkets exempel (SKV 552 och ställningstaganden): byggtjänster som omfattas respektive inte omfattas av omvänd betalningsskyldighet
const BYGG = /(bygg|rivning|riv |montering|monter|installation|installer|el-?arbete|elinstallation|vvs|rörarbete|rörlägg|måla|måleri|målning|golv|takarbete|takläggning|takbyte|plåtarbete|plåtslageri|mur|puts|kakel|plattsättning|snickeri|snickar|isolering|schakt|mark(arbete|entreprenad)|anläggning|grundläggning|betong|ställning|byggstäd|sanering|fönsterbyte|dörrmontage|ventilation|värmepump|reparation av (hus|byggnad|fastighet)|renovering|ombyggnad|tillbyggnad)/i;
const INTE = /(material(leverans)?\b|enbart material|varor|leverans av|arkitekt|konsult|projektering|besiktning|kontroll(ant)?|transport|frakt|maskinhyra|hyra av maskin|uthyrning utan|städ(ning)?(?! efter bygg)|fönsterputs|trädgård|snöröjning|flytt|bevakning|utbildning|ritning)/i;

export type LineVerdict = { status: 'ok' | 'warn'; note: string };
/**
 * Kontroll per fakturarad. På en faktura med omvänd byggmoms ska varje rad vara en byggtjänst (eller material som ingår i den);
 * en faktura utan omvänd byggmoms till ett företag varnar om en rad ser ut som en byggtjänst.
 */
export function rcCheck(o: { rcKind: string; customerIsCompany: boolean; lines: { description: string }[] }): LineVerdict[] {
  const onlyMaterial = o.lines.length > 0 && o.lines.every((l) => INTE.test(l.description) && !BYGG.test(l.description));
  return o.lines.map((l) => {
    const bygg = BYGG.test(l.description), inte = INTE.test(l.description);
    if (o.rcKind === 'construction') {
      if (onlyMaterial) return { status: 'warn', note: 'Ren vara eller tjänst utan byggarbete omfattas inte – fakturan ska ha vanlig moms' };
      if (inte && !bygg) return { status: 'warn', note: 'Ser inte ut som en byggtjänst (t.ex. konsult, transport eller maskinhyra utan förare) – fakturera separat med moms om den inte ingår i byggtjänsten' };
      return { status: 'ok', note: bygg ? 'Byggtjänst – omvänd betalningsskyldighet' : 'Ingår i byggtjänsten' };
    }
    if (o.rcKind === '' && o.customerIsCompany && bygg && !inte) return { status: 'warn', note: 'Ser ut som en byggtjänst – kontrollera om köparen är byggföretag (då gäller omvänd byggmoms)' };
    return { status: 'ok', note: '' };
  });
}
