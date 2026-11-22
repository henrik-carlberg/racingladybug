// Pensionssparande för enskild näringsidkare utan tjänstepension (ren logik). Belopp i öre.
import { priceBase } from './small-assets';
export const SHARE = 35, MAX_PBB = 10, SLP = 24.26;
export const PRIVATE_WITHDRAWAL = 2013;

/** Avdragsutrymme: 35 % av inkomsten av aktiv näringsverksamhet, högst tio prisbasbelopp */
export function room(o: { income: number; year: number; paid: number }) {
  const max = Math.min(Math.max(0, Math.floor((o.income * SHARE) / 100)), MAX_PBB * priceBase(o.year));
  return { max, left: Math.max(0, max - o.paid), slp: Math.round((Math.min(o.paid, max) * SLP) / 100), excess: Math.max(0, o.paid - max) };
}
export const paymentLines = (amount: number) => [{ account: PRIVATE_WITHDRAWAL, amount }, { account: 1930, amount: -amount }];
