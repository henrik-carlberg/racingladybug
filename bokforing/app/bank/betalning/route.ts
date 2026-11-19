import { redirect } from 'next/navigation';
import { currentUser } from '@/lib/server/auth';
import { completeAuthorization } from '@/lib/services/bankpay';

export const dynamic = 'force-dynamic';

const MSG: Record<string, string> = { executed: 'Betalningen är genomförd och bokförd', accepted: 'Betalningen är godkänd i banken – den bokförs när banken har genomfört den', authorization: 'Betalningen väntar på godkännande i banken', rejected: 'Betalningen avbröts eller avvisades i banken' };

/** Banken skickar tillbaka användaren hit efter att betalningen har godkänts (eller avbrutits) med BankID */
export async function GET(req: Request) {
  const url = new URL(req.url);
  const user = await currentUser();
  if (!user) redirect('/login');
  let target = '/';
  try {
    const r = await completeAuthorization(user.id, url.searchParams.get('state') ?? '', url.searchParams.get('error_description') ?? url.searchParams.get('error'));
    target = `${r.back}?${r.status === 'rejected' ? 'error' : 'ok'}=${encodeURIComponent(MSG[r.status ?? 'authorization'] ?? 'Klart')}`;
  } catch (e) {
    target = `/?error=${encodeURIComponent(e instanceof Error ? e.message : 'Betalningen misslyckades')}`;
  }
  redirect(target);
}
