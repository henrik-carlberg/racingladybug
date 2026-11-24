// Aktiva åtgärder (diskrimineringslagen 3 kap. 4–13 §§)
export const AREAS = {
  conditions: 'Arbetsförhållanden',
  pay: 'Bestämmelser och praxis om löner och andra anställningsvillkor',
  recruitment: 'Rekrytering och befordran',
  training: 'Utbildning och övrig kompetensutveckling',
  parenthood: 'Möjligheter att förena förvärvsarbete och föräldraskap',
} as const;
export type Area = keyof typeof AREAS;
export const GROUNDS = ['kön', 'könsöverskridande identitet eller uttryck', 'etnisk tillhörighet', 'religion eller annan trosuppfattning', 'funktionsnedsättning', 'sexuell läggning', 'ålder'];
/** Skriftlig dokumentation krävs från 25 arbetstagare (3 kap. 13 §); lönekartläggningen från 10 */
export const DOC_THRESHOLD = 25;

/** Årets arbete: varje område ska vara undersökt; åtgärder ska ha tidplan och följas upp */
export function progress(rows: { area: Area; measure: string; due_date: string | null; done_on: string | null; follow_up: string }[], hasPolicy: boolean, today: string) {
  const covered = (Object.keys(AREAS) as Area[]).filter((a) => rows.some((r) => r.area === a));
  const missingPlan = rows.filter((r) => r.measure && !r.due_date).length;
  const overdue = rows.filter((r) => r.measure && !r.done_on && r.due_date && r.due_date < today).length;
  const notFollowed = rows.filter((r) => r.done_on && !r.follow_up.trim()).length;
  const missing = (Object.keys(AREAS) as Area[]).filter((a) => !covered.includes(a));
  return { covered: covered.length, total: Object.keys(AREAS).length, missing, missingPlan, overdue, notFollowed, policy: hasPolicy,
    complete: !missing.length && !missingPlan && !overdue && !notFollowed && hasPolicy };
}
