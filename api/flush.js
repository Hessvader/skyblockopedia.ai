// Daily cron: flush queued contact messages (from the 100/day overflow).
// Triggered by Vercel Cron (see vercel.json). Sends up to the remaining daily
// budget, then stops; leftovers wait for the next day.

const TO = process.env.CONTACT_TO || "hessvader@gmail.com";
const DAILY_CAP = 100;

async function redis(cmd) {
  const url = process.env.KV_REST_API_URL, tok = process.env.KV_REST_API_TOKEN;
  if (!url || !tok) throw new Error("KV not configured");
  const r = await fetch(url, { method: "POST", headers: { authorization: "Bearer " + tok, "content-type": "application/json" }, body: JSON.stringify(cmd) });
  if (!r.ok) throw new Error("KV " + r.status);
  return (await r.json()).result;
}
async function sendEmail(p) {
  const key = process.env.RESEND_API_KEY;
  const subject = "[Skyblockopedia] " + p.category.toUpperCase() + " (queued)" + (p.email ? (" - " + p.email) : "");
  const text = "Category: " + p.category + "\nFrom: " + (p.email || "(no email given)") +
    "\nIP: " + p.ip + "\nWhen: " + new Date(p.ts).toISOString() + "\n\nMessage:\n" + p.message;
  const body = { from: "Skyblockopedia <onboarding@resend.dev>", to: [TO], subject, text };
  if (p.email) body.reply_to = p.email;
  const r = await fetch("https://api.resend.com/emails", { method: "POST", headers: { authorization: "Bearer " + key, "content-type": "application/json" }, body: JSON.stringify(body) });
  if (!r.ok) throw new Error("Resend " + r.status);
}

export default async function handler(req, res) {
  const secret = process.env.CRON_SECRET;
  if (secret && (req.headers.authorization || "") !== "Bearer " + secret) return res.status(401).end("unauthorized");
  try {
    const today = new Date().toISOString().slice(0, 10);
    const gKey = "sbc:sent:" + today;
    let sent = Number(await redis(["GET", gKey]) || 0);
    let flushed = 0;
    while (sent < DAILY_CAP) {
      const item = await redis(["LPOP", "sbc:queue"]);
      if (!item) break;
      try { await sendEmail(JSON.parse(item)); sent++; flushed++; await redis(["INCR", gKey]); }
      catch (e) { await redis(["LPUSH", "sbc:queue", item]); break; }
    }
    await redis(["EXPIRE", gKey, 172800]);
    return res.status(200).json({ flushed });
  } catch (e) {
    return res.status(500).json({ error: String(e.message || e) });
  }
}
