import 'server-only';
import { sql } from '@/lib/db';
import { NotFoundError, ValidationError } from '@/lib/errors';
import { auditBy } from '@/lib/server/audit';
import { decrypt, encrypt } from '@/lib/server/crypto';
import { createVoucher } from '@/lib/server/ledger';
import { fetchPayouts, fetchSales, SHOP_DOMAIN, type Credentials } from '@/lib/server/payproviders';
import { HAS_SALES, payoutLines, PROVIDER_LABEL, salesLines, type Payout, type Provider } from '@/lib/payproviders';
import type { Rate } from '@/lib/shop';
import type { Actor } from './actor';
import { optInt, str } from './input';
import { reconcile } from './bank';

const PROVIDERS = Object.keys(PROVIDER_LABEL) as Provider[];
const NAMES: Record<number, string> = { 1580: 'Fordringar för kontokort och kuponger', 1581: 'Avräkning Klarna', 1582: 'Avräkning Stripe', 6570: 'Bankkostnader' };
const iso = (d: Date) => d.toISOString().slice(0, 10);
const addDays = (d: string, n: number) => iso(new Date(Date.parse(d) + n * 864e5));

export async function createProvider(actor: Actor, input: Record<string, unknown>) {
  const provider = str(input, 'provider') as Provider;
  if (!PROVIDERS.includes(provider)) throw new ValidationError('Välj leverantör');
  const c: Credentials = { api_key: str(input, 'api_key') };
  if (!c.api_key || c.api_key.length > 4000) throw new ValidationError('Ange API-nyckeln');
  const secret = str(input, 'secret'); if (secret) c.secret = secret.slice(0, 500);
  if (provider === 'sumup') { c.merchant_code = str(input, 'merchant_code').toUpperCase(); if (!/^[A-Z0-9]{4,20}$/.test(c.merchant_code)) throw new ValidationError('Ange SumUp-handlarkoden'); }
  if (provider === 'shopify') { c.shop = str(input, 'shop').toLowerCase().replace(/^https?:\/\//, '').replace(/\/.*$/, ''); if (!SHOP_DOMAIN.test(c.shop)) throw new ValidationError('Ange butiksadressen som namn.myshopify.com'); }
  if ((provider === 'klarna' || provider === 'zettle') && !c.secret) throw new ValidationError(provider === 'klarna' ? 'Ange Klarnas lösenord (API-hemlighet)' : 'Ange Zettles klient-id');
  const clearing = optInt(input, 'clearing_account', 'Avräkningskonto') ?? 1580;
  const fee = optInt(input, 'fee_account', 'Avgiftskonto') ?? 6570;
  if (clearing < 1500 || clearing > 1999) throw new ValidationError('Avräkningskontot ska vara ett tillgångskonto (1500–1999)');
  if (fee < 6000 || fee > 6999) throw new ValidationError('Avgiftskontot ska vara ett kostnadskonto (6000–6999)');
  const vat = optInt(input, 'default_vat', 'Momssats') ?? 25;
  if (![25, 12, 6, 0].includes(vat)) throw new ValidationError('Ogiltig momssats');
  const bankId = optInt(input, 'bank_account_id', 'Bankkonto');
  if (bankId) { const [b] = await sql`SELECT 1 FROM bank_accounts WHERE id = ${bankId} AND company_id = ${actor.companyId}`; if (!b) throw new NotFoundError('Bankkontot'); }
  for (const n of [clearing, fee]) if (NAMES[n]) await sql`INSERT INTO accounts (company_id, number, name) VALUES (${actor.companyId}, ${n}, ${NAMES[n]}) ON CONFLICT DO NOTHING`;
  const [r] = await sql<{ id: number }[]>`INSERT INTO payment_providers (company_id, provider, name, credentials_enc, clearing_account, fee_account, default_vat, bank_account_id, created_by, synced_until)
    VALUES (${actor.companyId}, ${provider}, ${str(input, 'name') || PROVIDER_LABEL[provider]}, ${encrypt(JSON.stringify(c))}, ${clearing}, ${fee}, ${vat}, ${bankId ?? null}, ${actor.userId}, ${addDays(iso(new Date()), -8)}) RETURNING id`;
  await auditBy(sql, actor, 'create', 'payment_provider', r.id, { provider });
  return r.id;
}

export async function setProviderActive(actor: Actor, id: number, active: boolean) {
  const r = await sql`UPDATE payment_providers SET active = ${active} WHERE id = ${id} AND company_id = ${actor.companyId} RETURNING id`;
  if (!r.length) throw new NotFoundError('Kopplingen');
  await auditBy(sql, actor, active ? 'activate' : 'deactivate', 'payment_provider', id);
}

export async function listProviders(companyId: number) {
  return [...await sql<{ id: number; provider: Provider; name: string; clearing_account: number; fee_account: number; default_vat: number; bank: string | null; active: boolean; synced_until: string | null; last_sync_at: string | null; last_error: string; reports: number }[]>`
    SELECT p.id, p.provider, p.name, p.clearing_account, p.fee_account, p.default_vat, b.name AS bank, p.active, to_char(p.synced_until,'YYYY-MM-DD') AS synced_until,
      to_char(p.last_sync_at,'YYYY-MM-DD HH24:MI') AS last_sync_at, p.last_error, (SELECT count(*)::int FROM provider_reports r WHERE r.provider_id = p.id) AS reports
    FROM payment_providers p LEFT JOIN bank_accounts b ON b.id = p.bank_account_id WHERE p.company_id = ${companyId} ORDER BY p.created_at`];
}

export async function listReports(companyId: number) {
  return [...await sql<{ id: number; provider: Provider; name: string; kind: 'sales' | 'payout'; date: string; gross: number; fees: number; refunds: number; net: number; status: string; message: string; voucher_id: number | null; bank_transaction_id: number | null }[]>`
    SELECT r.id, p.provider, p.name, r.kind, to_char(r.date,'YYYY-MM-DD') AS date, r.gross::float8 AS gross, r.fees::float8 AS fees, r.refunds::float8 AS refunds, r.net::float8 AS net, r.status, r.message, r.voucher_id, r.bank_transaction_id
    FROM provider_reports r JOIN payment_providers p ON p.id = r.provider_id WHERE r.company_id = ${companyId} ORDER BY r.date DESC, r.id DESC LIMIT 200`];
}

type Conn = { id: number; company_id: number; provider: Provider; name: string; credentials_enc: string; clearing_account: number; fee_account: number; default_vat: Rate; bank_account_id: number | null; synced_until: string | null; bank_ledger: number | null };

async function record(c: Conn, kind: 'sales' | 'payout', ext: string, date: string, v: { gross: number; fees?: number; refunds?: number; net?: number; data?: unknown }, book: (tx: typeof sql) => Promise<number | null>, status = 'booked', message = '') {
  try {
    return await sql.begin(async (tx) => {
      const [r] = await tx<{ id: number }[]>`INSERT INTO provider_reports (provider_id, company_id, kind, external_id, date, gross, fees, refunds, net, data, status, message)
        VALUES (${c.id}, ${c.company_id}, ${kind}, ${ext}, ${date}, ${v.gross}, ${v.fees ?? 0}, ${v.refunds ?? 0}, ${v.net ?? v.gross}, ${tx.json((v.data ?? {}) as never)}, ${status}, ${message})
        ON CONFLICT (provider_id, kind, external_id) DO NOTHING RETURNING id`;
      if (!r) return null;
      if (status === 'booked') { const vid = await book(tx as never); await tx`UPDATE provider_reports SET voucher_id = ${vid} WHERE id = ${r.id}`; }
      return r.id;
    });
  } catch (e) {
    const msg = e instanceof Error ? e.message.slice(0, 300) : 'Bokföringen misslyckades';
    await sql`INSERT INTO provider_reports (provider_id, company_id, kind, external_id, date, gross, fees, refunds, net, status, message)
      VALUES (${c.id}, ${c.company_id}, ${kind}, ${ext}, ${date}, ${v.gross}, ${v.fees ?? 0}, ${v.refunds ?? 0}, ${v.net ?? v.gross}, 'error', ${msg}) ON CONFLICT DO NOTHING`;
    return null;
  }
}

/** Kopplar bokförda utbetalningar till insättningen på bankkontot (samma belopp, några dagars marginal) */
export async function matchPayouts(actor: Actor) {
  const rows = await sql<{ id: number; voucher_id: number; net: number; date: string; bank_account_id: number | null; ledger: number }[]>`
    SELECT r.id, r.voucher_id, r.net::bigint AS net, to_char(r.date,'YYYY-MM-DD') AS date, p.bank_account_id, COALESCE(b.ledger_account, 1930) AS ledger
    FROM provider_reports r JOIN payment_providers p ON p.id = r.provider_id LEFT JOIN bank_accounts b ON b.id = p.bank_account_id
    WHERE r.company_id = ${actor.companyId} AND r.kind = 'payout' AND r.status = 'booked' AND r.voucher_id IS NOT NULL AND r.bank_transaction_id IS NULL`;
  let n = 0;
  for (const r of rows) {
    const [t] = await sql<{ id: number }[]>`SELECT t.id FROM bank_transactions t JOIN bank_accounts a ON a.id = t.bank_account_id
      WHERE t.company_id = ${actor.companyId} AND t.status = 'unmatched' AND t.amount = ${r.net} AND t.booking_date BETWEEN ${r.date}::date - 3 AND ${r.date}::date + 5
        AND ${r.bank_account_id ? sql`t.bank_account_id = ${r.bank_account_id}` : sql`a.ledger_account = ${r.ledger}`}
      ORDER BY abs(t.booking_date - ${r.date}::date), t.id LIMIT 1`;
    if (!t) continue;
    try {
      await reconcile(actor, t.id, { type: 'voucher', id: r.voucher_id });
      await sql`UPDATE provider_reports SET status = 'matched', bank_transaction_id = ${t.id} WHERE id = ${r.id}`;
      n++;
    } catch (e) { console.error('payout match', r.id, e instanceof Error ? e.message : e); }
  }
  return n;
}

/** Hämtar dagsrapporter och utbetalningar sedan senaste körningen (högst 31 dagar bakåt) och bokför dem */
export async function syncProvider(actor: Actor, id: number) {
  const [c] = await sql<Conn[]>`SELECT p.id, p.company_id, p.provider, p.name, p.credentials_enc, p.clearing_account, p.fee_account, p.default_vat, p.bank_account_id,
      to_char(p.synced_until,'YYYY-MM-DD') AS synced_until, b.ledger_account AS bank_ledger
    FROM payment_providers p LEFT JOIN bank_accounts b ON b.id = p.bank_account_id WHERE p.id = ${id} AND p.company_id = ${actor.companyId} AND p.active`;
  if (!c) throw new NotFoundError('Kopplingen');
  const cred = JSON.parse(decrypt(c.credentials_enc)) as Credentials;
  const yesterday = addDays(iso(new Date()), -1);
  const from = [c.synced_until ? addDays(c.synced_until, 1) : addDays(yesterday, -7), addDays(yesterday, -30)].sort().pop()!;
  const label = PROVIDER_LABEL[c.provider];
  const out = { sales: 0, payouts: 0, errors: 0, matched: 0 };
  try {
    if (HAS_SALES[c.provider]) {
      for (let d = from; d <= yesterday; d = addDays(d, 1)) {
        const s = await fetchSales(c.provider, cred, d, c.default_vat);
        const lines = salesLines(s, c.clearing_account);
        const gross = lines.length ? lines.find((l) => l.account === c.clearing_account)?.debit ?? 0 : 0;
        if (!s.count || !gross) continue;
        const r = await record(c, 'sales', `sales-${d}`, d, { gross, data: s }, async (tx) => (await createVoucher(tx as never, { actor, date: d, description: `Dagsrapport ${label} ${d} (${s.count} köp)`, lines, sourceType: 'provider_report' })).id);
        if (r) out.sales++;
      }
    }
    const payouts: Payout[] = await fetchPayouts(c.provider, cred, from, iso(new Date()));
    for (const p of payouts) {
      if (p.currency !== 'SEK') { await record(c, 'payout', p.id, p.date, p, async () => null, 'skipped', `Valutan ${p.currency} bokförs inte automatiskt`); continue; }
      let lines;
      try { lines = payoutLines(p, { clearing: c.clearing_account, bank: c.bank_ledger ?? 1930, fee: c.fee_account }); }
      catch (e) { await record(c, 'payout', p.id, p.date, p, async () => null, 'error', (e as Error).message); out.errors++; continue; }
      const r = await record(c, 'payout', p.id, p.date, { ...p, data: p }, async (tx) => (await createVoucher(tx as never, { actor, date: p.date, description: `Utbetalning ${label} ${p.date}`, lines, sourceType: 'provider_report' })).id);
      if (r) out.payouts++;
    }
    await sql`UPDATE payment_providers SET synced_until = ${yesterday}, last_sync_at = now(), last_error = '' WHERE id = ${c.id}`;
  } catch (e) {
    await sql`UPDATE payment_providers SET last_sync_at = now(), last_error = ${e instanceof Error ? e.message.slice(0, 300) : 'Fel'} WHERE id = ${c.id}`;
    throw e;
  }
  out.matched = await matchPayouts(actor);
  out.errors += Number((await sql<{ n: number }[]>`SELECT count(*)::int AS n FROM provider_reports WHERE provider_id = ${c.id} AND status = 'error' AND created_at > now() - interval '1 minute'`)[0].n);
  await auditBy(sql, actor, 'sync', 'payment_provider', c.id, out);
  return out;
}

/** För cron: alla aktiva kopplingar, som bolagets ägare */
export async function syncAllProviders() {
  const rows = await sql<{ id: number; company_id: number; owner: number | null }[]>`SELECT p.id, p.company_id,
    (SELECT m.user_id FROM memberships m WHERE m.company_id = p.company_id AND m.role = 'owner' ORDER BY m.created_at LIMIT 1) AS owner
    FROM payment_providers p WHERE p.active`;
  let ok = 0, failed = 0;
  for (const r of rows) {
    if (!r.owner) continue;
    try { await syncProvider({ companyId: r.company_id, userId: r.owner, apiKeyId: null, role: 'owner' }, r.id); ok++; }
    catch (e) { failed++; console.error('payprovider', r.id, e instanceof Error ? e.message : e); }
  }
  return { ok, failed };
}
