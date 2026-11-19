// Momsdeklaration som eSKD-fil (Skatteverkets filformat för momsdeklaration, version 6.0). Ren logik.
// Beloppen anges i hela kronor; tomma rutor utelämnas.

/** Ruta → elementnamn i eSKD */
export const ESKD_FIELDS: Record<string, string> = {
  '05': 'ForsMomsEjAnnan', '06': 'UttagMoms', '07': 'UlagMargbesk', '08': 'HyrinkomstFriv',
  '10': 'MomsUtgHog', '11': 'MomsUtgMedel', '12': 'MomsUtgLag',
  '20': 'InkopVaruAnnatEg', '21': 'InkopTjanstAnnatEg', '22': 'InkopTjanstUtomEg', '23': 'InkopVaruSverige', '24': 'InkopTjanstSverige',
  '30': 'MomsInkopUtgHog', '31': 'MomsInkopUtgMedel', '32': 'MomsInkopUtgLag',
  '35': 'ForsVaruAnnatEg', '36': 'ForsVaruUtomEg', '37': 'InkopVaruMellan3p', '38': 'ForsVaruMellan3p',
  '39': 'ForsTjSkskAnnatEg', '40': 'ForsTjOvrUtomEg', '41': 'ForsKopareSkskSverige', '42': 'ForsOvrigt',
  '48': 'MomsIngAvdr', '49': 'MomsBetala', '50': 'MomsUlagImport', '60': 'MomsImportUtgHog', '61': 'MomsImportUtgMedel', '62': 'MomsImportUtgLag',
};
const ORDER = ['05', '06', '07', '08', '20', '21', '22', '23', '24', '50', '35', '36', '37', '38', '39', '40', '41', '42', '10', '11', '12', '30', '31', '32', '60', '61', '62', '48', '49'];

/** Redovisningsperiod som ÅÅÅÅMM (sista månaden i perioden) */
export const eskdPeriod = (periodEnd: string) => periodEnd.slice(0, 4) + periodEnd.slice(5, 7);

export function buildEskd(o: { orgnr: string; periodEnd: string; boxes: { box: string; amount: number }[] }): string {
  const org = o.orgnr.replace(/\D/g, '');
  const nr = org.length === 10 ? `16${org}` : org; // Skatteverket anger organisationsnummer med sekelsiffror 16
  const by = new Map(o.boxes.map((b) => [b.box, Math.trunc(b.amount / 100)]));
  const fields = ORDER.filter((b) => (b === '49' ? by.has(b) : (by.get(b) ?? 0) !== 0)).map((b) => `    <${ESKD_FIELDS[b]}>${by.get(b) ?? 0}</${ESKD_FIELDS[b]}>`).join('\n');
  return `<?xml version="1.0" encoding="ISO-8859-1"?>
<!DOCTYPE eSKDUpload PUBLIC "-//Skatteverket, Sweden//DTD Skatteverket eSKDUpload-DTD Version 6.0//SV" "https://www1.skatteverket.se/demoeskd/eSKDUpload_6p0.dtd">
<eSKDUpload Version="6.0">
  <OrgNr>${nr.slice(0, 8)}-${nr.slice(8)}</OrgNr>
  <Moms>
    <Period>${eskdPeriod(o.periodEnd)}</Period>
${fields}
  </Moms>
</eSKDUpload>
`;
}
