// ROT- och RUT-avdrag med fakturamodellen (Skatteverkets regler 2026): kunden betalar arbetskostnaden minus
// skattereduktionen och företaget begär resten från Skatteverket. Ren logik (testbar).
import type { InvoiceLineInput, InvoiceTotals } from './invoice';

export type ReductionType = 'rot' | 'rut';

export const REDUCTION = {
  rot: { label: 'ROT-avdrag', pct: 30, maxPerYear: 5_000_000, customerMinPct: 70 },
  rut: { label: 'RUT-avdrag', pct: 50, maxPerYear: 7_500_000, customerMinPct: 50 },
} as const;
/** ROT och RUT tillsammans per person och år (öre) */
export const COMBINED_MAX = 7_500_000;
/** Konto för fordran på Skatteverket (BAS: Kundfordringar – delad faktura) */
export const REDUCTION_ACCOUNT = 1513;

/** Arbetskostnad inklusive moms för raderna markerade som arbete */
export function labourInclVat(lines: (InvoiceLineInput & { labor?: boolean })[], t: InvoiceTotals, reverseCharge = false): number {
  let sum = 0;
  lines.forEach((l, i) => {
    if (!l.labor) return;
    const net = t.lineNets[i];
    sum += net + (reverseCharge ? 0 : Math.round((net * l.vatRate) / 100));
  });
  return sum;
}

/**
 * Skattereduktionen på fakturan i öre, avrundad nedåt till hela kronor.
 * remaining: hur mycket av köparens årstak som finns kvar (öre), om känt.
 */
export function computeReduction(type: ReductionType, labour: number, remaining?: number | null): { reduction: number; uncapped: number; capped: boolean } {
  if (labour <= 0) return { reduction: 0, uncapped: 0, capped: false };
  const uncapped = Math.floor((labour * REDUCTION[type].pct) / 100 / 100) * 100;
  const cap = Math.min(REDUCTION[type].maxPerYear, remaining == null ? Infinity : Math.max(0, remaining));
  const reduction = Math.min(uncapped, Math.floor(cap / 100) * 100);
  return { reduction, uncapped, capped: reduction < uncapped };
}

/** Hur mycket köparen har kvar av årstaken, givet vad som redan har dragits på andra fakturor (öre) */
export function remainingForBuyer(type: ReductionType, used: { rot: number; rut: number }): number {
  const combinedLeft = COMBINED_MAX - used.rot - used.rut;
  const typeLeft = type === 'rot' ? REDUCTION.rot.maxPerYear - used.rot : REDUCTION.rut.maxPerYear - used.rut;
  return Math.max(0, Math.min(combinedLeft, typeLeft));
}

export interface ReductionInfo {
  type: ReductionType | null; buyerPnr: string; property: string; brfOrgnr: string; apartmentNo: string; workType: string;
}

/** Uppgifter som krävs för att fakturan ska kunna ge ROT/RUT-avdrag */
export function reductionErrors(info: ReductionInfo, opts: { labour: number; fSkatt: boolean; pnrValid: boolean }): string[] {
  if (!info.type) return [];
  const e: string[] = [];
  if (!opts.fSkatt) e.push('Företaget måste vara godkänt för F-skatt för att ge ROT/RUT-avdrag');
  if (!opts.pnrValid) e.push('Ange köparens personnummer');
  if (opts.labour <= 0) e.push('Markera minst en rad som arbetskostnad');
  if (!info.workType.trim()) e.push('Ange vilken typ av arbete som har utförts');
  if (info.type === 'rot' && !info.property.trim() && !(info.brfOrgnr.trim() && info.apartmentNo.trim())) {
    e.push('ROT kräver fastighetsbeteckning, eller bostadsrättsföreningens org.nr och lägenhetsnummer');
  }
  return e;
}

/** Personnummer som det skrivs: ÅÅÅÅMMDD-NNNN */
export const formatPnr = (p: string) => (/^\d{12}$/.test(p) ? `${p.slice(0, 8)}-${p.slice(8)}` : p);
