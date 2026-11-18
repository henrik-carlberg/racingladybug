'use server';
import { redirect } from 'next/navigation';
import { siteByKiosk, stamp } from '@/lib/services/staff';
import { limit, LIMITS } from '@/lib/server/ratelimit';

/** Stämpling på arbetsplatsens surfplatta (ingen inloggning – adressen är hemlig) */
export async function kioskStamp(token: string, fd: FormData) {
  const site = await siteByKiosk(token);
  if (!site) redirect(`/p/${token}?fel=1`);
  let msg = '';
  try {
    await limit(`kiosk:${token}`, LIMITS.kiosk.max, LIMITS.kiosk.window);
    const r = await stamp(site.company_id, site.id, { personalNumber: String(fd.get('personal_number') ?? ''), name: String(fd.get('name') ?? '') }, 'kiosk', null);
    msg = `${r.name} – ${r.action === 'in' ? 'instämplad' : 'utstämplad'} ${new Date().toLocaleTimeString('sv-SE', { timeZone: 'Europe/Stockholm', hour: '2-digit', minute: '2-digit' })}`;
  } catch (e) {
    redirect(`/p/${token}?fel=${encodeURIComponent((e as Error).message)}`);
  }
  redirect(`/p/${token}?ok=${encodeURIComponent(msg)}`);
}
