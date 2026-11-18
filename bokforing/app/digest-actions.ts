'use server';
import { attempt, done, str } from '@/lib/server/action';
import { requireUser } from '@/lib/server/auth';
import { setDigest } from '@/lib/services/digest';

export async function saveDigest(fd: FormData) {
  const user = await requireUser();
  const v = str(fd, 'digest');
  await attempt('/konto', () => setDigest(user.id, v === 'daily' || v === 'off' ? v : 'weekly'));
  done('/konto', 'Inställningen är sparad');
}
