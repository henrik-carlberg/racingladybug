// @nämn i kommentarer (rena funktioner)

const norm = (s: string) => s.toLocaleLowerCase('sv-SE');

/**
 * Vilka personer nämns? "@Förnamn Efternamn" eller "@Förnamn" (om förnamnet är unikt bland de som kan nämnas).
 * Längsta namnet matchas först så att "@Anna Berg" inte också ger "@Anna".
 */
export function findMentions(body: string, people: { id: number; name: string }[]): number[] {
  const text = norm(body);
  const found = new Set<number>();
  const firstCount = new Map<string, number>();
  for (const p of people) { const f = norm(p.name.split(/\s+/)[0] ?? ''); firstCount.set(f, (firstCount.get(f) ?? 0) + 1); }
  const candidates = people.flatMap((p) => {
    const full = norm(p.name.trim());
    const first = norm(p.name.trim().split(/\s+/)[0] ?? '');
    return [{ id: p.id, key: full }, ...(first && first !== full && firstCount.get(first) === 1 ? [{ id: p.id, key: first }] : [])];
  }).filter((c) => c.key.length >= 2).sort((a, b) => b.key.length - a.key.length);
  let rest = text;
  for (const c of candidates) {
    const re = new RegExp(`(^|[^\\p{L}\\p{N}])@${c.key.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}(?![\\p{L}\\p{N}])`, 'u');
    if (re.test(rest)) { found.add(c.id); rest = rest.replace(re, '$1'); }
  }
  return [...found];
}
