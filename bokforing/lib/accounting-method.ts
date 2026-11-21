// Kontantmetoden och byte av redovisningsmetod (ren logik). Belopp i öre.
/** Kontantmetoden får användas om nettoomsättningen normalt är högst tre miljoner kronor per år (BFNAR 2006:1) */
export const CASH_LIMIT = 300000000;

export function methodChangeError(o: { from: 'invoice' | 'cash'; to: 'invoice' | 'cash'; turnover: number | null; bookedThisYear: number; unbookedOpen: number }): string | null {
  if (o.from === o.to) return null;
  if (o.bookedThisYear) return `Redovisningsmetoden byts vid ett nytt räkenskapsår. I år finns redan ${o.bookedThisYear} bokförda fakturor – byt när nästa räkenskapsår börjar.`;
  if (o.to === 'cash' && o.turnover != null && o.turnover > CASH_LIMIT)
    return `Kontantmetoden får bara användas om nettoomsättningen normalt är högst 3 miljoner kronor. Förra räkenskapsåret var den ${Math.round(o.turnover / 100).toLocaleString('sv-SE')} kr.`;
  if (o.to === 'invoice' && o.unbookedOpen) return `Bokför först de ${o.unbookedOpen} obetalda fakturorna (som vid bokslutet) innan du byter till faktureringsmetoden`;
  return null;
}

/** Varning i bokslutet när ett bolag med kontantmetoden har vuxit förbi gränsen */
export const turnoverWarning = (turnover: number) => turnover > CASH_LIMIT
  ? `Nettoomsättningen är ${Math.round(turnover / 100).toLocaleString('sv-SE')} kr – över gränsen på 3 miljoner kronor för kontantmetoden. Byt till faktureringsmetoden från nästa räkenskapsår om omsättningen normalt ligger över gränsen.`
  : null;
