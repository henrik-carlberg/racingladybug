import 'server-only';
import Anthropic from '@anthropic-ai/sdk';
import { sql } from '@/lib/db';
import { documentText } from '@/lib/doc-text';
import { invoiceAiEnabled } from './invoice-ai';

const MODEL = process.env.INVOICE_AI_MODEL || 'claude-opus-5-5';
const IMAGES = ['image/jpeg', 'image/png', 'image/webp', 'image/gif'];

/** Bilder: texten skrivs av med Claude (OCR) när det är påslaget */
async function ocr(mime: string, data: Buffer): Promise<string | null> {
  if (!invoiceAiEnabled() || !IMAGES.includes(mime) || data.length > 5_000_000) return null;
  const client = new Anthropic({ maxRetries: 1, timeout: 60_000 });
  const res = await client.messages.create({
    model: MODEL, max_tokens: 4000,
    messages: [{ role: 'user', content: [
      { type: 'image', source: { type: 'base64', media_type: mime as 'image/png', data: data.toString('base64') } },
      { type: 'text', text: 'Skriv av all text i bilden ordagrant, rad för rad, utan kommentarer. Finns ingen text: svara med ett tomt svar.' }] }],
  });
  const t = res.content.map((c) => (c.type === 'text' ? c.text : '')).join('\n').trim();
  return t.slice(0, 200_000);
}

/** Läser ut text ur ett underlag så att det blir sökbart */
export async function indexAttachment(id: number) {
  const [a] = await sql<{ mime_type: string; filename: string; data: Buffer }[]>`SELECT mime_type, filename, data FROM attachments WHERE id = ${id}`;
  if (!a) return;
  let text = documentText(a.mime_type, a.filename, a.data), source: 'pdf' | 'file' | 'ocr' | 'none' = text == null ? 'none' : a.mime_type === 'application/pdf' ? 'pdf' : 'file';
  if (text == null || (source === 'pdf' && text.length < 20)) {
    // Skannad PDF utan textlager eller bild
    const o = await ocr(a.mime_type, a.data).catch((e) => { console.error('ocr', id, e instanceof Error ? e.message : e); throw e; });
    if (o) { text = o; source = 'ocr'; }
  }
  await sql`UPDATE attachments SET text = ${text || null}, text_source = ${text ? source : 'none'}, text_at = now() WHERE id = ${id}`;
}

/** Nattlig körning: underlag som inte är indexerade (t.ex. från före sökningen) */
export async function indexPending(limit = 100) {
  const rows = await sql<{ id: number }[]>`SELECT id FROM attachments WHERE text_at IS NULL ORDER BY id DESC LIMIT ${limit}`;
  let n = 0;
  for (const r of rows) { try { await indexAttachment(r.id); n++; } catch { /* försöker igen nästa natt */ } }
  return n;
}
