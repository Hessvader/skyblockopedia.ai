// Net worth endpoint for Skyblockopedia.
// GET /api/networth?user=<IGN>  ->  { name, profile, networth, unsoftcapped, purse, bank, categories }
// Uses the SkyHelper team's open-source net-worth engine (skyhelper-networth).
// Requires HYPIXEL_API_KEY (free — developer.hypixel.net).

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

export default async function handler(req, res) {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Headers", "content-type");
  if (req.method === "OPTIONS") return res.status(200).end();

  const key = process.env.HYPIXEL_API_KEY;
  if (!key) return res.status(503).json({ error: "Net worth isn't set up yet (missing Hypixel API key)." });

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

    const profile = pd.profiles.find(p => p.selected) || pd.profiles[0];
    const member = profile.members && profile.members[who.uuid];
    if (!member) return res.status(404).json({ error: "No SkyBlock data found for " + who.name + "." });
    const bank = (profile.banking && profile.banking.balance) || 0;

    let museum = null;
    try {
      const mr = await fetch(HYPIXEL + "/skyblock/museum?profile=" + profile.profile_id, { headers: { "API-Key": key } });
      if (mr.ok) { const md = await mr.json(); museum = md.members && md.members[who.uuid]; }
    } catch (e) {}

    const { ProfileNetworthCalculator } = await import("skyhelper-networth");
    const calc = new ProfileNetworthCalculator(member, museum, bank);
    const nw = await calc.getNetworth();

    const types = nw.types || {};
    const categories = Object.keys(types)
      .map(k => ({ name: k, total: Math.round(types[k].total || 0) }))
      .filter(x => x.total > 0)
      .sort((a, b) => b.total - a.total);

    return res.status(200).json({
      name: who.name,
      profile: profile.cute_name || null,
      networth: Math.round(nw.networth || 0),
      unsoftcapped: Math.round(nw.unsoftcappedNetworth || nw.networth || 0),
      purse: Math.round(nw.purse || 0),
      bank: Math.round(nw.bank || 0),
      categories,
    });
  } catch (e) {
    return res.status(502).json({ error: "Couldn't calculate net worth right now. Please try again." });
  }
}
