// Sanktionslistekontroll: namnmatchning som tål felstavning, omvänd ordning och bolagsformer
const SUFFIX = new Set(['ab', 'aktiebolag', 'hb', 'kb', 'ltd', 'limited', 'llc', 'inc', 'corp', 'co', 'gmbh', 'oy', 'as', 'asa', 'sa', 'srl', 'bv', 'nv', 'plc', 'ooo', 'zao', 'oao', 'pjsc', 'jsc', 'company', 'the']);
export function normalize(name: string) {
  const s = name.normalize('NFKD').replace(/[̀-ͯ]/g, '').toLowerCase().replace(/[^\p{L}\p{N}\s]/gu, ' ');
  const t = s.split(/\s+/).filter(Boolean);
  // Bolagsformer tas bort i slutet av namnet (inte förnamn som Åsa eller ord mitt i namnet)
  while (t.length > 1 && SUFFIX.has(t[t.length - 1])) t.pop();
  if (t.length > 1 && t[0] === 'the') t.shift();
  return t.sort().join(' ');
}
export function similarity(a: string, b: string) {
  if (a === b) return 1;
  const m = a.length, n = b.length;
  if (!m || !n) return 0;
  let prev = Array.from({ length: n + 1 }, (_, j) => j);
  for (let i = 1; i <= m; i++) {
    const cur = [i];
    for (let j = 1; j <= n; j++) cur[j] = Math.min(prev[j] + 1, cur[j - 1] + 1, prev[j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1));
    prev = cur;
  }
  return 1 - prev[n] / Math.max(m, n);
}
export const THRESHOLD = 0.85;
/** Träff: likhet över tröskeln på tokensorterade namn, eller alla ord i ett namn med minst två ord ingår i det andra */
export function match(party: string, entry: string) {
  if (!party || !entry) return 0;
  const sim = similarity(party, entry);
  if (sim >= THRESHOLD) return Math.round(sim * 100);
  const pt = party.split(' '), et = new Set(entry.split(' '));
  if (pt.length >= 2 && pt.every((t) => et.has(t))) return 90;
  return 0;
}
/** Kandidater via ordprefix, så att varje namn inte jämförs med hela listan */
export function buildIndex(entries: { id: number; normalized: string }[]) {
  const idx = new Map<string, number[]>();
  for (const e of entries) for (const t of new Set(e.normalized.split(' '))) { const k = t.slice(0, 3); if (k.length < 2) continue; idx.set(k, [...(idx.get(k) ?? []), e.id]); }
  return idx;
}
/** Namn ur en CSV: kolumnen med "wholename" eller "name" i rubriken (EU:s konsoliderade lista), annars första kolumnen */
export function namesFromCsv(text: string) {
  const lines = text.replace(/^﻿/, '').split(/\r?\n/).filter((l) => l.trim());
  if (!lines.length) return [];
  const sep = (lines[0].match(/;/g)?.length ?? 0) > (lines[0].match(/,/g)?.length ?? 0) ? ';' : ',';
  const split = (l: string) => { const out: string[] = []; let cur = '', q = false; for (const ch of l) { if (ch === '"') q = !q; else if (ch === sep && !q) { out.push(cur); cur = ''; } else cur += ch; } out.push(cur); return out.map((x) => x.trim()); };
  const head = split(lines[0]).map((h) => h.toLowerCase());
  let col = head.findIndex((h) => h.includes('wholename'));
  if (col < 0) col = head.findIndex((h) => h === 'name' || h === 'namn' || h.endsWith('name'));
  const rows = col >= 0 ? lines.slice(1) : lines;
  const c = col >= 0 ? col : 0;
  return [...new Set(rows.map((l) => split(l)[c] ?? '').map((n) => n.replace(/\s+/g, ' ').trim()).filter((n) => n.length >= 3))];
}
