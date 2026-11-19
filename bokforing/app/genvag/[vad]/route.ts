import { redirect } from 'next/navigation';
import { sql } from '@/lib/db';
import { currentUser } from '@/lib/server/auth';

const TARGET: Record<string, string> = { kvitto: '/kvitto', faktura: '/leverantorsfakturor/inkorg', oversikt: '' };

/** Genvägar från appikonen: öppnar sidan i det bolag användaren senast arbetade i */
export async function GET(_req: Request, { params }: { params: Promise<{ vad: string }> }) {
  const { vad } = await params;
  const user = await currentUser();
  if (!user) redirect('/login');
  if (!(vad in TARGET)) redirect('/');
  const [c] = await sql<{ id: number }[]>`
    SELECT m.company_id AS id FROM memberships m LEFT JOIN LATERAL (SELECT max(last_at) AS at FROM user_usage u WHERE u.user_id = m.user_id AND u.company_id = m.company_id) x ON true
    WHERE m.user_id = ${user.id} AND m.role <> 'employee' ORDER BY x.at DESC NULLS LAST, m.company_id LIMIT 1`;
  redirect(c ? `/c/${c.id}${TARGET[vad]}` : '/');
}
