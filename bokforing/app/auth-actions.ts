'use server';
import { sql } from '@/lib/db';
import { attempt, done, str } from '@/lib/server/action';
import { createSession, destroySession, hashPassword, verifyPassword, sha256 } from '@/lib/server/auth';
import { audit } from '@/lib/server/audit';
import { signupOpen } from '@/lib/billing';
import { completeLogin, startLogin } from '@/lib/server/mfa';
import { clientIp, current, hit, limit, LIMITS, RateLimitError } from '@/lib/server/ratelimit';

// Används för att jämna ut svarstiden när kontot inte finns (så att det inte går att se vilka e-postadresser som har konton)
const DUMMY_HASH = '$2b$12$Oep9/AQg0NgRE4rInnYH/u19zgfpHnL6psqysUoABAOUw9YK3vKI2';

export async function login(fd: FormData) {
  let next = '/';
  await attempt('/login', async () => {
    const email = str(fd, 'email').toLowerCase();
    const ip = await clientIp();
    const L = LIMITS;
    const blocked = (await current(`login:${email}`, L.loginFailEmail.window)) >= L.loginFailEmail.max || (await current(`loginip:${ip}`, L.loginFailIp.window)) >= L.loginFailIp.max;
    if (blocked) throw new RateLimitError(L.loginFailEmail.window);
    const [u] = await sql<{ id: number; password_hash: string }[]>`SELECT id, password_hash FROM users WHERE email = ${email}`;
    const ok = await verifyPassword(str(fd, 'password'), u?.password_hash ?? DUMMY_HASH);
    if (!u || !ok) {
      await hit(`login:${email}`, L.loginFailEmail.max, L.loginFailEmail.window);
      await hit(`loginip:${ip}`, L.loginFailIp.max, L.loginFailIp.window);
      throw new Error('Fel e-post eller lösenord');
    }
    // Tillbaka dit användaren skulle (t.ex. en apps samtyckessida) – bara sökvägar inom appen
    const want = str(fd, 'next');
    next = await startLogin(u.id, /^\/(?![\/\\])[\w\-./?=&%:~+]*$/.test(want) ? want : '/');
  });
  done(next);
}

/** Andra steget: engångskod från appen eller en reservkod */
export async function loginCode(fd: FormData) {
  let msg = '';
  await attempt('/login/kod', async () => {
    await limit(`mfa:${await clientIp()}`, LIMITS.mfa.max, LIMITS.mfa.window);
    const r = await completeLogin(str(fd, 'code'));
    if (!r.ok) throw new Error('Fel kod – försök igen');
    if (r.backupUsed) msg = 'Du loggade in med en reservkod. Den kan inte användas igen.';
  });
  done('/', msg || undefined);
}

function checkPassword(pw: string) {
  if (pw.length < 10) throw new Error('Lösenordet måste vara minst 10 tecken');
}

/** Fri registrering (sätt ALLOW_SIGNUP=false för att bara tillåta det första kontot och inbjudningar) */
export async function register(fd: FormData) {
  await attempt('/register', async () => {
    await limit(`register:${await clientIp()}`, LIMITS.register.max, LIMITS.register.window);
    const [{ count }] = await sql<{ count: number }[]>`SELECT count(*)::int AS count FROM users`;
    if (count > 0 && !signupOpen()) throw new Error('Registrering är stängd. Be ägaren om en inbjudan.');
    const email = str(fd, 'email').toLowerCase();
    if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) throw new Error('Ogiltig e-postadress');
    if ((await sql`SELECT 1 FROM users WHERE email = ${email}`).length) throw new Error('Det finns redan ett konto med den e-postadressen – logga in i stället');
    if (fd.get('terms') !== 'on') throw new Error('Godkänn villkoren för att skapa konto');
    const pw = str(fd, 'password');
    checkPassword(pw);
    const [u] = await sql<{ id: number }[]>`
      INSERT INTO users (email, name, password_hash) VALUES (${str(fd, 'email').toLowerCase()}, ${str(fd, 'name')}, ${await hashPassword(pw)})
      RETURNING id`;
    await audit(sql, { companyId: null, userId: u.id, action: 'register', entity: 'user', entityId: u.id });
    await createSession(u.id);
  });
  done('/');
}

export async function acceptInvite(fd: FormData) {
  const token = str(fd, 'token');
  let next = '/';
  await attempt(`/invite/${token}`, async () => {
    await limit(`invite:${await clientIp()}`, LIMITS.loginFailIp.max, LIMITS.loginFailIp.window);
    const userId = await sql.begin(async (tx) => {
      const [inv] = await tx<{ id: number; company_id: number; email: string; role: string; employee_id: number | null }[]>`
        SELECT id, company_id, email, role, employee_id FROM invites
        WHERE token_hash = ${sha256(token)} AND accepted_at IS NULL AND expires_at > now() FOR UPDATE`;
      if (!inv) throw new Error('Inbjudan är ogiltig eller har gått ut');
      let [u] = await tx<{ id: number; password_hash: string }[]>`SELECT id, password_hash FROM users WHERE email = ${inv.email}`;
      const pw = str(fd, 'password');
      if (u) {
        if (!(await verifyPassword(pw, u.password_hash))) throw new Error('Fel lösenord för befintligt konto');
      } else {
        checkPassword(pw);
        [u] = await tx`INSERT INTO users (email, name, password_hash) VALUES (${inv.email}, ${str(fd, 'name')}, ${await hashPassword(pw)}) RETURNING id, password_hash`;
      }
      await tx`INSERT INTO memberships (user_id, company_id, role) VALUES (${u.id}, ${inv.company_id}, ${inv.role}) ON CONFLICT DO NOTHING`;
      if (inv.employee_id) await tx`UPDATE employees SET user_id = ${u.id} WHERE id = ${inv.employee_id} AND company_id = ${inv.company_id} AND user_id IS NULL`;
      await tx`UPDATE invites SET accepted_at = now() WHERE id = ${inv.id}`;
      await audit(tx, { companyId: inv.company_id, userId: u.id, action: 'accept_invite', entity: 'membership', details: { role: inv.role } });
      return u.id;
    });
    next = await startLogin(userId);
  });
  done(next);
}

export async function logout() {
  await destroySession();
  done('/login');
}
