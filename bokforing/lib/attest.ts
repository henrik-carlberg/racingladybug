// Attest av leverantörsfakturor – ren logik (testbar)
export interface AttestRules { threshold: number | null; notRegistrant: boolean }

/** Antal attester som krävs för en faktura */
export const requiredApprovals = (total: number, r: AttestRules) => (r.threshold != null && total >= r.threshold ? 2 : 1);

/** Kan användaren attestera? Returnerar ett felmeddelande eller null */
export function attestError(o: { userId: number | null; registeredBy: number | null; approvedBy: number[]; rules: AttestRules }): string | null {
  if (o.userId == null) return 'Attest kräver en inloggad användare';
  if (o.approvedBy.includes(o.userId)) return 'Du har redan attesterat fakturan – en annan person måste göra nästa attest';
  if (o.rules.notRegistrant && o.registeredBy === o.userId) return 'Den som registrerat fakturan får inte attestera den';
  return null;
}
