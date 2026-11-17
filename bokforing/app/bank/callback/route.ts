import { redirect } from 'next/navigation';
import { currentUser } from '@/lib/server/auth';
import { completeConnection } from '@/lib/services/bank';

export const dynamic = 'force-dynamic';

/** Banken (via Enable Banking) skickar tillbaka användaren hit med ?code=…&state=… */
export async function GET(req: Request) {
  const url = new URL(req.url);
  const user = await currentUser();
  if (!user) redirect('/login');
  const state = url.searchParams.get('state') ?? '';
  let target = '/';
  try {
    const companyId = await completeConnection(user.id, state, url.searchParams.get('code'), url.searchParams.get('error_description') ?? url.searchParams.get('error'));
    target = `/c/${companyId}/bank?ok=${encodeURIComponent('Banken är kopplad och transaktioner har hämtats')}`;
  } catch (e) {
    target = `/?error=${encodeURIComponent(e instanceof Error ? e.message : 'Bankkopplingen misslyckades')}`;
  }
  redirect(target);
}
