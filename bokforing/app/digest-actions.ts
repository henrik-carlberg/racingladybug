'use server';
import { attempt, done, str } from '@/lib/server/action';
import { requireUser, setLangCookie } from '@/lib/server/auth';
import { sql } from '@/lib/db';
import { setDigest, setMonthlyReport } from '@/lib/services/digest';
import { forgetUsage, setLearnUsage } from '@/lib/services/usage';
import { sendToUsers, setPushPrefs } from '@/lib/services/push';
import { PUSH_KINDS } from '@/lib/push';

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

export async function saveLearning(fd: FormData) {
  const user = await requireUser();
  await setLearnUsage(user.id, fd.get('learn') === 'on');
  done('/konto#anpassning', 'Inställningen är sparad');
}

export async function forgetLearning() {
  const user = await requireUser();
  await forgetUsage(user.id);
  done('/konto#anpassning', 'Det som appen har lärt sig är borttaget');
}

export async function savePushPrefs(fd: FormData) {
  const user = await requireUser();
  await setPushPrefs(user.id, Object.keys(PUSH_KINDS).filter((k) => fd.get(k) === 'on'));
  done('/konto#notiser', 'Inställningen är sparad');
}

export async function sendTestPush() {
  const user = await requireUser();
  const n = await sendToUsers([user.id], 'test', { title: 'Testnotis', body: 'Notiserna fungerar på den här enheten.', url: '/konto#notiser' });
  done('/konto#notiser', n ? `Testnotisen skickades till ${n} ${n === 1 ? 'enhet' : 'enheter'}` : 'Ingen enhet tog emot notisen – slå på notiser först');
}
