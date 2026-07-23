// Missing accessories endpoint for Skyblockopedia — SkyHelper-style /missing.
// GET /api/missing?user=<IGN>
// - Upgrade families + accessory rarities are fetched at runtime (NEU + Hypixel items),
//   with a hardcoded fallback, so newer accessories/upgrades stay current.
// - Recommends only the TOP tier of each missing family, shows the Magic Power GAIN,
//   interleaves recombobulator suggestions, and orders by cheapest MP per coin.

import TALISMANS from "./_talismans.js";
import { MP_BY_RARITY } from "./_gamedata.js";

import fs from "fs";
if (!fs.__nwPatched) {
  const _origWrite = fs.writeFileSync;
  fs.writeFileSync = function (p, ...args) {
    try {
      if (typeof p === "string" && p.indexOf(".itemsBackup.json") >= 0) return _origWrite.call(fs, "/tmp/.itemsBackup.json", ...args);
      return _origWrite.call(fs, p, ...args);
    } catch (e) { if (typeof p === "string" && p.indexOf(".itemsBackup.json") >= 0) return; throw e; }
  };
  fs.__nwPatched = true;
}

const HYPIXEL = "https://api.hypixel.net/v2";
const RECOMB_DELTA = { COMMON: 2, UNCOMMON: 3, RARE: 4, EPIC: 4 };
const RECOMB_RARITIES = ["COMMON", "UNCOMMON", "RARE", "EPIC"];

// ---- Cached runtime data (persists across warm invocations) ----
let _fam = null, _famAt = 0;
async function loadFamilies() {
  if (_fam && Date.now() - _famAt < 6 * 3600 * 1000) return _fam;
  try {
    const r = await fetch("https://cdn.jsdelivr.net/gh/NotEnoughUpdates/NotEnoughUpdates-REPO@master/constants/misc.json");
    if (r.ok) {
      const j = await r.json();
      if (j && j.talisman_upgrades) {
        _fam = { upgrades: j.talisman_upgrades || {}, duplicates: j.talisman_duplicates || {} };
        _famAt = Date.now();
        return _fam;
      }
    }
  } catch (e) {}
  _fam = { upgrades: TALISMANS.talisman_upgrades || {}, duplicates: TALISMANS.talisman_duplicates || {} };
  _famAt = Date.now();
  return _fam;
}

let _acc = null, _accAt = 0;
async function loadAccessories() {
  if (_acc && Date.now() - _accAt < 6 * 3600 * 1000) return _acc;
  const map = {};
  try {
    const r = await fetch(HYPIXEL + "/resources/skyblock/items");
    if (r.ok) {
      const j = await r.json();
      for (const it of (j.items || [])) {
        if (it && it.category === "ACCESSORY" && it.id) map[String(it.id).toUpperCase()] = { name: it.name || it.id, rarity: String(it.tier || "COMMON").toUpperCase() };
      }
    }
  } catch (e) {}
  // Merge hardcoded fallback (fills any gaps / offline).
  for (const id of Object.keys(TALISMANS.talismans)) {
    if (!map[id]) map[id] = { name: TALISMANS.talismans[id].name, rarity: String(TALISMANS.talismans[id].rarity).toUpperCase() };
  }
  if (Object.keys(map).length) { _acc = map; _accAt = Date.now(); }
  return _acc || map;
}

function titleCaseRarity(r) { r = String(r || "").toLowerCase(); return r.charAt(0).toUpperCase() + r.slice(1); }
function mpFor(id, rarity) { const base = MP_BY_RARITY[String(rarity).toUpperCase()] || 0; return id === "HEGEMONY_ARTIFACT" ? base * 2 : base; }

async function resolveUuid(name) {
  try { const r = await fetch("https://api.mojang.com/users/profiles/minecraft/" + encodeURIComponent(name)); if (r.ok) { const d = await r.json(); if (d && d.id) return { uuid: d.id, name: d.name || name }; } } catch (e) {}
  try { const r = await fetch("https://api.ashcon.app/mojang/v2/user/" + encodeURIComponent(name)); if (r.ok) { const d = await r.json(); if (d && d.uuid) return { uuid: d.uuid.replace(/-/g, ""), name: d.username || name }; } } catch (e) {}
  return null;
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
    const calc = new ProfileNetworthCalculator(member, null, (profile.banking && profile.banking.balance) || 0);
    const nw = await calc.getNetworth({ includeItemData: true });
    if (nw.noInventory) return res.status(409).json({ error: who.name + " has their inventory API turned off, so their accessories can't be read. Turn it on in SkyBlock Settings → API Settings." });

    const [{ upgrades, duplicates }, accData, pricesRaw] = await Promise.all([loadFamilies(), loadAccessories(), getPrices().catch(() => ({}))]);
    const prices = pricesRaw || {};
    const priceOf = (id) => { const p = prices[id] ?? prices[String(id).toUpperCase()]; return typeof p === "number" && p > 0 ? Math.round(p) : null; };

    // Owned accessories: id + recomb status.
    const accessories = (nw.types && nw.types.accessories && nw.types.accessories.items) || [];
    const owned = new Set();
    const recombCounts = { COMMON: 0, UNCOMMON: 0, RARE: 0, EPIC: 0 };
    for (const it of accessories) {
      if (!it || !it.id) continue;
      const id = String(it.id).toUpperCase();
      owned.add(id);
      const meta = accData[id];
      const rarity = meta ? meta.rarity : null;
      if (rarity && rarity in recombCounts) {
        const raw = it.item || it.itemData || {};
        const ea = (raw && (raw.tag ? raw.tag.ExtraAttributes : raw.ExtraAttributes)) || {};
        if (!((ea.rarity_upgrades || 0) > 0)) recombCounts[rarity] += 1;
      }
    }
    // Owning a duplicate counts as owning the canonical accessory.
    for (const canon of Object.keys(duplicates)) {
      for (const dup of duplicates[canon]) if (owned.has(dup)) { owned.add(canon); break; }
    }

    // Family top for any accessory id.
    const topOf = (id) => { const up = upgrades[id]; return up && up.length ? String(up[up.length - 1]).toUpperCase() : id; };

    // Group the accessory universe by family top.
    const familyMembers = {}; // top -> [ids]
    for (const id of Object.keys(accData)) {
      const t = topOf(id);
      (familyMembers[t] = familyMembers[t] || []).push(id);
    }

    const buy = [];
    const soulbound = [];
    for (const top of Object.keys(familyMembers)) {
      if (owned.has(top)) continue; // already have the best in this family
      const members = familyMembers[top];
      const meta = accData[top]; if (!meta) continue;
      // Highest MP already owned in this family (for the gain calc).
      let currentMp = 0;
      for (const m of members) if (owned.has(m)) currentMp = Math.max(currentMp, mpFor(m, (accData[m] || {}).rarity));
      const topMp = mpFor(top, meta.rarity);
      const gain = topMp - currentMp;
      if (gain <= 0) continue;
      const price = priceOf(top);
      const row = { kind: "buy", id: top, name: meta.name, rarity: titleCaseRarity(meta.rarity), gain, price };
      if (price == null) soulbound.push(row); else { row.coinsPerMp = Math.round(price / gain); buy.push(row); }
    }

    // Recombobulator suggestions.
    const recombPrice = priceOf("RECOMBOBULATOR_3000");
    const recombs = [];
    if (recombPrice) {
      for (const r of RECOMB_RARITIES) {
        const count = recombCounts[r];
        if (count > 0) { const gain = RECOMB_DELTA[r]; recombs.push({ kind: "recomb", rarity: titleCaseRarity(r), count, gain, price: recombPrice, coinsPerMp: Math.round(recombPrice / gain) }); }
      }
    }

    const priced = buy.concat(recombs).sort((a, b) => a.coinsPerMp - b.coinsPerMp);
    soulbound.sort((a, b) => b.gain - a.gain);
    const recommendations = priced.concat(soulbound);
    const missingCount = buy.length + soulbound.length;
    const totalCost = buy.reduce((s, t) => s + t.price, 0);

    return res.status(200).json({
      name: who.name,
      profile: profile.cute_name || null,
      missingCount,
      recommendations,
      totalCost,
      tip: "Buy from the top down — those add the most Magic Power per coin. Each entry shows the MP it adds; recombing accessories you already own is slotted in at its real value. 'Soulbound' items can't be bought.",
    });
  } catch (e) {
    return res.status(502).json({ error: "Couldn't look up missing accessories right now. Please try again." });
  }
}
