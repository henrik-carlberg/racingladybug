'use server';
import { attempt, done, str } from '@/lib/server/action';
import { requireUser, setLangCookie } from '@/lib/server/auth';
import { sql } from '@/lib/db';
import { setDigest, setMonthlyReport } from '@/lib/services/digest';

export async function saveDigest(fd: FormData) {
  const user = await requireUser();
  const v = str(fd, 'digest');
  await attempt('/konto', async () => { await setDigest(user.id, v === 'daily' || v === 'off' ? v : 'weekly'); await setMonthlyReport(user.id, fd.get('monthly_report') === 'on'); });
  done('/konto', 'Inställningen är sparad');
}

export async function saveLanguage(fd: FormData) {
  const user = await requireUser();
  const lang = str(fd, 'locale') === 'en' ? 'en' : 'sv';
  await sql`UPDATE users SET locale = ${lang} WHERE id = ${user.id}`;
  await setLangCookie(lang);
  done('/konto', lang === 'en' ? 'The setting has been saved' : 'Inställningen är sparad');
}
