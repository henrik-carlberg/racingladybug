import 'server-only';
import { sql, type Tx } from '@/lib/db';
import { ConflictError, NotFoundError, ValidationError } from '@/lib/errors';
import { auditBy } from '@/lib/server/audit';
import { createVoucher } from '@/lib/server/ledger';
import { fromSigned } from '@/lib/ledger-lines';
import { parseAmount } from '@/lib/money';
import { DEFAULTS, entryLines, nextBalance, reconcile, type Kind } from '@/lib/client-funds';
import type { Actor } from './actor';
import { date, int, optInt, str } from './input';
import { registerPaymentTx } from './invoices';

type Db = Tx | typeof sql;
async function settings(db: Db, companyId: number) {
  const [s] = await db<{ bank: number; liability: number }[]>`SELECT bank_account AS bank, liability_account AS liability FROM client_fund_settings WHERE company_id = ${companyId}`;
  return s ?? DEFAULTS;
}
const ledger = async (db: Db, companyId: number, account: number, sign: 1 | -1) => {
  const [{ s }] = await db<{ s: number }[]>`SELECT COALESCE(SUM(l.debit - l.credit), 0)::float8 AS s FROM voucher_lines l JOIN vouchers v ON v.id = l.voucher_id WHERE v.company_id = ${companyId} AND l.account_number = ${account}`;
  return s * sign;
};

export async function overview(companyId: number, clientId?: number) {
  const s = await settings(sql, companyId);
  const clients = await sql<{ id: number; name: string; reference: string; customer_id: number | null; customer: string | null; closed: boolean; balance: number; last: string | null }[]>`
    SELECT f.id, f.name, f.reference, f.customer_id, c.name AS customer, f.closed,
      COALESCE((SELECT SUM(CASE WHEN e.kind = 'deposit' THEN e.amount ELSE -e.amount END) FROM client_fund_entries e WHERE e.client_id = f.id), 0)::float8 AS balance,
      (SELECT to_char(max(e.date),'YYYY-MM-DD') FROM client_fund_entries e WHERE e.client_id = f.id) AS last
    FROM fund_clients f LEFT JOIN customers c ON c.id = f.customer_id WHERE f.company_id = ${companyId} ORDER BY f.closed, f.name`;
  const total = clients.reduce((x, c) => x + c.balance, 0);
  const bank = await ledger(sql, companyId, s.bank, 1), liability = await ledger(sql, companyId, s.liability, -1);
  const entries = clientId ? await sql<{ id: number; date: string; kind: Kind; amount: number; note: string; invoice_number: number | null }[]>`
    SELECT e.id, to_char(e.date,'YYYY-MM-DD') AS date, e.kind, e.amount::float8 AS amount, e.note, i.invoice_number FROM client_fund_entries e LEFT JOIN invoices i ON i.id = e.invoice_id
    WHERE e.client_id = ${clientId} AND e.company_id = ${companyId} ORDER BY e.date, e.id` : [];
  const invoices = clientId ? await sql<{ id: number; number: number; remaining: number }[]>`SELECT i.id, i.invoice_number AS number, (i.total - i.paid_amount)::float8 AS remaining FROM invoices i
    JOIN fund_clients f ON f.customer_id = i.customer_id WHERE f.id = ${clientId} AND i.company_id = ${companyId} AND i.status = 'booked' AND i.currency = 'SEK' AND i.total > i.paid_amount ORDER BY i.due_date` : [];
  const customers = await sql<{ id: number; name: string }[]>`SELECT id, name FROM customers WHERE company_id = ${companyId} ORDER BY name LIMIT 500`;
  return { settings: s, clients, total, bank, liability, check: reconcile({ clients: total, bank, liability }), entries, invoices, customers };
}

export async function saveSettings(actor: Actor, input: Record<string, unknown>) {
  const bank = optInt(input, 'bank_account', 'Bankkonto') ?? DEFAULTS.bank, liability = optInt(input, 'liability_account', 'Skuldkonto') ?? DEFAULTS.liability;
  if (bank < 1900 || bank > 1999) throw new ValidationError('Klientmedelskontot ska vara ett bankkonto (19xx)');
  if (bank === 1930) throw new ValidationError('Klientmedel ska hållas avskilda från bolagets egna medel – välj ett eget bankkonto, t.ex. 1940');
  if (liability < 2000 || liability > 2999) throw new ValidationError('Skuldkontot ska vara ett konto i klass 2');
  const [used] = await sql`SELECT 1 FROM client_fund_entries WHERE company_id = ${actor.companyId} LIMIT 1`;
  if (used) throw new ConflictError('Kontona kan inte ändras när det finns klientmedel bokförda');
  await sql`INSERT INTO client_fund_settings (company_id, bank_account, liability_account) VALUES (${actor.companyId}, ${bank}, ${liability})
    ON CONFLICT (company_id) DO UPDATE SET bank_account = EXCLUDED.bank_account, liability_account = EXCLUDED.liability_account`;
}

export async function addClient(actor: Actor, input: Record<string, unknown>) {
  const customerId = optInt(input, 'customer_id', 'Kund');
  if (customerId) { const [c] = await sql`SELECT 1 FROM customers WHERE id = ${customerId} AND company_id = ${actor.companyId}`; if (!c) throw new NotFoundError('Kunden'); }
  try {
    const [c] = await sql<{ id: number }[]>`INSERT INTO fund_clients ${sql({ company_id: actor.companyId, name: str(input, 'name', { required: true, label: 'Klient', max: 200 }), reference: str(input, 'reference', { max: 100 }), customer_id: customerId })} RETURNING id`;
    return c.id;
  } catch (e) { if (String((e as Error).message).includes('fund_clients_company_id_name_reference_key')) throw new ConflictError('Klienten finns redan med samma ärende'); throw e; }
}

/** Insättning, utbetalning till klienten eller arvode (betalning av en av bolagets fakturor till klienten med klientens medel) */
export async function addEntry(actor: Actor, clientId: number, input: Record<string, unknown>) {
  const kind = (['deposit', 'payout', 'fee'].includes(String(input.kind)) ? input.kind : '') as Kind;
  if (!kind) throw new ValidationError('Välj insättning, utbetalning eller arvode');
  const d = date(input, 'date', 'Datum');
  return sql.begin(async (tx) => {
    const [c] = await tx<{ name: string; reference: string; customer_id: number | null; closed: boolean }[]>`SELECT name, reference, customer_id, closed FROM fund_clients WHERE id = ${clientId} AND company_id = ${actor.companyId} FOR UPDATE`;
    if (!c) throw new NotFoundError('Klienten');
    if (c.closed) throw new ConflictError('Klienten är avslutad');
    const s = await settings(tx, actor.companyId);
    const [{ balance }] = await tx<{ balance: number }[]>`SELECT COALESCE(SUM(CASE WHEN kind = 'deposit' THEN amount ELSE -amount END), 0)::float8 AS balance FROM client_fund_entries WHERE client_id = ${clientId}`;
    let amount: number, invoiceId: number | null = null, invoiceNo: number | null = null;
    if (kind === 'fee') {
      invoiceId = int(input, 'invoice_id', 'Faktura');
      const [i] = await tx<{ customer_id: number; remaining: number; number: number; status: string }[]>`SELECT customer_id, (total - paid_amount)::float8 AS remaining, invoice_number AS number, status FROM invoices WHERE id = ${invoiceId} AND company_id = ${actor.companyId}`;
      if (!i || i.customer_id !== c.customer_id) throw new ValidationError('Fakturan ska vara ställd till klienten');
      if (i.status !== 'booked' || i.remaining <= 0) throw new ConflictError('Fakturan är inte obetald');
      const req = String(input.amount ?? '').trim() ? parseAmount(String(input.amount)) : i.remaining;
      if (req == null || req <= 0 || req > i.remaining) throw new ValidationError('Arvodet kan inte vara större än det som återstår på fakturan');
      amount = req; invoiceNo = i.number;
    } else {
      const a = parseAmount(String(input.amount ?? '').trim());
      if (a == null || a <= 0) throw new ValidationError('Ange beloppet i kronor');
      amount = a;
    }
    try { nextBalance(balance, kind, amount); } catch (e) { throw new ValidationError((e as Error).message); }
    for (const [n, name] of [[s.bank, 'Klientmedelskonto'], [s.liability, 'Klientmedel']] as const) await tx`INSERT INTO accounts (company_id, number, name) VALUES (${actor.companyId}, ${n}, ${name}) ON CONFLICT DO NOTHING`;
    const label = { deposit: 'Insättning', payout: 'Utbetalning', fee: `Arvode faktura ${invoiceNo}` }[kind];
    const v = await createVoucher(tx, { actor, date: d, description: `Klientmedel ${c.name}${c.reference ? ` (${c.reference})` : ''}: ${label}`, lines: fromSigned(entryLines(kind, amount, s)), sourceType: 'client_funds', sourceId: clientId });
    // Arvodet förs över till bolagets eget konto och betalar fakturan
    if (kind === 'fee') await registerPaymentTx(tx, actor, invoiceId!, { amount, date: d, bank_account: 1930 });
    await tx`INSERT INTO client_fund_entries ${tx({ company_id: actor.companyId, client_id: clientId, date: d, kind, amount, note: str(input, 'note', { max: 300 }), invoice_id: invoiceId, voucher_id: v.id, created_by: actor.userId })}`;
    await auditBy(tx, actor, `client_funds_${kind}`, 'fund_client', clientId, { amount });
    return { kind, amount };
  });
}

/** Klienten avslutas när saldot är noll */
export async function closeClient(actor: Actor, clientId: number) {
  const [{ balance }] = await sql<{ balance: number }[]>`SELECT COALESCE(SUM(CASE WHEN e.kind = 'deposit' THEN e.amount ELSE -e.amount END), 0)::float8 AS balance
    FROM fund_clients f LEFT JOIN client_fund_entries e ON e.client_id = f.id WHERE f.id = ${clientId} AND f.company_id = ${actor.companyId}`;
  if (balance) throw new ConflictError('Klienten har fortfarande medel – betala ut saldot först');
  const r = await sql`UPDATE fund_clients SET closed = true WHERE id = ${clientId} AND company_id = ${actor.companyId}`;
  if (!r.count) throw new NotFoundError('Klienten');
}
