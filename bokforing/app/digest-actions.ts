'use server';
import { attempt, done, str } from '@/lib/server/action';
import { requireUser } from '@/lib/server/auth';
import { setDigest, setMonthlyReport } from '@/lib/services/digest';

export async function saveDigest(fd: FormData) {
  const user = await requireUser();
  const v = str(fd, 'digest');
  await attempt('/konto', async () => { await setDigest(user.id, v === 'daily' || v === 'off' ? v : 'weekly'); await setMonthlyReport(user.id, fd.get('monthly_report') === 'on'); });
  done('/konto', 'Inställningen är sparad');
}
