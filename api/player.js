// Player stats endpoint for Skyblockopedia — mirrors the SkyHelper Discord bot's
// per-player STATS commands.
// GET /api/player?user=<IGN>&stat=<skills|dungeons|slayer|weight|pets|minions|collections|talismans|cakebag|stats>

import { calcSkill, slayerLevel, petLevel, senitherWeight, getSkillExp, minionSlots, MP_BY_RARITY, SLAYER_XP, MAX_LEVELS, MILESTONES, milestoneTier } from "./_gamedata.js";
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

// Skill average uses the main (non-cosmetic, non-dungeon) skills. Hunting + Carpentry
// are shown but kept out of the classic average, matching community tools.
function computeSkills(member) {
  const display = [...SKILLS, "hunting", "carpentry"];
  let sum = 0;
  for (const s of SKILLS) sum += calcSkill(s, getSkillExp(member, s)).levelWithProgress;
  const rows = display.map((s) => { const r = calcSkill(s, getSkillExp(member, s)); return { skill: titleCase(s), level: r.level, progress: round(r.levelWithProgress), max: MAX_LEVELS[s] }; });
  const average = round(sum / SKILLS.length);
  let low = null;
  for (const r of rows) { if (!SKILLS.includes(r.skill.toLowerCase())) continue; if (r.level < r.max && (!low || r.progress < low.progress)) low = r; }
  const tip = low ? ("Your lowest main skill is " + low.skill + " (level " + low.level + ") — leveling it raises your Skill Average the fastest.") : "All main skills maxed. Work on Catacombs and cosmetic skills next.";
  return { average, skills: rows, tip };
}

function computeSlayer(member) {
  const sl = member?.slayer?.slayer_bosses || member?.slayer_bosses || {};
  const out = []; let total = 0;
  for (const b of SLAYERS) { const xp = sl?.[b]?.xp || 0; total += xp; out.push({ boss: SLAYER_NAMES[b], xp: Math.round(xp), level: slayerLevel(b, xp) }); }
  const withTier = out.filter((b) => SLAYER_XP[Object.keys(SLAYER_NAMES).find((k) => SLAYER_NAMES[k] === b.boss)]);
  const lowest = out.slice().sort((a, b) => a.level - b.level)[0];
  const tip = lowest ? ("Your lowest slayer is " + lowest.boss + " (level " + lowest.level + "). Slayer levels gate strong drops and armor — level it for a well-rounded build.") : "Start slayers at Maddox the Slayer in the Tavern.";
  return { totalXp: Math.round(total), bosses: out, tip };
}

function computeDungeons(member) {
  const d = member?.dungeons || {};
  const cata = d?.dungeon_types?.catacombs || {};
  const master = d?.dungeon_types?.master_catacombs || {};
  const cataLevel = calcSkill("dungeoneering", cata.experience || 0);
  const classes = d?.player_classes || {};
  const classOut = {};
  let lowClass = null;
  for (const c of ["healer", "mage", "berserk", "archer", "tank"]) { const lv = calcSkill("dungeoneering", classes?.[c]?.experience || 0).level; classOut[titleCase(c)] = lv; if (!lowClass || lv < lowClass.lv) lowClass = { name: titleCase(c), lv }; }
  const floors = {};
  const tc = cata.tier_completions || {};
  for (const k of Object.keys(tc)) floors[k] = tc[k];
  const mtc = master.tier_completions || {};
  const masterFloors = {};
  for (const k of Object.keys(mtc)) masterFloors[k] = mtc[k];
  const tip = lowClass ? ("Play your lowest class (" + lowClass.name + ", level " + lowClass.lv + ") to balance your class average — every class level boosts your stats inside dungeons.") : "Run Catacombs floors to level up. Higher floors give far more XP.";
  return {
    catacombsLevel: cataLevel.level,
    catacombsProgress: round(cataLevel.levelWithProgress),
    selectedClass: d?.selected_dungeon_class ? titleCase(d.selected_dungeon_class) : null,
    classes: classOut,
    floorCompletions: floors,
    masterFloorCompletions: masterFloors,
    secrets: member?.dungeons?.secrets || null,
    tip,
  };
}

function computePets(member) {
  const pets = member?.pets_data?.pets || member?.pets || [];
  const list = pets.map((p) => ({ name: titleCase(p.type), rarity: titleCase(p.tier), level: petLevel(p.exp || 0, p.tier, p.type), held: p.heldItem ? titleCase(String(p.heldItem).replace(/^PET_ITEM_/, "")) : null }));
  list.sort((a, b) => b.level - a.level);
  const top = list[0];
  const tip = top ? ("Your best pet is " + top.name + " (" + top.rarity + " Lv" + top.level + "). Hold the right pet item (Textbook, Tier Boost, skill boosts) to squeeze out more value.") : "Get pets from the Pet menu — a good pet transforms your build.";
  return { count: list.length, pets: list.slice(0, 20), tip };
}

function computeMinions(profile, member) {
  const set = new Set();
  const members = profile.members || {};
  const paths = (m) => [m?.crafted_generators, m?.player_data?.crafted_generators, m?.player_stats?.crafted_generators];
  const types = new Set();
  for (const uuid of Object.keys(members)) {
    for (const g of paths(members[uuid])) if (Array.isArray(g)) for (const s of g) { set.add(String(s)); types.add(String(s).replace(/_\d+$/, "")); }
  }
  const uniqueCrafts = set.size;
  const slots = minionSlots(uniqueCrafts);
  const tip = "You've crafted " + uniqueCrafts + " unique minion tiers → " + slots + " slots. Craft new minion types or tiers you don't have yet to unlock more slots.";
  return { uniqueMinions: types.size, craftedTiers: uniqueCrafts, minionSlots: slots, tip };
}

function computeCollections(member) {
  const coll = member?.collection || {};
  const entries = Object.keys(coll).map((k) => ({ name: titleCase(k), amount: coll[k] })).sort((a, b) => b.amount - a.amount);
  const tiers = ((member?.unlocked_coll_tiers) || (member?.player_data?.unlocked_coll_tiers) || []).length;
  const tip = "You've unlocked " + tiers + " collection tiers. Maxing collections unlocks new crafting recipes, minion tiers, and Bestiary progress.";
  return { collectionsWithProgress: entries.length, unlockedTiers: tiers, top: entries.slice(0, 15), tip };
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
    tip: "For detail on any area, try /skills, /dungeons, /slayer, /weight, /pets or /networth with this name.",
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

    if (stat === "skills") data = computeSkills(member);
    else if (stat === "slayer" || stat === "slayers") data = computeSlayer(member);
    else if (stat === "dungeons" || stat === "dungeon") data = computeDungeons(member);
    else if (stat === "pets") data = computePets(member);
    else if (stat === "minions") data = computeMinions(profile, member);
    else if (stat === "collections" || stat === "collection") data = computeCollections(member);
    else if (stat === "weight") {
      const w = senitherWeight(member);
      const parts = [["skills", w.skills], ["dungeons", w.dungeons], ["slayer", w.slayer]].sort((a, b) => b[1] - a[1]);
      data = { total: Math.round(w.total), skills: Math.round(w.skills), slayer: Math.round(w.slayer), dungeons: Math.round(w.dungeons), type: "Senither", tip: "Most of your weight comes from " + parts[0][0] + ". Senither weight rewards maxed skills, high Catacombs, and slayer XP — and overflow XP past the cap still counts." };
    }
    else if (stat === "milestones") {
      const ps = member?.player_stats || {};
      const seaKilled = ps?.pets?.milestone?.sea_creatures_killed ?? ps?.pet_milestone_sea_creatures_killed ?? 0;
      const oresMined = ps?.pets?.milestone?.ores_mined ?? ps?.pet_milestone_ores_mined ?? 0;
      const dolphin = milestoneTier("dolphin", seaKilled);
      const rock = milestoneTier("rock", oresMined);
      data = {
        dolphin: { rarity: titleCase(dolphin.rarity), tier: dolphin.level, seaCreaturesKilled: dolphin.stat, toNext: dolphin.toNext },
        rock: { rarity: titleCase(rock.rarity), tier: rock.level, oresMined: rock.stat, toNext: rock.toNext },
        tip: "The Dolphin pet gets stronger with sea creatures killed; the Rock pet with ores mined. Both cap at the Legendary milestone.",
      };
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
              const raw = it.item || it.itemData || {};
              const ea = (raw && (raw.tag ? raw.tag.ExtraAttributes : raw.ExtraAttributes)) || it.extraAttributes || {};
              if (ea.new_year_cake_bag_years) years = ea.new_year_cake_bag_years;
            }
          }
        }
        if (!years) return res.status(200).json({ ...base, note: who.name + " has no New Year Cake Bag on this profile (or it couldn't be read).", tip: "The New Year Cake Bag is bought from the Auction House. Store one New Year Cake per year in it for a permanent Health boost." });
        years = years.slice().sort((a, b) => a - b);
        const maxYear = years[years.length - 1];
        const owned = new Set(years);
        const missing = [];
        for (let y = 1; y <= maxYear; y++) if (!owned.has(y)) missing.push(y);
        data = { cakesOwned: years.length, highestYear: maxYear, missingYears: missing, tip: missing.length ? "Buy the missing New Year Cakes from the Auction House to fill the gaps — each cake adds permanent Health." : "Complete set through Year " + maxYear + " — every cake so far is stored." };
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
        if (owned.includes("HEGEMONY_ARTIFACT")) magicPower += 16;
        if (owned.includes("RIFT_PRISM")) magicPower += 11;
        data = { totalAccessories: owned.length, byRarity, magicPowerEstimate: magicPower, tip: "Raise Magic Power by owning more accessories and recombobulating them. Run /missing " + who.name + " to see the cheapest MP per coin. (MP shown is an estimate.)" };
      }
    }
    else data = computeStats(member);

    return res.status(200).json({ ...base, ...data });
  } catch (e) {
    return res.status(502).json({ error: "Couldn't load that stat right now. Please try again." });
  }
}
