// Missing talismans/accessories endpoint for Skyblockopedia.
// GET /api/missing?user=<IGN>  ->  { name, profile, missing:[{id,name,rarity,price}], upgrades:[...], totalCost }
// Mirrors the SkyHelper Discord bot's `missing` command: finds accessories the player
// doesn't own (accounting for upgrade families + duplicates) and prices the cheapest.

import TALISMANS from "./_talismans.js";
import { MP_BY_RARITY } from "./_gamedata.js";

// Magic power gained by recombobulating an accessory of a given base rarity (+1 tier).
// legendary->mythic excluded (only a handful of accessories support it).
const RECOMB_DELTA = { COMMON: 2, UNCOMMON: 3, RARE: 4, EPIC: 4 };
const RECOMB_RARITIES = ["COMMON", "UNCOMMON", "RARE", "EPIC"];

// skyhelper-networth writes an items cache to its own (read-only on Vercel) folder.
// Redirect that write to /tmp so item fetching succeeds.
import fs from "fs";
if (!fs.__nwPatched) {
  const _origWrite = fs.writeFileSync;
  fs.writeFileSync = function (p, ...args) {
    try {
      if (typeof p === "string" && p.indexOf(".itemsBackup.json") >= 0) return _origWrite.call(fs, "/tmp/.itemsBackup.json", ...args);
      return _origWrite.call(fs, p, ...args);
    } catch (e) {
      if (typeof p === "string" && p.indexOf(".itemsBackup.json") >= 0) return;
      throw e;
    }
  };
  fs.__nwPatched = true;
}

const HYPIXEL = "https://api.hypixel.net/v2";

async function resolveUuid(name) {
  try {
    const r = await fetch("https://api.mojang.com/users/profiles/minecraft/" + encodeURIComponent(name));
    if (r.ok) { const d = await r.json(); if (d && d.id) return { uuid: d.id, name: d.name || name }; }
  } catch (e) {}
  try {
    const r = await fetch("https://api.ashcon.app/mojang/v2/user/" + encodeURIComponent(name));
    if (r.ok) { const d = await r.json(); if (d && d.uuid) return { uuid: d.uuid.replace(/-/g, ""), name: d.username || name }; }
  } catch (e) {}
  return null;
}

// SkyHelper's missing-talisman algorithm (credit: SkyCrypt / Altpapier).
function getMissing(ownedInput, option) {
  const talismans = ownedInput.slice();
  let unique = Object.keys(option === "max" ? TALISMANS.max_upgrade_talismans : TALISMANS.talismans);

  // Fold duplicates onto their canonical id.
  unique.forEach((name) => {
    if (name in TALISMANS.talisman_duplicates) {
      for (const dup of TALISMANS.talisman_duplicates[name]) {
        const idx = talismans.indexOf(dup);
        if (idx >= 0) { talismans[idx] = name; break; }
      }
    }
  });

  let missing = unique.filter((t) => !talismans.includes(t));
  // Drop any talisman the player has already upgraded past.
  missing = missing.filter((name) => {
    if (name in TALISMANS.talisman_upgrades) {
      for (const up of TALISMANS.talisman_upgrades[name]) if (talismans.includes(up)) return false;
    }
    return true;
  });

  const src = option === "max" ? TALISMANS.max_upgrade_talismans : TALISMANS.talismans;
  return missing.map((id) => ({ id, name: (src[id] && src[id].name) || id, rarity: (src[id] && src[id].rarity) || null }));
}

export default async function handler(req, res) {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Headers", "content-type");
  if (req.method === "OPTIONS") return res.status(200).end();

  const key = process.env.HYPIXEL_API_KEY;
  if (!key) return res.status(503).json({ error: "This isn't set up yet (missing Hypixel API key)." });

  const user = String((req.query && req.query.user) || "").trim();
  if (!/^[a-zA-Z0-9_]{1,16}$/.test(user)) return res.status(400).json({ error: "Enter a valid Minecraft username." });

  try {
    const who = await resolveUuid(user);
    if (!who) return res.status(404).json({ error: "Couldn't find a Minecraft player named \"" + user + "\"." });

    const pr = await fetch(HYPIXEL + "/skyblock/profiles?uuid=" + who.uuid, { headers: { "API-Key": key } });
    if (pr.status === 403) return res.status(502).json({ error: "The Hypixel API key is invalid or expired." });
    if (!pr.ok) return res.status(502).json({ error: "Hypixel API error (" + pr.status + ")." });
    const pd = await pr.json();
    if (!pd.profiles || !pd.profiles.length) return res.status(404).json({ error: who.name + " has no SkyBlock profiles, or has them set to private." });

    const profile = pd.profiles.find((p) => p.selected) || pd.profiles[0];
    const member = profile.members && profile.members[who.uuid];
    if (!member) return res.status(404).json({ error: "No SkyBlock data found for " + who.name + "." });

    const _nw = await import("skyhelper-networth");
    const ProfileNetworthCalculator = _nw.ProfileNetworthCalculator || (_nw.default && _nw.default.ProfileNetworthCalculator);
    const getPrices = _nw.getPrices || (_nw.default && _nw.default.getPrices);
    if (!ProfileNetworthCalculator) throw new Error("networth library did not load");

    const calc = new ProfileNetworthCalculator(member, null, (profile.banking && profile.banking.balance) || 0);
    const nw = await calc.getNetworth({ includeItemData: true });

    if (nw.noInventory) return res.status(409).json({ error: who.name + " has their inventory API turned off, so their accessories can't be read. Turn it on in SkyBlock Settings → API Settings." });

    const accessories = (nw.types && nw.types.accessories && nw.types.accessories.items) || [];
    const owned = accessories.map((i) => (i && i.id ? String(i.id).toUpperCase() : null)).filter(Boolean);

    // Count owned, NOT-yet-recombobulated accessories by base rarity (for recomb suggestions).
    const recombCounts = { COMMON: 0, UNCOMMON: 0, RARE: 0, EPIC: 0 };
    for (const it of accessories) {
      if (!it || !it.id) continue;
      const meta = TALISMANS.talismans[String(it.id).toUpperCase()];
      const rarity = meta && meta.rarity ? meta.rarity.toUpperCase() : null;
      if (!rarity || !(rarity in recombCounts)) continue;
      const raw = it.item || it.itemData || {};
      const ea = (raw && (raw.tag ? raw.tag.ExtraAttributes : raw.ExtraAttributes)) || {};
      const recombed = (ea.rarity_upgrades || 0) > 0;
      if (!recombed) recombCounts[rarity] += 1;
    }

    const missing = getMissing(owned, "");
    const upgrades = getMissing(owned, "max");

    let prices = {};
    try { prices = (await getPrices()) || {}; } catch (e) {}

    const priceOf = (id) => {
      const p = prices[id] ?? prices[String(id).toUpperCase()] ?? prices[String(id).toLowerCase()];
      return typeof p === "number" && p > 0 ? Math.round(p) : null;
    };
    const mpOf = (rarity) => MP_BY_RARITY[String(rarity || "").toUpperCase()] || 0;

    // Buyable missing accessories, valued by magic power per coin.
    const buyRecs = [];
    const unobtainable = [];
    for (const t of missing) {
      const price = priceOf(t.id);
      const mp = mpOf(t.rarity);
      if (price == null) { unobtainable.push({ id: t.id, name: t.name, rarity: t.rarity }); continue; }
      buyRecs.push({ kind: "buy", id: t.id, name: t.name, rarity: t.rarity, mp, price, coinsPerMp: mp > 0 ? price / mp : Infinity });
    }

    // Recombobulator suggestions, valued the same way.
    const recombPrice = priceOf("RECOMBOBULATOR_3000");
    const recombRecs = [];
    if (recombPrice) {
      for (const r of RECOMB_RARITIES) {
        const count = recombCounts[r];
        if (count > 0) {
          const delta = RECOMB_DELTA[r];
          recombRecs.push({ kind: "recomb", rarity: r.charAt(0) + r.slice(1).toLowerCase(), count, mp: delta, price: recombPrice, coinsPerMp: recombPrice / delta });
        }
      }
    }

    // Merge and order by cheapest magic power per coin (best value first).
    const recommendations = buyRecs.concat(recombRecs).sort((a, b) => a.coinsPerMp - b.coinsPerMp)
      .map((r) => ({ ...r, coinsPerMp: Math.round(r.coinsPerMp) }));

    const totalCost = buyRecs.reduce((s, t) => s + t.price, 0);

    return res.status(200).json({
      name: who.name,
      profile: profile.cute_name || null,
      missingCount: missing.length,
      recommendations,
      unobtainable,
      totalCost,
      upgradesCount: upgrades.length,
      tip: "Buy from the top down — those give the most Magic Power per coin. Recombobulating accessories you already own counts too, and is slotted in at its real value.",
    });
  } catch (e) {
    return res.status(502).json({ error: "Couldn't look up missing talismans right now. Please try again." });
  }
}
