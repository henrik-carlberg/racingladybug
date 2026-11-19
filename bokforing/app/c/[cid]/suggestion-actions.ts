'use server';
import { revalidatePath } from 'next/cache';
import { requireCompany } from '@/lib/server/auth';
import { dismissSuggestion } from '@/lib/services/patterns';

/** "Inte nu": förslaget visas inte igen för den här månaden */
export async function dismiss(cid: number, key: string) {
  const { company, user } = await requireCompany(cid);
  await dismissSuggestion(company.id, user.id, key);
  revalidatePath(`/c/${company.id}`);
}
