'use server';
import { attempt, done } from '@/lib/server/action';
import { requireUser } from '@/lib/server/auth';
import { endMySession } from '@/lib/services/company-login';

export async function endSession(ref: string) {
  const user = await requireUser();
  await attempt('/konto/sessioner', () => endMySession(user.id, ref));
  done('/konto/sessioner', 'Sessionen är utloggad');
}
