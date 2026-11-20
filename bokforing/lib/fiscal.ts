// Regler för räkenskapsår (BFL 3 kap.): normalt 12 månader. Första (och vid omläggning) får vara kortare
// eller längre, högst 18 månader. Räkenskapsåret ska sluta vid en månads utgång. Enskild näringsidkare
// ska ha kalenderår, så räkenskapsåret ska då sluta 31 december.

const lastOfMonth = (s: string) => {
  const d = new Date(s + 'T12:00:00Z');
  d.setUTCDate(d.getUTCDate() + 1);
  return d.getUTCDate() === 1;
};

/** Antal månader (påbörjade) mellan start och slut */
export function fiscalMonths(start: string, end: string): number {
  return (Number(end.slice(0, 4)) - Number(start.slice(0, 4))) * 12 + Number(end.slice(5, 7)) - Number(start.slice(5, 7)) + 1;
}

/** Returnerar ett felmeddelande, eller null om räkenskapsåret är giltigt */
export function fiscalYearError(start: string, end: string, type: 'AB' | 'EF' | 'HB' | 'KB'): string | null {
  const re = /^\d{4}-\d{2}-\d{2}$/;
  if (!re.test(start) || !re.test(end) || Number.isNaN(Date.parse(start)) || Number.isNaN(Date.parse(end))) return 'Ange giltigt start- och slutdatum';
  if (end <= start) return 'Slutdatum måste vara efter startdatum';
  if (!lastOfMonth(end)) return 'Räkenskapsåret måste sluta på sista dagen i en månad';
  if (type === 'EF' && end.slice(5) !== '12-31') return 'En enskild firma har kalenderår – räkenskapsåret ska sluta 31 december';
  if ((type === 'HB' || type === 'KB') && end.slice(5) !== '12-31') return 'Ett handels- eller kommanditbolag med fysiska personer som delägare har kalenderår – räkenskapsåret ska sluta 31 december';
  const months = fiscalMonths(start, end);
  if (months > 18) return 'Ett räkenskapsår får vara högst 18 månader';
  return null;
}

/** Förslag på slutdatum för ett nytt räkenskapsår som börjar på start */
export function defaultFiscalEnd(start: string, type: 'AB' | 'EF' | 'HB' | 'KB'): string {
  const y = Number(start.slice(0, 4)), m = Number(start.slice(5, 7));
  if (type === 'EF') return `${y}-12-31`;
  const em = m === 1 ? 12 : m - 1, ey = m === 1 ? y : y + 1;
  return `${ey}-${String(em).padStart(2, '0')}-${String(new Date(Date.UTC(ey, em, 0)).getUTCDate()).padStart(2, '0')}`;
}
