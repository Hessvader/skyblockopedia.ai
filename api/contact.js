// Contact -> email endpoint for Skyblockopedia.
// Sends messages to hessvader@gmail.com via Resend, with a bot detector and a
// global 100/day cap; overflow is queued in Vercel KV and flushed next day.
//
// Env vars (set in Vercel):
//   RESEND_API_KEY        (resend.com — free)
//   KV_REST_API_URL + KV_REST_API_TOKEN   (added automatically by Vercel KV)
//   CONTACT_TO            (optional; defaults to hessvader@gmail.com)

const TO = process.env.CONTACT_TO || "hessvader@gmail.com";
const DAILY_CAP = 100;
const PER_IP_CAP = 5;         // max messages per IP per day (bot detector)
const MIN_FILL_MS = 2000;     // faster than this = bot

async function redis(cmd) {
  const url = process.env.KV_REST_API_URL, tok = process.env.KV_REST_API_TOKEN;
  if (!url || !tok) throw new Error("KV not configured");
  const r = await fetch(url, { method: "POST", headers: { authorization: "Bearer " + tok, "content-type": "application/json" }, body: JSON.stringify(cmd) });
  if (!r.ok) throw new Error("KV " + r.status);
  return (await r.json()).result;
}

async function sendEmail(p) {
  const key = process.env.RESEND_API_KEY;
  if (!key) throw new Error("email not configured");
  const subject = "[Skyblockopedia] " + p.category.toUpperCase() + (p.email ? (" - " + p.email) : "");
  const text = "Category: " + p.category + "\nFrom: " + (p.email || "(no email given)") +
    "\nIP: " + p.ip + "\nWhen: " + new Date(p.ts).toISOString() + "\n\nMessage:\n" + p.message;
  const body = { from: "Skyblockopedia <onboarding@resend.dev>", to: [TO], subject, text };
  if (p.email) body.reply_to = p.email;
  const r = await fetch("https://api.resend.com/emails", { method: "POST", headers: { authorization: "Bearer " + key, "content-type": "application/json" }, body: JSON.stringify(body) });
  if (!r.ok) throw new Error("Resend " + r.status + ": " + (await r.text()).slice(0, 200));
}

export default async function handler(req, res) {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Headers", "content-type");
  if (req.method === "OPTIONS") return res.status(200).end();
  if (req.method !== "POST") return res.status(405).json({ error: "POST only" });
  try {
    const b = typeof req.body === "string" ? JSON.parse(req.body) : (req.body || {});
    // --- bot detector ---
    if (b.hp) return res.status(200).json({ ok: true });                 // honeypot filled
    const elapsed = Number(b.t) || 0;
    if (elapsed > 0 && elapsed < MIN_FILL_MS) return res.status(200).json({ ok: true }); // too fast
    const cats = ["advertise", "question", "feedback"];
    if (!cats.includes(b.category)) return res.status(400).json({ error: "Please choose a topic first." });
    const message = String(b.message || "").trim();
    if (message.length < 2) return res.status(400).json({ error: "Please write a message." });
    if (message.length > 4000) return res.status(400).json({ error: "Message is too long (max 4000 chars)." });
    if ((message.match(/https?:\/\//g) || []).length > 4) return res.status(200).json({ ok: true }); // link spam

    const ip = (req.headers["x-forwarded-for"] || "").split(",")[0].trim() || "unknown";
    const today = new Date().toISOString().slice(0, 10);
    const email = String(b.email || "").slice(0, 200);
    if (email && !/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) return res.status(400).json({ error: "That email looks invalid." });

    // per-IP daily cap
    const ipKey = "sbc:ip:" + today + ":" + ip;
    const ipc = Number(await redis(["INCR", ipKey])); await redis(["EXPIRE", ipKey, 172800]);
    if (ipc > PER_IP_CAP) return res.status(429).json({ error: "You've sent a few messages already today. Please try again tomorrow." });

    const payload = { category: b.category, message, email, ip, ts: Date.now() };
    const gKey = "sbc:sent:" + today;
    const sent = Number(await redis(["GET", gKey]) || 0);
    if (sent >= DAILY_CAP) {
      await redis(["RPUSH", "sbc:queue", JSON.stringify(payload)]);
      return res.status(200).json({ ok: true, queued: true });
    }
    await sendEmail(payload);
    await redis(["INCR", gKey]); await redis(["EXPIRE", gKey, 172800]);
    return res.status(200).json({ ok: true });
  } catch (e) {
    return res.status(502).json({ error: "Couldn't send right now. Please try again later." });
  }
}
