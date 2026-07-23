// Player stats endpoint for Skyblockopedia — mirrors the SkyHelper Discord bot's
// per-player STATS commands.
// GET /api/player?user=<IGN>&stat=<skills|dungeons|slayer|weight|pets|minions|collections|talismans|cakebag|stats>

import { calcSkill, slayerLevel, petLevel, senitherWeight, getSkillExp, minionSlots, MP_BY_RARITY, SLAYER_XP } from "./_gamedata.js";
import TALISMANS from "./_talismans.js";

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
const SKILLS = ["farming", "mining", "combat", "foraging", "fishing", "enchanting", "alchemy", "taming"];
const SLAYERS = ["zombie", "spider", "wolf", "enderman", "blaze", "vampire"];
const SLAYER_NAMES = { zombie: "Revenant", spider: "Tarantula", wolf: "Sven", enderman: "Voidgloom", blaze: "Inferno", vampire: "Riftstalker" };

function titleCase(s) { return String(s || "").toLowerCase().replace(/_/g, " ").replace(/\b\w/g, (c) => c.toUpperCase()); }
function round(n, d = 2) { const m = Math.pow(10, d); return Math.round((n || 0) * m) / m; }

async function resolveUuid(name) {
  try { const r = await fetch("https://api.mojang.com/users/profiles/minecraft/" + encodeURIComponent(name)); if (r.ok) { const d = await r.json(); if (d && d.id) return { uuid: d.id, name: d.name || name }; } } catch (e) {}
  try { const r = await fetch("https://api.ashcon.app/mojang/v2/user/" + encodeURIComponent(name)); if (r.ok) { const d = await r.json(); if (d && d.uuid) return { uuid: d.uuid.replace(/-/g, ""), name: d.username || name }; } } catch (e) {}
  return null;
}

function computeSkills(member) {
  const out = [];
  let sum = 0;
  for (const s of SKILLS) { const r = calcSkill(s, getSkillExp(member, s)); out.push({ skill: titleCase(s), level: r.level, progress: round(r.levelWithProgress) }); sum += r.levelWithProgress; }
  const extras = {};
  for (const s of ["carpentry", "runecrafting", "social"]) extras[s] = calcSkill(s, getSkillExp(member, s)).level;
  return { average: round(sum / SKILLS.length), skills: out, carpentry: extras.carpentry, runecrafting: extras.runecrafting, social: extras.social };
}

function computeSlayer(member) {
  const sl = member?.slayer?.slayer_bosses || member?.slayer_bosses || {};
  const out = []; let total = 0;
  for (const b of SLAYERS) { const xp = sl?.[b]?.xp || 0; total += xp; out.push({ boss: SLAYER_NAMES[b], xp: Math.round(xp), level: slayerLevel(b, xp) }); }
  return { totalXp: Math.round(total), bosses: out };
}

function computeDungeons(member) {
  const d = member?.dungeons || {};
  const cata = d?.dungeon_types?.catacombs || {};
  const master = d?.dungeon_types?.master_catacombs || {};
  const cataLevel = calcSkill("dungeoneering", cata.experience || 0);
  const classes = d?.player_classes || {};
  const classOut = {};
  for (const c of ["healer", "mage", "berserk", "archer", "tank"]) classOut[titleCase(c)] = calcSkill("dungeoneering", classes?.[c]?.experience || 0).level;
  const floors = {};
  const tc = cata.tier_completions || {};
  for (const k of Object.keys(tc)) floors[k] = tc[k];
  const mtc = master.tier_completions || {};
  const masterFloors = {};
  for (const k of Object.keys(mtc)) masterFloors[k] = mtc[k];
  return {
    catacombsLevel: cataLevel.level,
    catacombsProgress: round(cataLevel.levelWithProgress),
    selectedClass: d?.selected_dungeon_class ? titleCase(d.selected_dungeon_class) : null,
    classes: classOut,
    floorCompletions: floors,
    masterFloorCompletions: masterFloors,
    secrets: member?.dungeons?.secrets || null,
  };
}

function computePets(member) {
  const pets = member?.pets_data?.pets || member?.pets || [];
  const list = pets.map((p) => ({ name: titleCase(p.type), rarity: titleCase(p.tier), level: petLevel(p.exp || 0, p.tier, p.type), held: p.heldItem ? titleCase(String(p.heldItem).replace(/^PET_ITEM_/, "")) : null }));
  const order = { LEGENDARY: 5, MYTHIC: 6, EPIC: 4, RARE: 3, UNCOMMON: 2, COMMON: 1 };
  list.sort((a, b) => b.level - a.level);
  return { count: list.length, pets: list.slice(0, 20) };
}

function computeMinions(profile, member) {
  const set = new Set();
  const members = profile.members || {};
  const paths = (m) => [m?.crafted_generators, m?.player_data?.crafted_generators, m?.player_stats?.crafted_generators];
  for (const uuid of Object.keys(members)) {
    for (const g of paths(members[uuid])) if (Array.isArray(g)) for (const s of g) set.add(String(s).replace(/_\d+$/, ""));
  }
  const unique = set.size;
  return { uniqueMinions: unique, minionSlots: minionSlots(unique) };
}

function computeCollections(member) {
  const coll = member?.collection || {};
  const entries = Object.keys(coll).map((k) => ({ name: titleCase(k), amount: coll[k] })).sort((a, b) => b.amount - a.amount);
  const tiers = (member?.unlocked_coll_tiers || []).length;
  return { collectionsWithProgress: entries.length, unlockedTiers: tiers, top: entries.slice(0, 15) };
}

function computeStats(member) {
  const skills = computeSkills(member);
  const slayer = computeSlayer(member);
  const cata = calcSkill("dungeoneering", member?.dungeons?.dungeon_types?.catacombs?.experience || 0);
  const w = senitherWeight(member);
  const sbLevel = Math.floor((member?.leveling?.experience || 0) / 100);
  const fairies = member?.fairy_soul?.total_collected ?? member?.fairy_souls_collected ?? 0;
  return {
    skillAverage: skills.average,
    catacombsLevel: cata.level,
    totalSlayerXp: slayer.totalXp,
    senitherWeight: Math.round(w.total),
    skyblockLevel: sbLevel,
    fairySouls: fairies,
  };
}

export default async function handler(req, res) {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Headers", "content-type");
  if (req.method === "OPTIONS") return res.status(200).end();

  const key = process.env.HYPIXEL_API_KEY;
  if (!key) return res.status(503).json({ error: "Player stats aren't set up yet (missing Hypixel API key)." });

  const user = String((req.query && req.query.user) || "").trim();
  const stat = String((req.query && req.query.stat) || "stats").trim().toLowerCase();
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

    const base = { name: who.name, profile: profile.cute_name || null, stat };
    let data = {};

    if (stat === "_debug") {
      const mk = Object.keys(member);
      return res.status(200).json({ memberKeys: mk, hasCrafted: Array.isArray(member.crafted_generators), craftedLen: (member.crafted_generators || []).length, playerDataKeys: Object.keys(member.player_data || {}) });
    }

    if (stat === "skills") data = computeSkills(member);
    else if (stat === "slayer" || stat === "slayers") data = computeSlayer(member);
    else if (stat === "dungeons" || stat === "dungeon") data = computeDungeons(member);
    else if (stat === "pets") data = computePets(member);
    else if (stat === "minions") data = computeMinions(profile, member);
    else if (stat === "collections" || stat === "collection") data = computeCollections(member);
    else if (stat === "weight") { const w = senitherWeight(member); data = { total: Math.round(w.total), skills: Math.round(w.skills), slayer: Math.round(w.slayer), dungeons: Math.round(w.dungeons), type: "Senither" }; }
    else if (stat === "milestones") {
      let garden = null;
      try { const gr = await fetch(HYPIXEL + "/skyblock/garden?profile=" + profile.profile_id, { headers: { "API-Key": key } }); if (gr.ok) { const gd = await gr.json(); garden = gd.garden; } } catch (e) {}
      if (!garden) return res.status(200).json({ ...base, note: "No garden data available for this profile." });
      const crops = garden.crop_milestones || {};
      const cropList = Object.keys(crops).map((k) => ({ crop: titleCase(k), collected: crops[k] })).sort((a, b) => b.collected - a.collected);
      data = { gardenExperience: Math.round(garden.garden_experience || 0), crops: cropList };
    }
    else if (stat === "talismans" || stat === "cakebag") {
      const _nw = await import("skyhelper-networth");
      const ProfileNetworthCalculator = _nw.ProfileNetworthCalculator || (_nw.default && _nw.default.ProfileNetworthCalculator);
      const calc = new ProfileNetworthCalculator(member, null, (profile.banking && profile.banking.balance) || 0);
      const nw = await calc.getNetworth(stat === "cakebag" ? { includeItemData: true } : {});
      if (nw.noInventory) return res.status(409).json({ error: who.name + " has their inventory API turned off." });

      if (stat === "cakebag") {
        let years = null;
        for (const cat of Object.keys(nw.types || {})) {
          for (const it of (nw.types[cat].items || [])) {
            if (it && String(it.id).toUpperCase() === "NEW_YEAR_CAKE_BAG") {
              const ea = (it.itemData && it.itemData.tag && it.itemData.tag.ExtraAttributes) || it.extraAttributes || {};
              if (ea.new_year_cake_bag_years) years = ea.new_year_cake_bag_years;
            }
          }
        }
        if (!years) return res.status(200).json({ ...base, note: who.name + " has no New Year Cake Bag on this profile (or it couldn't be read)." });
        years = years.slice().sort((a, b) => a - b);
        const maxYear = years[years.length - 1];
        const owned = new Set(years);
        const missing = [];
        for (let y = 1; y <= maxYear; y++) if (!owned.has(y)) missing.push(y);
        data = { cakesOwned: years.length, highestYear: maxYear, missingYears: missing };
      } else {
        const accessories = (nw.types && nw.types.accessories && nw.types.accessories.items) || [];
        const owned = accessories.map((i) => (i && i.id ? String(i.id).toUpperCase() : null)).filter(Boolean);
        const byRarity = {};
        let magicPower = 0;
        for (const id of owned) {
          const meta = TALISMANS.talismans[id];
          const rarity = (meta && meta.rarity ? meta.rarity : "").toUpperCase();
          if (rarity) { byRarity[titleCase(rarity)] = (byRarity[titleCase(rarity)] || 0) + 1; magicPower += MP_BY_RARITY[rarity] || 0; }
        }
        if (owned.includes("HEGEMONY_ARTIFACT")) magicPower += 16; // Hegemony doubles its own MP
        if (owned.includes("RIFT_PRISM")) magicPower += 11;
        data = { totalAccessories: owned.length, byRarity, magicPowerEstimate: magicPower, note: "Magic power is an estimate." };
      }
    }
    else data = computeStats(member);

    return res.status(200).json({ ...base, ...data });
  } catch (e) {
    return res.status(502).json({ error: "Couldn't load that stat right now. Please try again." });
  }
}
