// Ändringshistorik – ren logik (testbar)
/** Ändrade fält som { fält: [före, efter] } – för ändringshistoriken */
export function changes(before: Record<string, unknown>, after: Record<string, unknown>): Record<string, [unknown, unknown]> {
  const out: Record<string, [unknown, unknown]> = {};
  for (const k of Object.keys(after)) {
    const norm = (v: unknown) => (v === '' || v === undefined ? null : v);
    const a = norm(before[k]), b = norm(after[k]);
    if (String(a) !== String(b)) out[k] = [a, b];
  }
  return out;
}
