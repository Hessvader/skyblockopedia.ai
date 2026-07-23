// Shared SkyBlock leveling/weight constants + helpers.
// Constants sourced from SkyHelper (Altpapier/SkyHelperAPI), which credits SkyCrypt
// and Senither's hypixel-skyblock-facade. Used by the player-stats commands.

export const MAX_LEVELS = {
  farming: 60, mining: 60, combat: 60, foraging: 54, fishing: 50, enchanting: 60,
  alchemy: 50, taming: 50, carpentry: 50, hunting: 25, runecrafting: 25, social: 25, dungeoneering: 50,
};
export const WEIGHT_MAX_LEVELS = {
  farming: 60, mining: 60, combat: 60, foraging: 60, fishing: 60, enchanting: 60,
  alchemy: 60, taming: 60, carpentry: 60, runecrafting: 25, social: 25, dungeoneering: 50,
};

const XP = {
  normal: [50,125,200,300,500,750,1000,1500,2000,3500,5000,7500,10000,15000,20000,30000,50000,75000,100000,200000,300000,400000,500000,600000,700000,800000,900000,1000000,1100000,1200000,1300000,1400000,1500000,1600000,1700000,1800000,1900000,2000000,2100000,2200000,2300000,2400000,2500000,2600000,2750000,2900000,3100000,3400000,3700000,4000000,4300000,4600000,4900000,5200000,5500000,5800000,6100000,6400000,6700000,7000000],
  social: [50,100,150,250,500,750,1000,1250,1500,2000,2500,3000,3750,4500,6000,8000,10000,12500,15000,20000,25000,30000,35000,40000,50000],
  runecrafting: [50,100,125,160,200,250,315,400,500,625,785,1000,1250,1600,2000,2465,3125,4000,5000,6200,7800,9800,12200,15300,19050],
  catacombs: [50,75,110,160,230,330,470,670,950,1340,1890,2665,3760,5260,7380,10300,14400,20000,27600,38000,52500,71500,97000,132000,180000,243000,328000,445000,600000,800000,1065000,1410000,1900000,2500000,3300000,4300000,5600000,7200000,9200000,12000000,15000000,19000000,24000000,30000000,38000000,48000000,60000000,75000000,93000000,116250000],
};

export const SLAYER_XP = {
  zombie: [5,15,200,1000,5000,20000,100000,400000,1000000],
  spider: [5,25,200,1000,5000,20000,100000,400000,1000000],
  wolf: [5,30,250,1500,5000,20000,100000,400000,1000000],
  enderman: [10,30,250,1500,5000,20000,100000,400000,1000000],
  blaze: [10,30,250,1500,5000,20000,100000,400000,1000000],
  vampire: [20,75,240,840,2400],
};

const PET_XP = [100,110,120,130,145,160,175,190,210,230,250,275,300,330,360,400,440,490,540,600,660,730,800,880,960,1050,1150,1260,1380,1510,1650,1800,1960,2130,2310,2500,2700,2920,3160,3420,3700,4000,4350,4750,5200,5700,6300,7000,7800,8700,9700,10800,12000,13300,14700,16200,17800,19500,21300,23200,25200,27400,29800,32400,35200,38200,41400,44800,48400,52200,56200,60400,64800,69400,74200,79200,84700,90700,97200,104200,111700,119700,128200,137200,146700,156700,167700,179700,192700,206700,221700,237700,254700,272700,291700,311700,333700,357700,383700,411700,441700,476700,516700,561700,611700,666700,726700,791700,861700,936700,1016700,1101700,1191700,1286700,1386700,1496700,1616700,1746700,1886700];
const PET_OFFSETS = { COMMON: 0, UNCOMMON: 6, RARE: 11, EPIC: 16, LEGENDARY: 20, MYTHIC: 20 };

export function calcSkill(skill, experience, ignoreMax) {
  let table = "normal";
  if (skill === "runecrafting") table = "runecrafting";
  if (skill === "social") table = "social";
  if (skill === "dungeoneering") table = "catacombs";
  const tbl = XP[table];
  if (!experience || experience <= 0) return { level: 0, levelWithProgress: 0, progress: 0, xpForNext: tbl[0], xpCurrent: 0, totalXp: 0 };

  let maxLevel = 0;
  if (MAX_LEVELS[skill]) maxLevel = ignoreMax ? WEIGHT_MAX_LEVELS[skill] : MAX_LEVELS[skill];
  let xp = 0, level = 0;
  for (let i = 1; i <= maxLevel; i++) {
    xp += tbl[i - 1];
    if (xp > experience) { xp -= tbl[i - 1]; } else { level = i; }
  }
  const xpCurrent = Math.floor(experience - xp);
  const xpForNext = level < maxLevel ? Math.ceil(tbl[level]) : 0;
  const progress = level >= maxLevel ? 0 : Math.max(0, Math.min(xpCurrent / xpForNext, 1));
  return { level, levelWithProgress: level < maxLevel ? level + progress : level, progress, xpForNext, xpCurrent, totalXp: experience };
}

export function slayerLevel(boss, xp) {
  const arr = SLAYER_XP[boss] || [];
  let level = 0;
  for (let i = 0; i < arr.length; i++) if ((xp || 0) >= arr[i]) level = i + 1;
  return level;
}

export function petLevel(exp, rarity, type) {
  const max = type === "GOLDEN_DRAGON" || type === "JADE_DRAGON" ? 200 : 100;
  const offset = PET_OFFSETS[(rarity || "COMMON").toUpperCase()] ?? 0;
  let level = 1, sum = 0;
  for (let i = offset; i < offset + max - 1 && i < PET_XP.length; i++) {
    sum += PET_XP[i];
    if (sum > (exp || 0)) break;
    level++;
  }
  return Math.min(level, max);
}

// ---- Senither weight (credit: Senither / hypixel-skyblock-facade) ----
const DUNGEON_W = { catacombs: 0.0002149604615, healer: 0.0000045254834, mage: 0.0000045254834, berserk: 0.0000045254834, archer: 0.0000045254834, tank: 0.0000045254834 };
const SLAYER_W = { revenant: { divider: 2208, modifier: 0.15 }, tarantula: { divider: 2118, modifier: 0.08 }, sven: { divider: 1962, modifier: 0.015 }, enderman: { divider: 1430, modifier: 0.017 } };
const SKILL_W = {
  mining: { exponent: 1.18207448, divider: 259634, maxLevel: 60 },
  foraging: { exponent: 1.232826, divider: 259634, maxLevel: 50 },
  enchanting: { exponent: 0.96976583, divider: 882758, maxLevel: 60 },
  farming: { exponent: 1.217848139, divider: 220689, maxLevel: 60 },
  combat: { exponent: 1.15797687265, divider: 275862, maxLevel: 60 },
  fishing: { exponent: 1.406418, divider: 88274, maxLevel: 50 },
  alchemy: { exponent: 1.0, divider: 1103448, maxLevel: 50 },
  taming: { exponent: 1.14744, divider: 441379, maxLevel: 50 },
};

function skillWeight(type, level, experience) {
  const g = SKILL_W[type];
  const maxXP = g.maxLevel === 60 ? 111672425 : 55172425;
  let base = Math.pow(level * 10, 0.5 + g.exponent + level / 100) / 1250;
  if (experience > maxXP) base = Math.round(base);
  if (experience <= maxXP) return base;
  return base + Math.pow((experience - maxXP) / g.divider, 0.968);
}
function slayerWeight(type, experience) {
  const w = SLAYER_W[type];
  if (!experience) return 0;
  if (experience <= 1000000) return experience / w.divider;
  let base = 1000000 / w.divider, remaining = experience - 1000000, modifier = w.modifier, overflow = 0;
  while (remaining > 0) {
    const left = Math.min(remaining, 1000000);
    overflow += Math.pow(left / (w.divider * (1.5 + modifier)), 0.942);
    modifier += w.modifier; remaining -= left;
  }
  return base + overflow;
}
function dungeonWeight(type, level, experience) {
  const base = Math.pow(level, 4.5) * DUNGEON_W[type];
  if (experience <= 569809640) return base;
  const remaining = experience - 569809640;
  const splitter = (4 * 569809640) / base;
  return Math.floor(base) + (Math.pow(remaining / splitter, 0.968) || 0);
}

// member is a Hypixel profile member object.
export function senitherWeight(member) {
  const se = (s) => getSkillExp(member, s);
  const skills = ["mining", "foraging", "enchanting", "farming", "combat", "fishing", "alchemy", "taming"];
  let skillW = 0;
  for (const s of skills) { const xp = se(s); skillW += skillWeight(s, calcSkill(s, xp).levelWithProgress, xp); }

  const sl = member?.slayer?.slayer_bosses || member?.slayer_bosses || {};
  let slayerW = 0;
  slayerW += slayerWeight("revenant", sl?.zombie?.xp || 0);
  slayerW += slayerWeight("tarantula", sl?.spider?.xp || 0);
  slayerW += slayerWeight("sven", sl?.wolf?.xp || 0);
  slayerW += slayerWeight("enderman", sl?.enderman?.xp || 0);

  const d = member?.dungeons || {};
  const cataXp = d?.dungeon_types?.catacombs?.experience || 0;
  let dungeonW = dungeonWeight("catacombs", calcSkill("dungeoneering", cataXp).levelWithProgress, cataXp);
  const classes = d?.player_classes || {};
  for (const c of ["healer", "mage", "berserk", "archer", "tank"]) {
    const cx = classes?.[c]?.experience || 0;
    dungeonW += dungeonWeight(c, calcSkill("dungeoneering", cx).levelWithProgress, cx);
  }
  const total = skillW + slayerW + dungeonW;
  return { total, skills: skillW, slayer: slayerW, dungeons: dungeonW };
}

export function getSkillExp(member, skill) {
  const exp = member?.player_data?.experience || {};
  const k = "SKILL_" + skill.toUpperCase();
  if (typeof exp[k] === "number") return exp[k];
  if (typeof member?.["experience_skill_" + skill] === "number") return member["experience_skill_" + skill];
  return 0;
}

// ---- Minion slots ----
const MINION_SLOTS = { 0:5,5:6,15:7,30:8,50:9,75:10,100:11,125:12,150:13,175:14,200:15,225:16,250:17,275:18,300:19,350:20,400:21,450:22,500:23,550:24,600:25,650:26,700:27,750:28,800:29,850:30 };
export function minionSlots(uniqueCount) {
  let slots = 5;
  for (const key of Object.keys(MINION_SLOTS).map(Number).sort((a, b) => a - b)) if (uniqueCount >= key) slots = MINION_SLOTS[key];
  return slots;
}

// ---- Fetchur (cycles by day of month) ----
export const FETCHUR = {
  0: "50x Red Wool", 1: "20x Yellow Stained Glass", 2: "1x Compass", 3: "20x Mithril",
  4: "1x Firework Rocket", 5: "1x Coffee (Cheap Coffee)", 6: "1x Door (any wooden door)",
  7: "3x Rabbit's Feet", 8: "1x Superboom TNT", 9: "1x Pumpkin", 10: "1x Flint and Steel",
  11: "50x Nether Quartz Ore", 12: "50x Red Wool",
};
export function fetchurToday(day) { return FETCHUR[(day - 1) % 13]; }

// SkyBlock magic power per accessory rarity (approx, for the talismans command).
export const MP_BY_RARITY = { COMMON: 3, UNCOMMON: 5, RARE: 8, EPIC: 12, LEGENDARY: 16, MYTHIC: 22, SPECIAL: 3, VERY_SPECIAL: 5 };

// Dolphin (sea creatures killed) + Rock (ores mined) pet milestones — SkyHelper's `milestones` command.
export const MILESTONES = {
  dolphin: [250, 1000, 2500, 5000, 10000],
  rock: [2500, 7500, 20000, 100000, 250000],
  rarities: ["common", "uncommon", "rare", "epic", "legendary"],
};
export function milestoneTier(pet, stat) {
  const arr = MILESTONES[pet] || [];
  const s = stat || 0;
  let level = 0;
  for (let i = 0; i < 5; i++) if (arr[i] < s) level = i + 1;
  const next = level < 5 ? arr[level] : 0;
  return { level, stat: s, rarity: level > 0 ? MILESTONES.rarities[level - 1] : "none", next, toNext: next ? next - s : 0 };
}
