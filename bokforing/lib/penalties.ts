// Sanktionsavgifter och böter. Belopp i öre. Sanktionsavgifter, böter och viten får inte dras av (IL 9 kap. 10 §), inte heller kostnadsränta på skattekontot.
export const NON_DEDUCTIBLE = 6992, TAX_INTEREST = 8423;
export const KINDS = {
  late_fee: { label: 'Förseningsavgift (Skatteverket, Bolagsverket)', account: NON_DEDUCTIBLE },
  tax_surcharge: { label: 'Skattetillägg', account: NON_DEDUCTIBLE },
  tax_interest: { label: 'Kostnadsränta på skattekontot', account: TAX_INTEREST },
  fine: { label: 'Böter och viten', account: NON_DEDUCTIBLE },
  parking: { label: 'Felparkeringsavgift och parkeringsbot', account: NON_DEDUCTIBLE },
  sanction: { label: 'Sanktionsavgift (t.ex. Arbetsmiljöverket, Transportstyrelsen)', account: NON_DEDUCTIBLE },
} as const;
export type Kind = keyof typeof KINDS;
export const PAY_FROM = { 1930: 'Företagskontot', 1630: 'Skattekontot', 2890: 'Obetald (övrig kortfristig skuld)' } as const;

export const penaltyLines = (amount: number, account: number, credit: number) => [{ account, amount }, { account: credit, amount: -amount }];
export const reclassLines = (amount: number, from: number, to = NON_DEDUCTIBLE) => [{ account: to, amount }, { account: from, amount: -amount }];

/** Ord som tyder på en sanktionsavgift (vanlig parkeringsavgift är avdragsgill och räknas inte) */
export const PATTERN = '(förseningsavgift|skattetillägg|böter|parkeringsbot|felparkering|sanktionsavgift|kontrollavgift|överlastavgift|\\mvite[ns]?\\M|\\mbot\\M)';
const RE = /(förseningsavgift|skattetillägg|böter|parkeringsbot|felparkering|sanktionsavgift|kontrollavgift|överlastavgift|(?<![a-zåäö])vite[ns]?(?![a-zåäö])|(?<![a-zåäö])bot(?![a-zåäö]))/i;
export const looksLikePenalty = (text: string) => RE.test(text);
/** Avdragsgilla kostnadskonton där en sanktionsavgift inte hör hemma */
export const deductibleCost = (account: number, nonDeductible: number[]) => account >= 4000 && account < 8900 && !nonDeductible.includes(account);
