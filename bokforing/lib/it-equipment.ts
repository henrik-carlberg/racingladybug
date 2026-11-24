// IT-utrustning och inventarielista. Belopp i öre.
export const KINDS = { laptop: 'Dator', phone: 'Mobiltelefon', tablet: 'Surfplatta', screen: 'Skärm', accessory: 'Tillbehör', other: 'Övrigt' } as const;
export type Kind = keyof typeof KINDS;
const monthIndex = (d: string) => Number(d.slice(0, 4)) * 12 + Number(d.slice(5, 7)) - 1;

/** Hela månader sedan inköpet */
export const ageMonths = (purchased: string, today: string) => monthIndex(today) - monthIndex(purchased) - (today.slice(8) < purchased.slice(8) ? 1 : 0);
/** Dags att byta enligt utbytesplanen (datorer och telefoner tre år som standard) */
export const replaceDue = (purchased: string | null, today: string, lifeMonths = 36) => (purchased ? ageMonths(purchased, today) >= lifeMonths : false);
/** Dagar kvar på garantin om den går ut inom perioden */
export const warrantyEnding = (until: string | null, today: string, days = 60) => {
  if (!until) return null;
  const d = Math.round((Date.parse(until) - Date.parse(today)) / 864e5);
  return d >= 0 && d <= days ? d : null;
};
/** Återlämning vid uppsägning: allt som är utlämnat ska vara tillbaka senast sista anställningsdagen */
export function returnStatus(items: { status: string }[], lastDay: string, today: string) {
  const out = items.filter((i) => i.status === 'in_use').length;
  return { out, overdue: out > 0 && today > lastDay, done: out === 0 };
}
