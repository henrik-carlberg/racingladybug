import { requireUser } from '@/lib/server/auth';
import { exportUserData } from '@/lib/services/gdpr';
import { audit } from '@/lib/server/audit';
import { sql } from '@/lib/db';

export const dynamic = 'force-dynamic';

/** Mina personuppgifter som JSON (registerutdrag och dataportabilitet) */
export async function GET() {
  const user = await requireUser();
  const data = await exportUserData(user.id);
  await audit(sql, { companyId: null, userId: user.id, action: 'export_personal_data', entity: 'user', entityId: user.id });
  return new Response(JSON.stringify(data, null, 2), {
    headers: { 'Content-Type': 'application/json; charset=utf-8', 'Content-Disposition': `attachment; filename="mina-uppgifter-${new Date().toISOString().slice(0, 10)}.json"`, 'Cache-Control': 'no-store' },
  });
}
