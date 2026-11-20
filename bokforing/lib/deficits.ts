// Underskottsavdrag med belopps- och koncernbidragsspärr vid ägarförändring (inkomstskattelagen 40 kap.). Belopp i öre.
export const GROUP_CONTRIBUTION_YEARS = 5;

export interface YearIn { year: number; start: string; end: string; taxable: number; groupContribution: number }
export interface OwnershipChange { date: string; price: number; contributions: number }
export interface YearOut {
  incoming: number; cut: number; usedOld: number; usedNew: number; outgoing: number; locked: number; change: boolean; note: string;
}

/** Högsta underskott som får behållas: 200 % av utgiften för det bestämmande inflytandet minskat med kapitaltillskott före förvärvet */
export const amountLimit = (c: OwnershipChange) => Math.max(0, 2 * c.price - c.contributions);

/**
 * Rullar underskotten år för år. Underskott från tiden före ägarförändringen ("gamla") skärs ned med beloppsspärren och får
 * under ändringsåret och fem följande år inte användas mot mottagna koncernbidrag.
 */
export function rollForward<T extends YearIn>(years: T[], change?: OwnershipChange | null): (T & YearOut)[] {
  const out: (T & YearOut)[] = [];
  let oldD = 0, newD = 0, changeIdx = -1;
  const sorted = [...years].sort((a, b) => a.start.localeCompare(b.start));
  sorted.forEach((y, i) => {
    let cut = 0, note = '';
    const isChange = !!change && change.date >= y.start && change.date <= y.end;
    if (isChange) {
      // Allt som rullats in till ändringsåret räknas som gammalt underskott
      oldD += newD; newD = 0;
      const limit = amountLimit(change!);
      cut = Math.max(0, oldD - limit);
      oldD -= cut;
      changeIdx = i;
      note = cut ? `Beloppsspärr: underskott över ${(limit / 100).toLocaleString('sv-SE')} kr (200 % av köpeskillingen) faller bort` : 'Ägarförändring – inom beloppsspärren';
    }
    const locked = changeIdx >= 0 && i - changeIdx <= GROUP_CONTRIBUTION_YEARS;
    if (changeIdx >= 0 && !locked && oldD) { newD += oldD; oldD = 0; }
    const incoming = oldD + newD;
    const positive = Math.max(0, y.taxable);
    // Gamla underskott får inte kvittas mot koncernbidrag under spärrtiden
    const usedOld = Math.min(oldD, locked ? Math.max(0, positive - y.groupContribution) : positive);
    const usedNew = Math.min(newD, positive - usedOld);
    oldD -= usedOld; newD -= usedNew;
    if (y.taxable < 0) newD += -y.taxable;
    if (locked && y.groupContribution && !note) note = 'Koncernbidragsspärr: gamla underskott får inte kvittas mot mottagna koncernbidrag';
    out.push({ ...y, incoming, cut, usedOld, usedNew, outgoing: oldD + newD, locked: locked ? oldD : 0, change: isChange, note });
  });
  return out;
}
