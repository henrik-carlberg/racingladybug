import 'server-only';
import { randomBytes } from 'node:crypto';
import { sql } from '@/lib/db';
import { sendMail, mailConfigured } from '@/lib/server/mail';
import { buildDigest, digestDue, type DigestFreq } from '@/lib/digest';
import { companyTodos } from './todo';
import { enabledModules } from '@/lib/modules/enabled';

export const appOrigin = () =>
  (process.env.APP_ORIGIN || (process.env.VERCEL_PROJECT_PRODUCTION_URL ? `https://${process.env.VERCEL_PROJECT_PRODUCTION_URL}` : 'http://localhost:3000')).replace(/\/$/, '');

async function unsubscribeToken(userId: number, current: string | null) {
  if (current) return current;
  const t = randomBytes(24).toString('base64url');
  await sql`UPDATE users SET unsubscribe_token = ${t} WHERE id = ${userId} AND unsubscribe_token IS NULL`;
  const [u] = await sql<{ t: string }[]>`SELECT unsubscribe_token AS t FROM users WHERE id = ${userId}`;
  return u.t;
}

/** Skickar sammandrag till alla som ska ha ett nu. Anropas av det dagliga cron-jobbet. */
export async function sendDigests(now = new Date()) {
  if (!mailConfigured()) return { sent: 0, skipped: 'e-post inte konfigurerad' };
  const users = await sql<{ id: number; email: string; name: string; digest: DigestFreq; digest_sent_at: Date | null; unsubscribe_token: string | null }[]>`
    SELECT u.id, u.email, u.name, u.digest, u.digest_sent_at, u.unsubscribe_token FROM users u
    WHERE u.digest <> 'off' AND EXISTS (SELECT 1 FROM memberships m WHERE m.user_id = u.id AND m.role IN ('owner','accountant'))`;
  const origin = appOrigin();
  let sent = 0, checked = 0;
  for (const u of users) {
    if (!digestDue(u.digest, u.digest_sent_at, now)) continue;
    checked++;
    const memberships = await sql<{ id: number; name: string; role: string }[]>`
      SELECT c.id, c.name, m.role FROM memberships m JOIN companies c ON c.id = m.company_id
      WHERE m.user_id = ${u.id} AND m.role IN ('owner','accountant') AND NOT c.is_demo ORDER BY c.name`;
    const companies = [];
    for (const c of memberships) {
      const modules = (await enabledModules(c.id)).map((m) => m.id);
      companies.push({ id: c.id, name: c.name, todos: (await companyTodos(c.id, { modules, owner: c.role === 'owner', userId: u.id })).filter((t) => t.key !== 'mfa' && t.key !== 'dpa') });
    }
    const token = await unsubscribeToken(u.id, u.unsubscribe_token);
    const mail = buildDigest({ name: u.name, origin, companies, freq: u.digest, unsubscribeUrl: `${origin}/avregistrera/${token}` });
    // Markera som kontrollerad även när inget skickas, så att vi inte räknar om varje körning
    await sql`UPDATE users SET digest_sent_at = ${now} WHERE id = ${u.id}`;
    if (mail && await sendMail(u.email, mail.subject, mail.text)) sent++;
  }
  return { sent, checked };
}

export async function setDigest(userId: number, freq: DigestFreq) {
  await sql`UPDATE users SET digest = ${freq} WHERE id = ${userId}`;
}

export async function unsubscribe(token: string) {
  if (!/^[A-Za-z0-9_-]{20,64}$/.test(token)) return false;
  const r = await sql`UPDATE users SET digest = 'off' WHERE unsubscribe_token = ${token} RETURNING id`;
  return r.length > 0;
}

/** Månadsrapport till ägarna några dagar in i månaden, för föregående månad. Skickas en gång per bolag och månad. */
export async function sendMonthlyReports(now = new Date()) {
  if (!mailConfigured()) return { sent: 0, skipped: 'e-post inte konfigurerad' };
  const local = new Intl.DateTimeFormat('sv-SE', { timeZone: 'Europe/Stockholm', year: 'numeric', month: '2-digit', day: '2-digit' }).format(now);
  if (Number(local.slice(8, 10)) < 3) return { sent: 0, skipped: 'för tidigt i månaden' };
  const { addMonths } = await import('@/lib/assets');
  const { monthlyReport, monthlyReportText } = await import('./monthly');
  const period = addMonths(local.slice(0, 7), -1);
  const companies = await sql<{ id: number; name: string }[]>`
    SELECT c.id, c.name FROM companies c WHERE NOT c.is_demo
      AND NOT EXISTS (SELECT 1 FROM monthly_reports_sent s WHERE s.company_id = c.id AND s.period = ${period})
      AND EXISTS (SELECT 1 FROM vouchers v WHERE v.company_id = c.id AND v.date BETWEEN ${period + '-01'} AND ${period + '-28'}::date + 3)`;
  const origin = appOrigin();
  let sent = 0;
  for (const c of companies) {
    const owners = await sql<{ email: string }[]>`SELECT u.email FROM memberships m JOIN users u ON u.id = m.user_id
      WHERE m.company_id = ${c.id} AND m.role = 'owner' AND u.monthly_report`;
    await sql`INSERT INTO monthly_reports_sent (company_id, period) VALUES (${c.id}, ${period}) ON CONFLICT DO NOTHING`;
    if (!owners.length) continue;
    const r = await monthlyReport(c.id, period);
    const text = monthlyReportText(r, c.name, `${origin}/c/${c.id}/rapporter/manad?period=${period}`) + `\n\nStäng av månadsrapporten under Mitt konto: ${origin}/konto`;
    for (const o of owners) if (await sendMail(o.email, `Månadsrapport ${period} – ${c.name}`, text)) sent++;
  }
  return { sent, companies: companies.length, period };
}

export async function setMonthlyReport(userId: number, on: boolean) {
  await sql`UPDATE users SET monthly_report = ${on} WHERE id = ${userId}`;
}
