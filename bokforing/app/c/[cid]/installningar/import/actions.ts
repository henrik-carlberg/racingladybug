'use server';
import { requireCompany } from '@/lib/server/auth';
import { userActor } from '@/lib/services/actor';
import * as svc from '@/lib/services/csv-import';
import type { ImportKind, ImportPreview } from '@/lib/csv-import';

const MAX = 5 * 1024 * 1024;

export async function previewCsv(cid: number, kind: ImportKind, text: string): Promise<{ preview?: ImportPreview; error?: string }> {
  const actor = userActor(await requireCompany(cid));
  if (text.length > MAX) return { error: 'Filen är för stor (max 5 MB)' };
  try {
    const p = await svc.preview(actor, kind, text);
    return { preview: { ...p, rows: p.rows.slice(0, 200) } };
  } catch (e) { return { error: e instanceof Error ? e.message : 'Filen kunde inte läsas' }; }
}

export async function commitCsv(cid: number, kind: ImportKind, text: string): Promise<{ result?: { created: number; skipped: number; related: number }; error?: string }> {
  const actor = userActor(await requireCompany(cid));
  if (text.length > MAX) return { error: 'Filen är för stor (max 5 MB)' };
  try { return { result: await svc.commit(actor, kind, text) }; } catch (e) { return { error: e instanceof Error ? e.message : 'Importen misslyckades' }; }
}
