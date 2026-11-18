'use server';
import { sql } from '@/lib/db';
import { attempt, done } from '@/lib/server/action';
import { requireCompany } from '@/lib/server/auth';
import { stamp } from '@/lib/services/staff';

/** Anställd stämplar in/ut själv på en arbetsplats */
export async function selfStamp(cid: number, siteId: number) {
  const ctx = await requireCompany(cid, { employee: true });
  const back = `/c/${cid}/mitt/schema`;
  let msg = '';
  await attempt(back, async () => {
    if (!ctx.employeeId) throw new Error('Ditt konto är inte kopplat till en anställd');
    const [e] = await sql<{ pnr: string }[]>`SELECT personal_number AS pnr FROM employees WHERE id = ${ctx.employeeId}`;
    const r = await stamp(ctx.company.id, siteId, { personalNumber: e.pnr }, 'self', ctx.user.id);
    msg = r.action === 'in' ? 'Du är instämplad' : 'Du är utstämplad';
  });
  done(back, msg);
}
