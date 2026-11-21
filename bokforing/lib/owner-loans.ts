// Låneförbudet (aktiebolagslagen 21 kap.) och skattekonsekvensen för fåmansföretag (inkomstskattelagen 11 kap. 45 §). Belopp i öre.
export type Relation = 'owner' | 'board' | 'ceo' | 'related' | 'related_company' | 'group_company' | 'employee' | 'other';
export const RELATION_LABEL: Record<Relation, string> = {
  owner: 'Aktieägare', board: 'Styrelseledamot', ceo: 'Verkställande direktör', related: 'Närstående (make, barn, föräldrar, syskon m.fl.)',
  related_company: 'Företag som ägare/närstående bestämmer över', group_company: 'Koncernföretag', employee: 'Anställd (inte ägare eller närstående)', other: 'Annan',
};
export const OWNER_LOAN_ACCOUNT = 1685;

export interface Loan { relation: Relation; purpose: 'private' | 'business'; amount: number; repaid: number }
/** Är lånet förbjudet? Undantag: koncernlån och lån till en juridisk person för dess näringsverksamhet på affärsmässiga grunder */
export function assess(l: Loan, closelyHeld: boolean) {
  const outstanding = Math.max(0, l.amount - l.repaid);
  let prohibited = false, reason = '';
  if (l.relation === 'group_company') reason = 'Koncernlån är tillåtna';
  else if (l.relation === 'employee' || l.relation === 'other') reason = 'Låntagaren omfattas inte av låneförbudet';
  else if (l.relation === 'related_company' && l.purpose === 'business') reason = 'Näringslån till juridisk person på affärsmässiga grunder är tillåtet';
  else { prohibited = outstanding > 0; reason = prohibited ? 'Omfattas av låneförbudet' : 'Återbetalt'; }
  const taxedAsSalary = prohibited && closelyHeld && l.relation !== 'related_company';
  return { outstanding, prohibited, reason, taxedAsSalary,
    consequence: prohibited ? `Lånet ska återbetalas; styrelsen ansvarar för att det återkrävs.${taxedAsSalary ? ' I ett fåmansföretag beskattas lånet som inkomst av tjänst hos låntagaren.' : ''}` : '' };
}

/** Återbetalning (bank mot fordran) eller kvittning mot beslutad utdelning (2898 mot fordran) */
export function settleLines(kind: 'repay' | 'dividend', amount: number, account = OWNER_LOAN_ACCOUNT, bank = 1930) {
  return [{ account: kind === 'repay' ? bank : 2898, amount }, { account, amount: -amount }];
}

/** Saldot på fordringskontot som inte täcks av registrerade lån */
export const unregistered = (balance: number, registered: number) => Math.max(0, balance - registered);
