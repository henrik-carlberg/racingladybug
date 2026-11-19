import 'server-only';
import { after } from 'next/server';

/** Kör efter att svaret har skickats (och transaktionen är klar); utanför en request körs det direkt i bakgrunden */
export function later(fn: () => Promise<unknown>, label = 'bakgrundsjobb') {
  const run = () => fn().catch((e) => console.error(label, e));
  try { after(run); } catch { void run(); }
}
