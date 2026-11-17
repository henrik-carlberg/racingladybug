import 'server-only';
import { sql } from '@/lib/db';
import { ConflictError, ValidationError } from '@/lib/errors';
import { createVoucher } from '@/lib/server/ledger';
import { auditBy } from '@/lib/server/audit';
import { fromSigned } from '@/lib/ledger-lines';
import { formatAmount } from '@/lib/money';
import type { Actor } from './actor';
import { arr, int } from './input';

export interface SetupStep {
  key: string;
  title: string;
  description: string;
  done: boolean;
  skipped: boolean;
  optional: boolean;
  href: string;
  action: string;
}

type Flags = Record<string, unknown>;

export async function getSetup(companyId: number, userId: number): Promise<{ steps: SetupStep[]; flags: Flags; done: number; total: number; complete: boolean }> {
  const [c] = await sql<{ company_type: 'AB' | 'EF'; address: string; city: string; phone: string; email: string; bankgiro: string; plusgiro: string; iban: string; setup: Flags }[]>`
    SELECT company_type, address, city, phone, email, bankgiro, plusgiro, iban, setup FROM companies WHERE id = ${companyId}`;
  const [s] = await sql<{ ib: boolean; prior: boolean; bank: boolean; members: number; passkey: boolean; employees: number; tables: boolean; customers: number }[]>`
    SELECT
      EXISTS (SELECT 1 FROM vouchers WHERE company_id = ${companyId} AND source_type = 'opening_balance'
              AND NOT EXISTS (SELECT 1 FROM vouchers r WHERE r.corrects_id = vouchers.id)) AS ib,
      EXISTS (SELECT 1 FROM vouchers v JOIN fiscal_years f ON f.id = v.fiscal_year_id
              WHERE v.company_id = ${companyId} AND f.start_date < (SELECT max(start_date) FROM fiscal_years WHERE company_id = ${companyId})) AS prior,
      EXISTS (SELECT 1 FROM bank_accounts WHERE company_id = ${companyId} AND active) AS bank,
      (SELECT count(*) FROM memberships WHERE company_id = ${companyId})::int AS members,
      EXISTS (SELECT 1 FROM passkeys WHERE user_id = ${userId}) AS passkey,
      (SELECT count(*) FROM employees WHERE company_id = ${companyId} AND active)::int AS employees,
      EXISTS (SELECT 1 FROM tax_table_rows WHERE year = extract(year FROM now())::int) AS tables,
      (SELECT count(*) FROM customers WHERE company_id = ${companyId})::int AS customers`;
  const f = c.setup ?? {};
  const skip = (k: string) => f[`skip_${k}`] === true;
  const b = `/c/${companyId}`;
  const hasEmployees = f.has_employees === true || s.employees > 0;
  const steps: SetupStep[] = [
    {
      key: 'company', title: 'Företagsuppgifter', optional: false, href: `${b}/installningar`, action: 'Fyll i',
      description: 'Adress, telefon, e-post och bankgiro/plusgiro. Uppgifterna visas på fakturor och används i deklarationer.',
      done: !!(c.address && c.city && c.phone && c.email && (c.bankgiro || c.plusgiro || c.iban)), skipped: false,
    },
    {
      key: 'opening_balances', title: 'Ingående balanser', optional: false, href: `${b}/kom-igang/ingaende-balanser`, action: 'Registrera',
      description: 'Har bolaget bokförts tidigare? För över saldona (bank, kundfordringar, skulder, eget kapital) från förra årets bokslut. Nystartat bolag? Registrera bara insatt aktiekapital eller hoppa över.',
      done: s.ib || s.prior, skipped: skip('opening_balances'),
    },
    {
      key: 'bank', title: 'Bankkonto', optional: true, href: `${b}/bank`, action: 'Koppla',
      description: 'Koppla banken med BankID eller importera kontoutdrag, så kan transaktioner stämmas av automatiskt mot fakturor.',
      done: s.bank, skipped: skip('bank'),
    },
    {
      key: 'accountant', title: 'Bjud in din redovisningskonsult', optional: true, href: `${b}/installningar`, action: 'Bjud in',
      description: 'Ge din bokförare eller redovisningskonsult egen inloggning. Hen kan sköta allt utom användarhantering.',
      done: s.members > 1, skipped: skip('accountant'),
    },
    {
      key: 'passkey', title: 'Logga in med passkey', optional: true, href: '/konto', action: 'Lägg till',
      description: 'Snabbare och säkrare inloggning med Face ID, Touch ID eller Windows Hello. Används också för att signera avtal.',
      done: s.passkey, skipped: skip('passkey'),
    },
    {
      key: 'payroll', title: 'Lön', optional: true, href: `${b}/lon/anstallda`, action: 'Lägg upp',
      description: c.company_type === 'AB'
        ? 'Tar du eller någon annan ut lön från bolaget? Lägg upp de anställda och hämta årets skattetabeller.'
        : 'Har du anställda? (Som enskild näringsidkare tar du inte ut lön – du gör egna uttag.)',
      done: hasEmployees ? s.employees > 0 && s.tables : f.has_employees === false, skipped: skip('payroll'),
    },
    {
      key: 'customer', title: 'Första kunden', optional: true, href: `${b}/kunder`, action: 'Lägg upp',
      description: 'Lägg upp en kund så kan du skicka din första faktura.',
      done: s.customers > 0, skipped: skip('customer'),
    },
  ];
  const finished = steps.filter((x) => x.done || x.skipped).length;
  return { steps, flags: f, done: finished, total: steps.length, complete: finished === steps.length };
}

export async function setSetupFlag(actor: Actor, key: string, value: unknown) {
  if (!/^[a-z_]{1,40}$/.test(key)) throw new ValidationError('Ogiltig inställning');
  await sql`UPDATE companies SET setup = setup || ${sql.json({ [key]: value } as never)} WHERE id = ${actor.companyId}`;
  await auditBy(sql, actor, 'setup', 'company', actor.companyId, { [key]: value });
}

// ---------- Ingående balanser ----------

export interface IbAccount { number: number; name: string; side: 'debit' | 'credit'; hint?: string }

/** Vanliga balanskonton att föra över, anpassat efter bolagsform */
export function openingBalanceTemplate(type: 'AB' | 'EF'): IbAccount[] {
  const assets: IbAccount[] = [
    { number: 1930, name: 'Företagskonto (bank)', side: 'debit' },
    { number: 1510, name: 'Kundfordringar (obetalda kundfakturor)', side: 'debit' },
    { number: 1630, name: 'Skattekontot', side: 'debit', hint: 'Saldo på skattekontot; skuld anges med minus' },
    { number: 1220, name: 'Inventarier', side: 'debit' },
    { number: 1229, name: 'Ackumulerade avskrivningar på inventarier', side: 'debit', hint: 'Anges som negativt belopp' },
    { number: 1460, name: 'Lager', side: 'debit' },
  ];
  const ab: IbAccount[] = [
    { number: 2081, name: 'Aktiekapital', side: 'credit' },
    { number: 2091, name: 'Balanserad vinst eller förlust', side: 'credit', hint: 'Förlust anges med minus' },
    { number: 2098, name: 'Vinst eller förlust från föregående år', side: 'credit', hint: 'Förra årets resultat om det inte disponerats ännu' },
    { number: 2110, name: 'Periodiseringsfonder', side: 'credit' },
    { number: 2440, name: 'Leverantörsskulder', side: 'credit' },
    { number: 2510, name: 'Skatteskulder', side: 'credit' },
    { number: 2650, name: 'Momsskuld (moms att betala)', side: 'credit', hint: 'Moms att få tillbaka anges med minus' },
    { number: 2710, name: 'Personalskatt', side: 'credit' },
    { number: 2731, name: 'Arbetsgivaravgifter', side: 'credit' },
    { number: 2893, name: 'Skuld till ägare/närstående', side: 'credit' },
    { number: 2920, name: 'Semesterlöneskuld', side: 'credit' },
  ];
  const ef: IbAccount[] = [
    { number: 2010, name: 'Eget kapital', side: 'credit', hint: 'Tillgångar minus skulder' },
    { number: 2440, name: 'Leverantörsskulder', side: 'credit' },
    { number: 2650, name: 'Momsskuld (moms att betala)', side: 'credit', hint: 'Moms att få tillbaka anges med minus' },
    { number: 2710, name: 'Personalskatt', side: 'credit' },
    { number: 2731, name: 'Arbetsgivaravgifter', side: 'credit' },
  ];
  return [...assets, ...(type === 'AB' ? ab : ef)];
}

/**
 * Bokför ingående balanser som en verifikation på räkenskapsårets första dag.
 * Belopp anges i öre på kontots "normala" sida: tillgångar som debet, skulder och eget kapital som kredit.
 */
export async function saveOpeningBalances(actor: Actor, input: Record<string, unknown>) {
  const fyId = int(input, 'fiscal_year_id', 'Räkenskapsår');
  const [fy] = await sql<{ start_date: string }[]>`SELECT to_char(start_date,'YYYY-MM-DD') AS start_date FROM fiscal_years WHERE id = ${fyId} AND company_id = ${actor.companyId}`;
  if (!fy) throw new ValidationError('Räkenskapsåret finns inte');
  const existing = await sql`SELECT 1 FROM vouchers v WHERE v.company_id = ${actor.companyId} AND v.fiscal_year_id = ${fyId} AND v.source_type = 'opening_balance'
    AND NOT EXISTS (SELECT 1 FROM vouchers r WHERE r.corrects_id = v.id)`;
  if (existing.length) throw new ConflictError('Ingående balanser är redan registrerade för räkenskapsåret. Rätta dem med en rättelseverifikation och registrera på nytt.');
  const entries = arr(input, 'lines', 'Saldon').map((r, i) => {
    const account = int(r, 'account', `Rad ${i + 1}: konto`);
    if (account >= 3000) throw new ValidationError(`Konto ${account} är ett resultatkonto – ingående balanser gäller bara balanskonton (1000–2999)`);
    const amount = int(r, 'amount', `Rad ${i + 1}: belopp`);
    // Tillgångar (1xxx) ökar i debet, skulder och eget kapital (2xxx) i kredit
    return { account, amount: account < 2000 ? amount : -amount };
  }).filter((e) => e.amount !== 0);
  if (entries.length === 0) throw new ValidationError('Ange minst ett saldo');
  const diff = entries.reduce((s, e) => s + e.amount, 0);
  if (diff !== 0) {
    throw new ValidationError(`Balanserna går inte jämnt ut: tillgångarna är ${formatAmount(Math.abs(diff))} kr ${diff > 0 ? 'större' : 'mindre'} än skulder och eget kapital. ` +
      'Kontrollera beloppen mot förra årets balansräkning (summa tillgångar = summa eget kapital och skulder).');
  }
  const v = await sql.begin((tx) => createVoucher(tx, {
    actor, date: fy.start_date, description: 'Ingående balanser', lines: fromSigned(entries), series: 'I', sourceType: 'opening_balance',
  }));
  return v;
}
