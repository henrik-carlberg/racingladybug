import 'server-only';
import { transferTax, TRANSFER_LABEL, type TransferKind } from '@/lib/ownership-change';
import { sql, type Tx } from '@/lib/db';
import { ConflictError, NotFoundError, ValidationError } from '@/lib/errors';
import { auditBy } from '@/lib/server/audit';
import { createVoucher } from '@/lib/server/ledger';
import { fromSigned } from '@/lib/ledger-lines';
import { count, fmtRanges, issueEntries, normalize, ownership, quotaValue, take, type Range } from '@/lib/shares';
import type { Actor } from './actor';
import { date, int, ore, str } from './input';
import { createDocument, sendDocument } from './documents';

const esc = (s: string) => s.replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]!);
const kr = (o: number) => (o / 100).toLocaleString('sv-SE', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const ownerOnly = (a: Actor) => { if (a.role !== 'owner') throw new ValidationError('Bara ägaren kan ändra aktieboken'); };
const keyOf = (name: string, id: string) => `${id.replace(/\D/g, '') || name.toLowerCase()}`;

export interface Holder { key: string; name: string; holder_id: string; address: string; a: Range[]; b: Range[]; shares: number; pct: number; votePct: number; since: string }

export async function getRegister(companyId: number) {
  const [s] = await sql<{ share_capital: number; total_shares: number }[]>`SELECT share_capital::float8 AS share_capital, total_shares FROM share_settings WHERE company_id = ${companyId}`;
  const rows = await sql<{ holder_name: string; holder_id: string; address: string; share_class: 'A' | 'B'; from_no: number; to_no: number; acquired_on: string }[]>`
    SELECT holder_name, holder_id, address, share_class, from_no, to_no, to_char(acquired_on,'YYYY-MM-DD') AS acquired_on FROM share_holdings WHERE company_id = ${companyId} ORDER BY from_no`;
  const map = new Map<string, Omit<Holder, 'shares' | 'pct' | 'votePct'>>();
  for (const r of rows) {
    const k = keyOf(r.holder_name, r.holder_id);
    const h = map.get(k) ?? { key: k, name: r.holder_name, holder_id: r.holder_id, address: r.address, a: [], b: [], since: r.acquired_on };
    (r.share_class === 'A' ? h.a : h.b).push({ from: r.from_no, to: r.to_no });
    if (r.acquired_on < h.since) h.since = r.acquired_on;
    map.set(k, h);
  }
  const hs = [...map.values()];
  const own = ownership(hs.map((h) => ({ key: h.key, a: count(h.a), b: count(h.b) })));
  const holders: Holder[] = hs.map((h) => ({ ...h, a: normalize(h.a), b: normalize(h.b), ...own.find((o) => o.key === h.key)! }));
  const events = await sql<{ date: string; kind: string; text: string }[]>`SELECT to_char(date,'YYYY-MM-DD') AS date, kind, text FROM share_events WHERE company_id = ${companyId} ORDER BY date DESC, id DESC LIMIT 100`;
  const issues = await sql<{ id: number; decided_on: string; new_shares: number; price: number; share_class: string; status: string; document_id: number | null; subscribed: number }[]>`
    SELECT i.id, to_char(i.decided_on,'YYYY-MM-DD') AS decided_on, i.new_shares, i.price::float8 AS price, i.share_class, i.status, i.document_id,
      COALESCE((SELECT SUM(shares) FROM share_subscriptions s WHERE s.issue_id = i.id), 0)::int AS subscribed FROM share_issues i WHERE i.company_id = ${companyId} ORDER BY i.id DESC`;
  return { settings: s ?? null, quota: s ? quotaValue(s.share_capital, s.total_shares) : 0, holders: holders.sort((a, b) => b.shares - a.shares), events: [...events], issues: [...issues] };
}

async function event(tx: Tx, actor: Actor, kind: string, d: string, text: string, details: unknown) {
  await tx`INSERT INTO share_events (company_id, kind, date, text, details, created_by) VALUES (${actor.companyId}, ${kind}, ${d}, ${text}, ${tx.json(details as never)}, ${actor.userId})`;
}

/** K10-ägarnas andel följer aktieboken (matchas på personnummer) */
async function syncOwners(tx: Tx, companyId: number) {
  const rows = await tx<{ holder_id: string; n: number }[]>`SELECT holder_id, SUM(to_no - from_no + 1)::int AS n FROM share_holdings WHERE company_id = ${companyId} GROUP BY holder_id`;
  const total = rows.reduce((s, r) => s + r.n, 0);
  for (const r of rows) {
    const id = r.holder_id.replace(/\D/g, '');
    if (id.length < 10) continue;
    await tx`UPDATE company_owners SET share_pct = ${Math.round((r.n / total) * 100000) / 1000} WHERE company_id = ${companyId} AND regexp_replace(personal_number, '\\D', '', 'g') IN (${id}, ${id.slice(-10)})`;
  }
}

/** Aktieboken läggs upp med aktiekapital och ägare; aktierna numreras från 1 */
export async function initRegister(actor: Actor, input: { share_capital: number; date: string; holders: { name: string; holder_id: string; address: string; shares: number; share_class: 'A' | 'B' }[] }) {
  ownerOnly(actor);
  if (!input.holders.length) throw new ValidationError('Ange minst en aktieägare');
  if (!(input.share_capital >= 2500000)) throw new ValidationError('Aktiekapitalet ska vara minst 25 000 kr');
  const total = input.holders.reduce((s, h) => s + h.shares, 0);
  if (!input.holders.every((h) => Number.isInteger(h.shares) && h.shares > 0 && h.name.trim())) throw new ValidationError('Ange namn och antal aktier för varje ägare');
  return sql.begin(async (tx) => {
    if ((await tx`SELECT 1 FROM share_settings WHERE company_id = ${actor.companyId}`).length) throw new ConflictError('Aktieboken är redan upplagd');
    await tx`INSERT INTO share_settings (company_id, share_capital, total_shares) VALUES (${actor.companyId}, ${input.share_capital}, ${total})`;
    let next = 1;
    for (const h of input.holders) {
      await tx`INSERT INTO share_holdings (company_id, holder_name, holder_id, address, share_class, from_no, to_no, acquired_on)
        VALUES (${actor.companyId}, ${h.name.trim()}, ${h.holder_id.trim()}, ${h.address.trim()}, ${h.share_class}, ${next}, ${next + h.shares - 1}, ${input.date})`;
      next += h.shares;
    }
    await event(tx, actor, 'founding', input.date, `Aktieboken upplagd: ${total} aktier, aktiekapital ${kr(input.share_capital)} kr`, { holders: input.holders.map((h) => ({ name: h.name, shares: h.shares })) });
    await syncOwners(tx, actor.companyId);
    await auditBy(tx, actor, 'share_register', 'company', actor.companyId, { total });
  });
}

/** Överlåtelse: säljarens lägsta aktienummer går till köparen */
export async function transferShares(actor: Actor, input: Record<string, unknown>) {
  ownerOnly(actor);
  const from = str(input, 'from', { required: true, label: 'Säljare' }), n = int(input, 'shares', 'Antal aktier'), d = date(input, 'date', 'Datum');
  const toName = str(input, 'to_name', { required: true, label: 'Köpare', max: 200 }), toId = str(input, 'to_id', { max: 20 }), toAddress = str(input, 'to_address', { max: 300 });
  const cls = str(input, 'share_class') === 'A' ? 'A' : 'B';
  return sql.begin(async (tx) => {
    const rows = await tx<{ id: number; holder_name: string; holder_id: string; address: string; from_no: number; to_no: number; acquired_on: string }[]>`SELECT id, holder_name, holder_id, address, from_no, to_no,
      to_char(acquired_on,'YYYY-MM-DD') AS acquired_on FROM share_holdings
      WHERE company_id = ${actor.companyId} AND share_class = ${cls} ORDER BY from_no FOR UPDATE`;
    const mine = rows.filter((r) => keyOf(r.holder_name, r.holder_id) === from);
    if (!mine.length) throw new NotFoundError('Säljaren');
    if (keyOf(toName, toId) === from) throw new ValidationError('Köparen och säljaren är samma');
    const t = take(mine.map((r) => ({ from: r.from_no, to: r.to_no })), n);
    // Omkostnadsbeloppet gäller ägarens alla aktier, så andelen räknas på innehavet i båda aktieslagen
    const other = (await tx<{ holder_name: string; holder_id: string; n: number }[]>`SELECT holder_name, holder_id, (to_no - from_no + 1)::int AS n FROM share_holdings
      WHERE company_id = ${actor.companyId} AND share_class <> ${cls}`).filter((r) => keyOf(r.holder_name, r.holder_id) === from).reduce((s, r) => s + r.n, 0);
    const sellerShares = mine.reduce((s, r) => s + r.to_no - r.from_no + 1, 0) + other;
    await tx`DELETE FROM share_holdings WHERE id IN ${tx(mine.map((r) => r.id))}`;
    const seller = mine[0];
    // Säljarens kvarvarande aktier behåller sitt ursprungliga förvärvsdatum
    const acquired = (r: Range) => mine.find((m) => m.from_no <= r.from && m.to_no >= r.to)?.acquired_on ?? seller.acquired_on;
    for (const r of t.left) await tx`INSERT INTO share_holdings (company_id, holder_name, holder_id, address, share_class, from_no, to_no, acquired_on)
      VALUES (${actor.companyId}, ${seller.holder_name}, ${seller.holder_id}, ${seller.address}, ${cls}, ${r.from}, ${r.to}, ${acquired(r)})`;
    for (const r of t.taken) await tx`INSERT INTO share_holdings (company_id, holder_name, holder_id, address, share_class, from_no, to_no, acquired_on)
      VALUES (${actor.companyId}, ${toName}, ${toId}, ${toAddress}, ${cls}, ${r.from}, ${r.to}, ${d})`;
    const priceOre = input.price ? ore(input, 'price', 'Pris') : 0;
    const price = priceOre ? ` för ${kr(priceOre)} kr` : '';
    const kind = (['sale', 'gift', 'inheritance'].includes(str(input, 'kind')) ? str(input, 'kind') : priceOre ? 'sale' : 'gift') as TransferKind;
    // Omkostnadsbelopp och sparat utdelningsutrymme (K10) följer med enligt överlåtelsens typ
    const digits = (s: string) => s.replace(/\D/g, '').slice(-10);
    const [so] = await tx<{ id: number; cost: number; saved: number }[]>`SELECT id, cost_basis::float8 AS cost, saved_space::float8 AS saved FROM company_owners
      WHERE company_id = ${actor.companyId} AND right(regexp_replace(personal_number, '\\D', '', 'g'), 10) = ${digits(seller.holder_id)} AND ${digits(seller.holder_id).length === 10} LIMIT 1`;
    let tax: ReturnType<typeof transferTax> | null = null;
    if (so) {
      tax = transferTax({ kind, price: priceOre, sellerShares, shares: n, sellerCost: so.cost, sellerSaved: so.saved });
      await tx`UPDATE company_owners SET cost_basis = ${tax.sellerCostAfter}, saved_space = ${tax.sellerSavedAfter} WHERE id = ${so.id}`;
      if (digits(toId).length === 10) {
        const [bo] = await tx<{ id: number }[]>`SELECT id FROM company_owners WHERE company_id = ${actor.companyId} AND right(regexp_replace(personal_number, '\\D', '', 'g'), 10) = ${digits(toId)} LIMIT 1`;
        if (bo) await tx`UPDATE company_owners SET cost_basis = cost_basis + ${tax.buyerCost}, saved_space = saved_space + ${tax.buyerSaved} WHERE id = ${bo.id}`;
        else await tx`INSERT INTO company_owners ${tx({ company_id: actor.companyId, name: toName, personal_number: toId, share_pct: 0.001, cost_basis: tax.buyerCost, saved_space: tax.buyerSaved })}`;
      }
    }
    await event(tx, actor, 'transfer', d, `${seller.holder_name} överlät ${n} ${cls}-aktier (nr ${fmtRanges(t.taken)}) till ${toName} genom ${TRANSFER_LABEL[kind].toLowerCase()}${price}`,
      { from: seller.holder_name, to: toName, shares: n, ranges: t.taken, kind, price: priceOre, ...(tax ? { moved_cost: tax.movedCost, moved_saved: tax.movedSaved, gain: tax.gain, as_sale: tax.asSale } : {}) });
    await syncOwners(tx, actor.companyId);
    // Säljare som inte har några aktier kvar tas bort ur K10-registret om det inte finns historik på dem (aktieboken behåller händelsen)
    if (so && !t.left.length && !other) await tx`DELETE FROM company_owners o WHERE o.id = ${so.id}
      AND NOT EXISTS (SELECT 1 FROM dividend_payout_lines l WHERE l.owner_id = o.id) AND NOT EXISTS (SELECT 1 FROM k10_history k WHERE k.owner_id = o.id)
      AND NOT EXISTS (SELECT 1 FROM shareholder_contributions c WHERE c.owner_id = o.id)`;
    await auditBy(tx, actor, 'share_transfer', 'company', actor.companyId, { shares: n });
    return tax;
  });
}

// ---------- Nyemission ----------
/** Beslut om nyemission: protokollet skickas för e-signering till ägaren */
export async function decideIssue(actor: Actor, input: Record<string, unknown>) {
  ownerOnly(actor);
  const r = await getRegister(actor.companyId);
  if (!r.settings) throw new ValidationError('Lägg upp aktieboken först');
  const n = int(input, 'new_shares', 'Nya aktier'), price = ore(input, 'price', 'Teckningskurs', { min: 1 }), d = date(input, 'date', 'Datum');
  const cls = str(input, 'share_class') === 'A' ? 'A' : 'B';
  if (n <= 0) throw new ValidationError('Ange antal nya aktier');
  const e = issueEntries({ newShares: n, pricePerShare: price, quota: r.quota });
  const [co] = await sql<{ name: string; orgnr: string }[]>`SELECT name, orgnr FROM companies WHERE id = ${actor.companyId}`;
  const [me] = await sql<{ name: string }[]>`SELECT name FROM users WHERE id = ${actor.userId}`;
  const html = `<h1>Protokoll fört vid extra bolagsstämma</h1><p>${esc(co.name)} (${esc(co.orgnr)}) · ${esc(d)}</p>
<h2>Beslut om nyemission</h2><p>Stämman beslutade att öka aktiekapitalet med ${kr(e.capital)} kr genom nyemission av ${n} ${cls}-aktier till en teckningskurs om ${kr(price)} kr per aktie,
totalt ${kr(e.total)} kr varav ${kr(e.premium)} kr tillförs den fria överkursfonden. Teckning sker på särskild teckningslista och betalning ska ske kontant till bolagets bankkonto.
De nya aktierna medför rätt till utdelning från och med att de har registrerats hos Bolagsverket.</p><p>Justeras:</p>`;
  return sql.begin(async (tx) => {
    const doc = await createDocument(actor, { title: `Beslut om nyemission ${d}`, html, source_module: 'aktiebok', signers: [{ name: me.name, user_id: actor.userId }] }, tx);
    await sendDocument(actor, doc.id, undefined, tx);
    const [i] = await tx<{ id: number }[]>`INSERT INTO share_issues (company_id, decided_on, new_shares, price, share_class, document_id, created_by)
      VALUES (${actor.companyId}, ${d}, ${n}, ${price}, ${cls}, ${doc.id}, ${actor.userId}) RETURNING id`;
    await auditBy(tx, actor, 'share_issue', 'company', actor.companyId, { issue: i.id, shares: n, price });
    return i.id;
  });
}

async function issue(tx: Tx, companyId: number, id: number) {
  const [i] = await tx<{ id: number; decided_on: string; new_shares: number; price: number; share_class: 'A' | 'B'; status: string }[]>`SELECT id, to_char(decided_on,'YYYY-MM-DD') AS decided_on, new_shares,
    price::float8 AS price, share_class, status FROM share_issues WHERE id = ${id} AND company_id = ${companyId} FOR UPDATE`;
  if (!i) throw new NotFoundError('Nyemissionen');
  return i;
}

export async function subscribe(actor: Actor, issueId: number, input: Record<string, unknown>) {
  ownerOnly(actor);
  const n = int(input, 'shares', 'Antal aktier');
  if (n <= 0) throw new ValidationError('Ange antal aktier');
  return sql.begin(async (tx) => {
    const i = await issue(tx, actor.companyId, issueId);
    if (i.status !== 'decided') throw new ConflictError('Teckningen är avslutad');
    const [{ s }] = await tx<{ s: number }[]>`SELECT COALESCE(SUM(shares), 0)::int AS s FROM share_subscriptions WHERE issue_id = ${issueId}`;
    if (s + n > i.new_shares) throw new ValidationError(`Bara ${i.new_shares - s} aktier återstår att teckna`);
    await tx`INSERT INTO share_subscriptions (issue_id, name, holder_id, address, shares) VALUES (${issueId}, ${str(input, 'name', { required: true, label: 'Tecknare', max: 200 })},
      ${str(input, 'holder_id', { max: 20 })}, ${str(input, 'address', { max: 300 })}, ${n})`;
  });
}

export async function subscriptions(companyId: number, issueId: number) {
  return [...await sql<{ id: number; name: string; holder_id: string; shares: number }[]>`SELECT s.id, s.name, s.holder_id, s.shares FROM share_subscriptions s JOIN share_issues i ON i.id = s.issue_id
    WHERE s.issue_id = ${issueId} AND i.company_id = ${companyId} ORDER BY s.id`];
}

/** Inbetalningen bokförs: bank mot ej registrerat aktiekapital och överkursfond */
export async function bookIssuePayment(actor: Actor, issueId: number, d: string) {
  ownerOnly(actor);
  const r = await getRegister(actor.companyId);
  return sql.begin(async (tx) => {
    const i = await issue(tx, actor.companyId, issueId);
    if (i.status !== 'decided') throw new ConflictError('Inbetalningen är redan bokförd');
    const [{ s }] = await tx<{ s: number }[]>`SELECT COALESCE(SUM(shares), 0)::int AS s FROM share_subscriptions WHERE issue_id = ${issueId}`;
    if (s !== i.new_shares) throw new ValidationError(`Alla aktier måste vara tecknade (${s} av ${i.new_shares})`);
    const e = issueEntries({ newShares: i.new_shares, pricePerShare: i.price, quota: r.quota });
    for (const [n, name] of [[2082, 'Ej registrerat aktiekapital'], [2097, 'Fri överkursfond'], [2081, 'Aktiekapital']] as const)
      await tx`INSERT INTO accounts (company_id, number, name) VALUES (${actor.companyId}, ${n}, ${name}) ON CONFLICT DO NOTHING`;
    const v = await createVoucher(tx, { actor, date: d, description: `Nyemission ${i.decided_on}: inbetalning ${i.new_shares} aktier`, lines: fromSigned(e.payment), sourceType: 'share_issue', sourceId: issueId });
    await tx`UPDATE share_issues SET status = 'paid', payment_voucher_id = ${v.id} WHERE id = ${issueId}`;
    return v.id;
  });
}

/** Bolagsverket har registrerat emissionen: aktiekapitalet flyttas till 2081 och tecknarna förs in i aktieboken */
export async function registerIssue(actor: Actor, issueId: number, d: string) {
  ownerOnly(actor);
  const r = await getRegister(actor.companyId);
  return sql.begin(async (tx) => {
    const i = await issue(tx, actor.companyId, issueId);
    if (i.status !== 'paid') throw new ConflictError('Bokför inbetalningen först');
    const e = issueEntries({ newShares: i.new_shares, pricePerShare: i.price, quota: r.quota });
    const v = await createVoucher(tx, { actor, date: d, description: `Nyemission ${i.decided_on}: registrerad hos Bolagsverket`, lines: fromSigned(e.registration), sourceType: 'share_issue', sourceId: issueId });
    const [{ max }] = await tx<{ max: number }[]>`SELECT COALESCE(max(to_no), 0)::int AS max FROM share_holdings WHERE company_id = ${actor.companyId}`;
    let next = max + 1;
    for (const s of await tx<{ name: string; holder_id: string; address: string; shares: number }[]>`SELECT name, holder_id, address, shares FROM share_subscriptions WHERE issue_id = ${issueId} ORDER BY id`) {
      await tx`INSERT INTO share_holdings (company_id, holder_name, holder_id, address, share_class, from_no, to_no, acquired_on)
        VALUES (${actor.companyId}, ${s.name}, ${s.holder_id}, ${s.address}, ${i.share_class}, ${next}, ${next + s.shares - 1}, ${d})`;
      next += s.shares;
    }
    await tx`UPDATE share_settings SET share_capital = share_capital + ${e.capital}, total_shares = total_shares + ${i.new_shares}, updated_at = now() WHERE company_id = ${actor.companyId}`;
    await tx`UPDATE share_issues SET status = 'registered', registration_voucher_id = ${v.id} WHERE id = ${issueId}`;
    await event(tx, actor, 'issue', d, `Nyemission av ${i.new_shares} ${i.share_class}-aktier (nr ${max + 1}–${next - 1}) registrerad, aktiekapitalet ökat med ${kr(e.capital)} kr`, { issue: issueId });
    await syncOwners(tx, actor.companyId);
    return v.id;
  });
}

// ---------- Styrelseprotokoll ----------
export async function boardMinutes(actor: Actor, input: { date: string; place: string; present: string; items: string; signers: { name: string; email: string }[] }) {
  ownerOnly(actor);
  const items = input.items.split('\n').map((s) => s.trim()).filter(Boolean);
  if (!items.length) throw new ValidationError('Skriv minst en punkt i protokollet');
  const signers = input.signers.filter((s) => s.name.trim());
  if (!signers.length) throw new ValidationError('Ange vem som justerar protokollet');
  const [co] = await sql<{ name: string; orgnr: string }[]>`SELECT name, orgnr FROM companies WHERE id = ${actor.companyId}`;
  const html = `<h1>Protokoll fört vid styrelsemöte</h1><p>${esc(co.name)} (${esc(co.orgnr)}) · ${esc(input.date)}${input.place ? ` · ${esc(input.place)}` : ''}</p>
<p><b>Närvarande:</b> ${esc(input.present)}</p><ol>${items.map((i) => `<li>${esc(i)}</li>`).join('')}</ol><p>Justeras:</p>`;
  const doc = await createDocument(actor, { title: `Styrelseprotokoll ${input.date}`, html, source_module: 'aktiebok', signers: signers.map((s) => ({ name: s.name, email: s.email })) });
  await sendDocument(actor, doc.id);
  return doc.id;
}

