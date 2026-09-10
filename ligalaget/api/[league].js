// GET /api/allsvenskan.json  |  GET /api/shl.json
//
// Serverless-funktion på Vercel som levererar liga-data till fronten.
// 1. Om DATA_PROVIDER_URL + DATA_PROVIDER_KEY är satta som miljövariabler
//    hämtas färsk data från leverantören, mappas till appens schema och
//    cachas på Vercels edge (s-maxage) – 30 s under matchtid, 5 min annars.
// 2. Annars (eller om leverantören svarar fel) returneras snapshot från /data.
//
// Appens schema är det som ligger i data/*.json. Byt bara ut `mapProvider`
// när du kopplar en leverantör – fronten behöver inte ändras.

import { readFile } from "node:fs/promises";
import path from "node:path";

const LEAGUES = new Set(["allsvenskan", "shl"]);

export default async function handler(req, res) {
  const league = String(req.query.league || "").replace(/\.json$/, "");
  if (!LEAGUES.has(league)) {
    res.status(404).json({ error: "Okänd liga. Använd allsvenskan eller shl." });
    return;
  }

  const snapshot = JSON.parse(
    await readFile(path.join(process.cwd(), "data", `${league}.json`), "utf8")
  );

  let payload = snapshot;
  let source = "snapshot";

  if (process.env.DATA_PROVIDER_URL && process.env.DATA_PROVIDER_KEY) {
    try {
      payload = await fetchFromProvider(league, snapshot);
      source = "provider";
    } catch (err) {
      console.error(`Provider misslyckades för ${league}:`, err.message);
    }
  }

  const live = isMatchWindow(payload);
  res.setHeader("Content-Type", "application/json; charset=utf-8");
  res.setHeader(
    "Cache-Control",
    live ? "s-maxage=30, stale-while-revalidate=30" : "s-maxage=300, stale-while-revalidate=600"
  );
  res.setHeader("X-Data-Source", source);
  res.status(200).json(payload);
}

/** Hämtar från leverantören och mappar till appens schema. */
async function fetchFromProvider(league, snapshot) {
  const url = `${process.env.DATA_PROVIDER_URL}/${league}`;
  const r = await fetch(url, {
    headers: { "x-api-key": process.env.DATA_PROVIDER_KEY },
    signal: AbortSignal.timeout(8000),
  });
  if (!r.ok) throw new Error(`HTTP ${r.status}`);
  const raw = await r.json();
  return mapProvider(league, raw, snapshot);
}

/**
 * Anpassa denna till vald leverantör (API-Football, api-hockey, Sportradar,
 * SHL:s API …). Returnera ett objekt med samma fält som data/<liga>.json:
 * name, season, sport, asOf, columns, zones, teams, standings, scorers,
 * results, fixtures. Fält som leverantören saknar tas från snapshot.
 */
function mapProvider(league, raw, snapshot) {
  return {
    ...snapshot,
    asOf: new Date().toISOString().slice(0, 10),
    sourceNote: "Data uppdateras löpande.",
    // standings: raw.standings.map(t => [t.name, t.played, t.won, t.drawn, t.lost, t.gf, t.ga]),
    // scorers:   raw.scorers.map(s => [s.name, s.team, s.goals]),
    // results:   { label: raw.lastRound, example: false, matches: [...] },
    // fixtures:  { label: raw.nextRound, example: false, matches: [...] },
  };
}

/** Kortare cache om någon match pågår just nu (± 3 timmar runt avspark). */
function isMatchWindow(data) {
  const now = Date.now();
  const all = [...(data.fixtures?.matches || []), ...(data.results?.matches || [])];
  return all.some((m) => Math.abs(new Date(m[0]).getTime() - now) < 3 * 3600e3);
}
