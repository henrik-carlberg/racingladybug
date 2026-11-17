'use server';
import { redirect } from 'next/navigation';
import { str } from '@/lib/server/action';
import { clientInfo } from '@/lib/server/origin';
import { declineWithLink, signWithLink } from '@/lib/services/documents';

export async function sign(token: string, fd: FormData) {
  let err = '';
  try {
    await signWithLink(token, { signed_name: str(fd, 'signed_name'), consent: fd.get('consent') === 'on' }, await clientInfo());
  } catch (e) { err = e instanceof Error ? e.message : 'Något gick fel'; }
  redirect(`/sign/${token}${err ? `?error=${encodeURIComponent(err)}` : ''}`);
}

export async function decline(token: string, fd: FormData) {
  let err = '';
  try { await declineWithLink(token, str(fd, 'reason'), await clientInfo()); } catch (e) { err = e instanceof Error ? e.message : 'Något gick fel'; }
  redirect(`/sign/${token}${err ? `?error=${encodeURIComponent(err)}` : ''}`);
}
