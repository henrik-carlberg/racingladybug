// Integritetskontroll av bokföringen (ren logik)

/** Saknade nummer i en verifikationsserie (1..max), som intervall: "4", "7–9" */
export function sequenceGaps(numbers: number[]): string[] {
  const set = new Set(numbers);
  const max = Math.max(0, ...numbers);
  const out: string[] = [];
  let start: number | null = null;
  for (let n = 1; n <= max + 1; n++) {
    if (!set.has(n) && n <= max) { if (start === null) start = n; }
    else if (start !== null) { out.push(start === n - 1 ? String(start) : `${start}–${n - 1}`); start = null; }
  }
  return out;
}

export interface Issue { key: string; severity: 'error' | 'warn'; title: string; detail: string; href?: string }
