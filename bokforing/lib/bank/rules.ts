// Konteringsregler för banktransaktioner – ren logik (testbar)

export interface BankRule {
  id: number; name: string; pattern: string; direction: 'in' | 'out' | 'any';
  amountMin: number | null; amountMax: number | null; // öre, absolutbelopp
  account: number; vatRate: number; description: string; auto: boolean; priority: number;
}
export interface RuleTx { amount: number; description: string; reference: string; counterparty: string }

// Ord som inte säger något om motparten
const NOISE = new Set(['kortköp', 'kortkop', 'köp', 'kop', 'kort', 'betalning', 'bet', 'bg', 'pg', 'bankgiro', 'plusgiro', 'autogiro', 'ag', 'överföring', 'overforing',
  'insättning', 'insattning', 'uttag', 'e-faktura', 'efaktura', 'faktura', 'swish', 'från', 'fran', 'till', 'ref', 'ocr', 'sek', 'kr', 'ab', 'hb', 'kb', 'se', 'www', 'com']);

/** Gemener, utan siffror, datum och skiljetecken: "KORTKÖP 261103 TELIA SVERIGE AB" → "telia sverige" */
export function normalizeText(s: string): string {
  return s.toLowerCase().replace(/[0-9]+/g, ' ').split(/[^a-zåäöéü&]+/).filter((w) => w.length >= 2 && !NOISE.has(w)).join(' ');
}

/** Nyckel för att lära av tidigare konteringar: motparten om den finns, annars texten (högst tre ord) */
export function learnKey(tx: RuleTx): string {
  return normalizeText(tx.counterparty || tx.description).split(' ').filter(Boolean).slice(0, 3).join(' ');
}

/** Regelns sökord: alla ord måste finnas i transaktionens text (mönster med * matchar början av ord) */
export function ruleMatches(rule: Pick<BankRule, 'pattern' | 'direction' | 'amountMin' | 'amountMax'>, tx: RuleTx): boolean {
  if (rule.direction === 'in' && tx.amount <= 0) return false;
  if (rule.direction === 'out' && tx.amount >= 0) return false;
  const abs = Math.abs(tx.amount);
  if (rule.amountMin != null && abs < rule.amountMin) return false;
  if (rule.amountMax != null && abs > rule.amountMax) return false;
  const text = ` ${`${tx.counterparty} ${tx.description} ${tx.reference}`.toLowerCase().replace(/\s+/g, ' ')} `;
  const words = rule.pattern.toLowerCase().split(/\s+/).filter(Boolean);
  if (!words.length) return false;
  return words.every((w) => {
    if (w.endsWith('*')) return text.includes(w.slice(0, -1));
    const esc = w.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    return new RegExp(`(^|[^a-zåäö0-9])${esc}($|[^a-zåäö0-9])`).test(text);
  });
}

/** Bästa regeln: högst prioritet, därefter flest/längst sökord och smalast beloppsintervall */
export function pickRule<R extends BankRule>(rules: R[], tx: RuleTx): R | null {
  const hits = rules.filter((r) => ruleMatches(r, tx));
  if (!hits.length) return null;
  const spec = (r: R) => r.pattern.length + (r.direction !== 'any' ? 5 : 0) + (r.amountMin != null || r.amountMax != null ? 10 : 0);
  return hits.sort((a, b) => b.priority - a.priority || spec(b) - spec(a) || a.id - b.id)[0];
}

/** Vanliga regler att börja med (förslag, inte automatiska). Moms bara där svensk moms normalt finns på kvittot. */
export const STARTER_RULES: Omit<BankRule, 'id' | 'auto' | 'priority'>[] = [
  { name: 'Skattekontot', pattern: 'skatteverket', direction: 'any', amountMin: null, amountMax: null, account: 1630, vatRate: 0, description: 'Skattekontot' },
  { name: 'Bankavgifter', pattern: 'avgift', direction: 'out', amountMin: null, amountMax: 100000, account: 6570, vatRate: 0, description: 'Bankavgift' },
  { name: 'Ränta på bankkonto', pattern: 'ränta', direction: 'in', amountMin: null, amountMax: null, account: 8310, vatRate: 0, description: 'Ränteintäkt' },
  { name: 'Telia', pattern: 'telia', direction: 'out', amountMin: null, amountMax: null, account: 6212, vatRate: 25, description: 'Telefon och abonnemang' },
  { name: 'Tele2', pattern: 'tele2', direction: 'out', amountMin: null, amountMax: null, account: 6212, vatRate: 25, description: 'Telefon och abonnemang' },
  { name: 'Telenor', pattern: 'telenor', direction: 'out', amountMin: null, amountMax: null, account: 6212, vatRate: 25, description: 'Telefon och abonnemang' },
];
