// Kvitton och utlägg i vardagsspråk → kontering. Ren logik (testbar).
import { fromSigned, type Line } from './ledger-lines';

export interface ReceiptCategory {
  key: string;
  label: string;
  group: string;
  account: number;
  vat: 0 | 6 | 12 | 25; // vanligaste momssatsen
  help?: string;
  representation?: boolean;
}

export const RECEIPT_CATEGORIES: ReceiptCategory[] = [
  { key: 'kontor', label: 'Kontorsmaterial', group: 'Kontor och IT', account: 6110, vat: 25 },
  { key: 'it_utrustning', label: 'Dator, skärm, mobil (under ca 29 000 kr)', group: 'Kontor och IT', account: 5410, vat: 25,
    help: 'Inköp under ett halvt prisbasbelopp kostnadsförs direkt. Dyrare inventarier ska skrivas av – fråga din redovisningskonsult.' },
  { key: 'programvara', label: 'Programvara och prenumerationer', group: 'Kontor och IT', account: 5420, vat: 25,
    help: 'Utländska tjänster (t.ex. från USA) har ofta ingen svensk moms – välj 0 % och kontrollera omvänd skattskyldighet.' },
  { key: 'telefon', label: 'Telefon och mobilabonnemang', group: 'Kontor och IT', account: 6212, vat: 25 },
  { key: 'internet', label: 'Internet och datakommunikation', group: 'Kontor och IT', account: 6230, vat: 25 },
  { key: 'porto', label: 'Porto och frakt', group: 'Kontor och IT', account: 6250, vat: 25 },
  { key: 'litteratur', label: 'Facklitteratur och tidningar', group: 'Kontor och IT', account: 6970, vat: 6 },
  { key: 'tag_flyg', label: 'Tåg, flyg, buss', group: 'Resor', account: 5810, vat: 6 },
  { key: 'taxi', label: 'Taxi', group: 'Resor', account: 5810, vat: 6 },
  { key: 'hotell', label: 'Hotell (logi)', group: 'Resor', account: 5831, vat: 12 },
  { key: 'drivmedel', label: 'Drivmedel (företagets bil)', group: 'Resor', account: 5611, vat: 25 },
  { key: 'parkering', label: 'Parkering och trängselskatt', group: 'Resor', account: 5800, vat: 25, help: 'Trängselskatt har ingen moms – välj 0 %.' },
  { key: 'representation', label: 'Representation (affärsmåltid med kund)', group: 'Kunder och marknad', account: 6072, vat: 12, representation: true,
    help: 'Måltider vid representation är inte avdragsgilla i deklarationen, men momsen får dras av på högst 300 kr exkl. moms per person.' },
  { key: 'fika_kund', label: 'Enklare förtäring (kaffe, fikabröd)', group: 'Kunder och marknad', account: 6071, vat: 12 },
  { key: 'reklam', label: 'Reklam och annonser', group: 'Kunder och marknad', account: 5910, vat: 25 },
  { key: 'personal_fika', label: 'Fika och personalaktivitet', group: 'Personal', account: 7690, vat: 12 },
  { key: 'friskvard', label: 'Friskvård (gym, massage)', group: 'Personal', account: 7690, vat: 25,
    help: 'Skattefri friskvård upp till 5 000 kr per anställd och år.' },
  { key: 'konsult', label: 'Konsult, tjänst, hantverkare', group: 'Övrigt', account: 6550, vat: 25 },
  { key: 'redovisning', label: 'Redovisning och revision', group: 'Övrigt', account: 6530, vat: 25 },
  { key: 'forbrukning', label: 'Förbrukningsmaterial', group: 'Övrigt', account: 5460, vat: 25 },
  { key: 'varor', label: 'Varor för vidareförsäljning / material', group: 'Övrigt', account: 4010, vat: 25 },
  { key: 'lokal', label: 'Lokalhyra', group: 'Övrigt', account: 5010, vat: 25 },
  { key: 'forsakring', label: 'Försäkring', group: 'Övrigt', account: 6310, vat: 0 },
  { key: 'bankavgift', label: 'Bankavgift', group: 'Övrigt', account: 6570, vat: 0 },
  { key: 'medlemsavgift', label: 'Medlemsavgift (bransch-/företagarförening)', group: 'Övrigt', account: 6981, vat: 0 },
  { key: 'ovrigt', label: 'Övrigt', group: 'Övrigt', account: 6900, vat: 25 },
];

export type PaidWith = 'company' | 'private';

/** Konto som krediteras: företagets bankkonto, eller skuld till ägaren (AB) / egen insättning (EF) vid privat utlägg */
export function paymentAccount(paidWith: PaidWith, companyType: 'AB' | 'EF' | 'HB' | 'KB'): number {
  if (paidWith === 'company') return 1930;
  return companyType === 'AB' ? 2893 : 2018;
}

export interface ReceiptInput {
  category: ReceiptCategory;
  total: number; // öre inkl. moms
  vatRate: 0 | 6 | 12 | 25;
  persons?: number; // representation
  paidWith: PaidWith;
  companyType: 'AB' | 'EF' | 'HB' | 'KB';
  description?: string;
}

/** Konterar ett kvitto: kostnad + avdragsgill ingående moms mot bank eller skuld till ägaren */
export function receiptLines(r: ReceiptInput): { lines: Line[]; net: number; vat: number; deductibleVat: number } {
  const net = Math.round((r.total * 100) / (100 + r.vatRate));
  const vat = r.total - net;
  let deductibleVat = vat;
  if (r.category.representation) {
    // Moms får dras av på underlag om högst 300 kr exkl. moms per person och tillfälle
    const persons = Math.max(1, r.persons ?? 1);
    deductibleVat = Math.min(vat, Math.round(30000 * persons * (r.vatRate / 100)));
  }
  const cost = r.total - deductibleVat; // ej avdragsgill moms blir kostnad
  const lines = fromSigned([
    { account: r.category.account, amount: cost, description: r.description },
    { account: 2641, amount: deductibleVat },
    { account: paymentAccount(r.paidWith, r.companyType), amount: -r.total },
  ]);
  return { lines, net, vat, deductibleVat };
}

export interface ReceiptGuess { date: string; total: number | null; vatRate: 0 | 6 | 12 | 25 | null; category: string; description: string; merchant: string }

/** Rensar Claudes avläsning av ett kvitto: giltigt datum, belopp i öre, känd momssats och kategori */
export function normalizeReceipt(r: { date: string | null; total_amount: number | null; vat_rate: number | null; category: string | null; description: string | null; merchant: string | null }): ReceiptGuess {
  const date = r.date && /^\d{4}-\d{2}-\d{2}$/.test(r.date) && !Number.isNaN(Date.parse(r.date)) ? r.date : '';
  const total = r.total_amount != null && Number.isFinite(r.total_amount) && r.total_amount > 0 && r.total_amount < 10_000_000 ? Math.round(r.total_amount * 100) : null;
  const vatRate = ([0, 6, 12, 25] as const).find((v) => v === r.vat_rate) ?? null;
  const category = RECEIPT_CATEGORIES.some((c) => c.key === r.category) ? r.category! : '';
  const clean = (s: string | null, n: number) => (s ?? '').replace(/[\u0000-\u001f]/g, ' ').trim().slice(0, n);
  return { date, total, vatRate, category, description: clean(r.description, 80), merchant: clean(r.merchant, 80) };
}
