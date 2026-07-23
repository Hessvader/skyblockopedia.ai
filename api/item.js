// Item price commands for Skyblockopedia — mirrors SkyHelper's `bazaar` and `price`.
// GET /api/item?cmd=<bazaar|price>&arg=<item name or id>

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

function normId(s) { return String(s || "").trim().toUpperCase().replace(/[^A-Z0-9]+/g, "_").replace(/^_|_$/g, ""); }

export default async function handler(req, res) {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Headers", "content-type");
  if (req.method === "OPTIONS") return res.status(200).end();

  const cmd = String((req.query && req.query.cmd) || "").trim().toLowerCase();
  const arg = String((req.query && req.query.arg) || "").trim();
  if (!arg) return res.status(400).json({ error: "Name an item, e.g. \"Enchanted Diamond\"." });

  try {
    if (cmd === "bazaar") {
      const r = await fetch(HYPIXEL + "/skyblock/bazaar");
      if (!r.ok) return res.status(502).json({ error: "Bazaar API error (" + r.status + ")." });
      const d = await r.json();
      const products = d.products || {};
      const want = normId(arg);
      let id = products[want] ? want : null;
      if (!id) {
        const tokens = want.split("_").filter(Boolean);
        const matches = Object.keys(products).filter((pid) => tokens.every((t) => pid.includes(t)));
        matches.sort((a, b) => a.length - b.length);
        id = matches[0] || null;
      }
      if (!id) return res.status(404).json({ error: "\"" + arg + "\" isn't on the Bazaar (it may be an Auction House item — try price)." });
      const q = products[id].quick_status || {};
      return res.status(200).json({
        cmd: "bazaar", id, name: id.replace(/_/g, " "),
        buyPrice: Math.round((q.buyPrice || 0) * 10) / 10,
        sellPrice: Math.round((q.sellPrice || 0) * 10) / 10,
        buyVolume: q.buyVolume || 0, sellVolume: q.sellVolume || 0,
        buyOrders: q.buyOrders || 0, sellOrders: q.sellOrders || 0,
      });
    }

    if (cmd === "price") {
      const _nw = await import("skyhelper-networth");
      const getPrices = _nw.getPrices || (_nw.default && _nw.default.getPrices);
      let prices = {};
      try { prices = (await getPrices()) || {}; } catch (e) {}
      const want = normId(arg);
      let id = prices[want] != null ? want : null;
      let price = id ? prices[id] : null;
      if (price == null) {
        const tokens = want.split("_").filter(Boolean);
        const matches = Object.keys(prices).filter((pid) => tokens.every((t) => pid.toUpperCase().includes(t)));
        matches.sort((a, b) => a.length - b.length);
        if (matches[0]) { id = matches[0]; price = prices[id]; }
      }
      // Fall back to Bazaar buy price.
      if (price == null) {
        const br = await fetch(HYPIXEL + "/skyblock/bazaar");
        if (br.ok) { const bd = await br.json(); const p = (bd.products || {})[want]; if (p) { id = want; price = p.quick_status && p.quick_status.buyPrice; } }
      }
      if (price == null) return res.status(404).json({ error: "No price found for \"" + arg + "\"." });
      return res.status(200).json({ cmd: "price", id: String(id).toUpperCase(), name: String(id).replace(/_/g, " "), price: Math.round(price) });
    }

    return res.status(400).json({ error: "Unknown item command." });
  } catch (e) {
    return res.status(502).json({ error: "Couldn't fetch that price right now. Please try again." });
  }
}
