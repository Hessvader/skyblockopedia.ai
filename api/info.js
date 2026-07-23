// Info commands for Skyblockopedia — mirrors SkyHelper's non-player INFO commands.
// GET /api/info?cmd=<fetchur|time|kat|status|playercount>&arg=<...>

import { fetchurToday } from "./_gamedata.js";

const HYPIXEL = "https://api.hypixel.net/v2";

// SkyBlock time constants.
const SB_EPOCH = 1560275700000; // start of SkyBlock Year 1
const MS_DAY = 1200000;         // 20 real minutes
const MS_MONTH = 31 * MS_DAY;
const MS_YEAR = 12 * MS_MONTH;
const SEASONS = ["Early Spring", "Spring", "Late Spring", "Early Summer", "Summer", "Late Summer", "Early Autumn", "Autumn", "Late Autumn", "Early Winter", "Winter", "Late Winter"];

// Kat pet upgrade cost/time by target rarity (coins + wait time). Pet-specific item
// costs vary; this is the coins/time backbone SkyHelper shows.
const KAT = [
  { to: "Uncommon", coins: 5000, time: "12 hours" },
  { to: "Rare", coins: 100000, time: "1 day" },
  { to: "Epic", coins: 1000000, time: "2 days 20 hours" },
  { to: "Legendary", coins: 10000000, time: "6 days 5 hours" },
];

async function resolveUuid(name) {
  try { const r = await fetch("https://api.mojang.com/users/profiles/minecraft/" + encodeURIComponent(name)); if (r.ok) { const d = await r.json(); if (d && d.id) return { uuid: d.id, name: d.name || name }; } } catch (e) {}
  try { const r = await fetch("https://api.ashcon.app/mojang/v2/user/" + encodeURIComponent(name)); if (r.ok) { const d = await r.json(); if (d && d.uuid) return { uuid: d.uuid.replace(/-/g, ""), name: d.username || name }; } } catch (e) {}
  return null;
}

function skyblockDate() {
  const elapsed = Date.now() - SB_EPOCH;
  const year = Math.floor(elapsed / MS_YEAR) + 1;
  const intoYear = elapsed % MS_YEAR;
  const monthIdx = Math.floor(intoYear / MS_MONTH);
  const intoMonth = intoYear % MS_MONTH;
  const day = Math.floor(intoMonth / MS_DAY) + 1;
  return { year, season: SEASONS[monthIdx], day };
}

export default async function handler(req, res) {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Headers", "content-type");
  if (req.method === "OPTIONS") return res.status(200).end();

  const cmd = String((req.query && req.query.cmd) || "").trim().toLowerCase();
  const arg = String((req.query && req.query.arg) || "").trim();
  const key = process.env.HYPIXEL_API_KEY;

  try {
    if (cmd === "fetchur") {
      const day = new Date().getUTCDate();
      return res.status(200).json({ cmd, item: fetchurToday(day), note: "Fetchur wants a new item each day. He's in the Mountain (Hub)." });
    }

    if (cmd === "time" || cmd === "events") {
      const d = skyblockDate();
      return res.status(200).json({
        cmd: "time",
        skyblockDate: `${d.season} ${d.day}, Year ${d.year}`,
        year: d.year, season: d.season, day: d.day,
        recurring: [
          "Dark Auction — every real hour (at :55)",
          "Jacob's Farming Contest — every ~2.6 real hours (3 SkyBlock days)",
          "Traveling Zoo — 1st of Spring & Autumn",
          "Spooky Festival — Autumn 29 (Year event)",
          "Season of Jerry / Jerry's Workshop — Late Winter (December)",
        ],
      });
    }

    if (cmd === "kat") {
      return res.status(200).json({ cmd, upgrades: KAT, note: "Kat (Hub) upgrades a pet's rarity. Higher-rarity upgrades also need a specific item that varies per pet." });
    }

    if (cmd === "status") {
      if (!key) return res.status(503).json({ error: "Status isn't set up yet (missing Hypixel API key)." });
      if (!/^[a-zA-Z0-9_]{1,16}$/.test(arg)) return res.status(400).json({ error: "Enter a valid Minecraft username." });
      const who = await resolveUuid(arg);
      if (!who) return res.status(404).json({ error: "Couldn't find a player named \"" + arg + "\"." });
      const r = await fetch(HYPIXEL + "/status?uuid=" + who.uuid, { headers: { "API-Key": key } });
      if (r.status === 403) return res.status(502).json({ error: "The Hypixel API key is invalid or expired." });
      if (!r.ok) return res.status(502).json({ error: "Hypixel API error (" + r.status + ")." });
      const d = await r.json();
      const s = d.session || {};
      return res.status(200).json({ cmd, name: who.name, online: !!s.online, game: s.gameType ? String(s.gameType) : null, mode: s.mode || null });
    }

    if (cmd === "playercount" || cmd === "sbplayercount") {
      let url = "https://api.hypixel.net/v2/counts";
      let r = await fetch(url, { headers: key ? { "API-Key": key } : {} });
      if (!r.ok) { r = await fetch("https://api.hypixel.net/counts", { headers: key ? { "API-Key": key } : {} }); }
      if (!r.ok) return res.status(502).json({ error: "Couldn't fetch player counts right now." });
      const d = await r.json();
      const sb = (d.games && d.games.SKYBLOCK) || {};
      return res.status(200).json({ cmd: "playercount", skyblockPlayers: sb.players || 0, totalPlayers: d.playerCount || null });
    }

    return res.status(400).json({ error: "Unknown info command." });
  } catch (e) {
    return res.status(502).json({ error: "Couldn't run that right now. Please try again." });
  }
}
