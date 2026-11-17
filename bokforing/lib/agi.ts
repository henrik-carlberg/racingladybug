// Arbetsgivardeklaration på individnivå (AGI), XML enligt Skatteverkets schema version 1.1.
// Schema: http://xmls.skatteverket.se/se/skatteverket/da/arbetsgivardeklaration/arbetsgivardeklaration_1.1.xsd
// Filen laddas upp i Skatteverkets e-tjänst "Arbetsgivardeklaration" → "Lämna via fil".

export interface AgiEmployer {
  agId: string; // 12 siffror: 16 + organisationsnummer, eller personnummer för enskild firma
  contactName: string;
  contactPhone: string;
  contactEmail: string;
}

export interface AgiIndividual {
  personalNumber: string; // ÅÅÅÅMMDDNNNN
  specNumber: number; // specifikationsnummer, unikt per mottagare och period (oftast 1)
  grossCash: number; // öre – ruta 011
  benefits: number; // öre – ruta 012
  tax: number; // öre – ruta 001
}

export interface AgiInput {
  period: string; // ÅÅÅÅ-MM
  employer: AgiEmployer;
  individuals: AgiIndividual[];
  totalEmployerFees: number; // öre – ruta 487
  totalTax: number; // öre – ruta 497
  programName?: string;
  created?: Date;
}

const esc = (s: string) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
/** AGI redovisas i hela kronor (öre stryks) */
const kr = (ore: number) => String(Math.trunc(ore / 100));

function localDateTime(d: Date): string {
  const p = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}T${p(d.getHours())}:${p(d.getMinutes())}:${p(d.getSeconds())}`;
}

export function buildAgiXml(input: AgiInput): string {
  const period = input.period.replace('-', '');
  if (!/^\d{6}$/.test(period)) throw new Error('Ogiltig period, ange ÅÅÅÅ-MM');
  const e = input.employer;
  if (!/^\d{12}$/.test(e.agId)) throw new Error('Arbetsgivarens ID måste vara 12 siffror');
  if (!e.contactName || !e.contactPhone || !e.contactEmail) throw new Error('Kontaktperson (namn, telefon, e-post) krävs för AGI');

  const contact = `<agd:Namn>${esc(e.contactName)}</agd:Namn>
        <agd:Telefon>${esc(e.contactPhone)}</agd:Telefon>
        <agd:Epostadress>${esc(e.contactEmail)}</agd:Epostadress>`;

  const arende = `<agd:Arendeinformation>
      <agd:Arendeagare>${e.agId}</agd:Arendeagare>
      <agd:Period>${period}</agd:Period>
    </agd:Arendeinformation>`;

  const hu = `  <agd:Blankett>
    ${arende}
    <agd:Blankettinnehall>
      <agd:HU>
        <agd:ArbetsgivareHUGROUP>
          <agd:AgRegistreradId faltkod="201">${e.agId}</agd:AgRegistreradId>
        </agd:ArbetsgivareHUGROUP>
        <agd:RedovisningsPeriod faltkod="006">${period}</agd:RedovisningsPeriod>
        <agd:SummaArbAvgSlf faltkod="487">${kr(input.totalEmployerFees)}</agd:SummaArbAvgSlf>
        <agd:SummaSkatteavdr faltkod="497">${kr(input.totalTax)}</agd:SummaSkatteavdr>
      </agd:HU>
    </agd:Blankettinnehall>
  </agd:Blankett>`;

  const ius = input.individuals.map((i) => {
    if (!/^\d{12}$/.test(i.personalNumber)) throw new Error(`Ogiltigt personnummer: ${i.personalNumber}`);
    const fields = [
      `<agd:AvdrPrelSkatt faltkod="001">${kr(i.tax)}</agd:AvdrPrelSkatt>`,
      i.grossCash > 0 ? `<agd:KontantErsattningUlagAG faltkod="011">${kr(i.grossCash)}</agd:KontantErsattningUlagAG>` : '',
      i.benefits > 0 ? `<agd:SkatteplOvrigaFormanerUlagAG faltkod="012">${kr(i.benefits)}</agd:SkatteplOvrigaFormanerUlagAG>` : '',
    ].filter(Boolean);
    return `  <agd:Blankett>
    ${arende}
    <agd:Blankettinnehall>
      <agd:IU>
        <agd:ArbetsgivareIUGROUP>
          <agd:AgRegistreradId faltkod="201">${e.agId}</agd:AgRegistreradId>
        </agd:ArbetsgivareIUGROUP>
        <agd:BetalningsmottagareIUGROUP>
          <agd:BetalningsmottagareIDChoice>
            <agd:BetalningsmottagarId faltkod="215">${i.personalNumber}</agd:BetalningsmottagarId>
          </agd:BetalningsmottagareIDChoice>
        </agd:BetalningsmottagareIUGROUP>
        <agd:RedovisningsPeriod faltkod="006">${period}</agd:RedovisningsPeriod>
        <agd:Specifikationsnummer faltkod="570">${i.specNumber}</agd:Specifikationsnummer>
        ${fields.join('\n        ')}
      </agd:IU>
    </agd:Blankettinnehall>
  </agd:Blankett>`;
  });

  return `<?xml version="1.0" encoding="UTF-8" standalone="no"?>
<Skatteverket omrade="Arbetsgivardeklaration"
  xmlns="http://xmls.skatteverket.se/se/skatteverket/da/instans/schema/1.1"
  xmlns:agd="http://xmls.skatteverket.se/se/skatteverket/da/komponent/schema/1.1"
  xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance"
  xsi:schemaLocation="http://xmls.skatteverket.se/se/skatteverket/da/instans/schema/1.1 http://xmls.skatteverket.se/se/skatteverket/da/arbetsgivardeklaration/arbetsgivardeklaration_1.1.xsd">
  <agd:Avsandare>
    <agd:Programnamn>${esc(input.programName ?? 'Bokforing')}</agd:Programnamn>
    <agd:Organisationsnummer>${e.agId}</agd:Organisationsnummer>
    <agd:TekniskKontaktperson>
      ${contact}
    </agd:TekniskKontaktperson>
    <agd:Skapad>${localDateTime(input.created ?? new Date())}</agd:Skapad>
  </agd:Avsandare>
  <agd:Blankettgemensamt>
    <agd:Arbetsgivare>
      <agd:AgRegistreradId>${e.agId}</agd:AgRegistreradId>
      <agd:Kontaktperson>
        ${contact}
      </agd:Kontaktperson>
    </agd:Arbetsgivare>
  </agd:Blankettgemensamt>
${hu}
${ius.join('\n')}
</Skatteverket>
`;
}
