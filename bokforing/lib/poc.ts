// Successiv vinstavräkning för uppdrag till fast pris (K3 kap. 23, ren logik). Belopp i öre.
export const WIP_ASSET = 1620;      // Upparbetad men ej fakturerad intäkt
export const WIP_LIABILITY = 2450;  // Fakturerad men ej upparbetad intäkt
export const WIP_REVENUE = 3795;    // Förändring av upparbetade intäkter (räknas till nettoomsättningen, utanför momsrutorna)
export const LOSS_COST = 4995;      // Befarad förlust på pågående uppdrag
export const LOSS_PROVISION = 2290; // Avsättning för befarad förlust

export interface Contract { value: number; estimatedCost: number }
export interface Actuals { cost: number; invoiced: number }

/** Färdigställandegrad = nedlagda kostnader / beräknade totala kostnader (högst 100 %) */
export const completion = (c: Contract, a: Actuals) => (c.estimatedCost > 0 ? Math.min(1, Math.max(0, a.cost / c.estimatedCost)) : 0);

/**
 * Per bokslutsdagen: upparbetad intäkt (färdigställandegrad × kontraktsvärde) mot fakturerat.
 * Mellanskillnaden redovisas som upparbetad men ej fakturerad intäkt (tillgång) eller fakturerad men ej upparbetad (skuld).
 * En befarad förlust redovisas direkt i sin helhet (K3 23.29).
 */
export function position(c: Contract, a: Actuals) {
  const grade = completion(c, a);
  const earned = Math.round(c.value * grade);
  const wip = earned - a.invoiced;                     // positivt = tillgång, negativt = skuld
  const expectedLoss = Math.max(0, c.estimatedCost - c.value);
  const recognizedLoss = Math.round(expectedLoss * grade);
  const lossProvision = expectedLoss - recognizedLoss;  // resten av förlusten reserveras nu
  const margin = earned - a.cost;
  return { grade, earned, wip, expectedLoss, lossProvision, margin };
}

/** Bokning: skillnaden mot det som redan är bokfört (så att varje bokslut bara ändrar mellanskillnaden) */
export function adjustmentLines(target: { wip: number; lossProvision: number }, booked: { wip: number; lossProvision: number }) {
  const l: { account: number; amount: number }[] = [];
  const dWip = target.wip - booked.wip;
  if (dWip) {
    // Byte av sida: hela tidigare saldo bokas om
    const prevAsset = Math.max(0, booked.wip), prevLiab = Math.max(0, -booked.wip);
    const newAsset = Math.max(0, target.wip), newLiab = Math.max(0, -target.wip);
    if (newAsset - prevAsset) l.push({ account: WIP_ASSET, amount: newAsset - prevAsset });
    if (newLiab - prevLiab) l.push({ account: WIP_LIABILITY, amount: -(newLiab - prevLiab) });
    l.push({ account: WIP_REVENUE, amount: -dWip });
  }
  const dLoss = target.lossProvision - booked.lossProvision;
  if (dLoss) l.push({ account: LOSS_COST, amount: dLoss }, { account: LOSS_PROVISION, amount: -dLoss });
  return l;
}
