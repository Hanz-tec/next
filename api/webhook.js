import fetch from "node-fetch";
import { supabase } from "../lib/db.js";
import { parseMessageToBets } from "../lib/parser.js";

const TELEGRAM_TOKEN = process.env.TELEGRAM_BOT_TOKEN;
if (!TELEGRAM_TOKEN) throw new Error("Missing TELEGRAM_BOT_TOKEN");

export default async function handler(req, res) {
  if (req.method !== "POST") return res.status(405).send("Method Not Allowed");

  const body = req.body;

  // handle Telegram update types
  const message = body?.message || body?.edited_message;
  if (!message) {
    return res.status(200).json({ ok: true });
  }

  const chatId = message.chat?.id;
  const sender =
    (message.from?.username) ||
    `${message.from?.first_name || ""} ${message.from?.last_name || ""}`.trim() ||
    `id_${message.from?.id}`;

  const text = (message.text || "").trim();

  // commands
  if (text.startsWith("/summarize")) {
    await handleSummarize(text, chatId, message.from?.id);
    return res.status(200).json({ ok: true });
  }

  // parse bets from text
  const bets = parseMessageToBets(text);
  if (bets.length === 0) {
    // ignore or reply invalid format
    // optional: reply help message
    return res.status(200).json({ ok: true });
  }

  // insert each bet into Supabase
  const rows = bets.map(b => ({
    number: b.number,
    amount: b.amount,
    sender,
    chat_id: chatId
  }));

  const { error } = await supabase.from("bets").insert(rows);
  if (error) console.error("Supabase insert error:", error);

  // send confirmation
  const summaryText = rows.map(r => `${r.number} - ${r.amount}`).join("\n");
  await sendTelegramMessage(chatId, `✅ Saved:\n${summaryText}`);

  return res.status(200).json({ ok: true });
}

/** Handle /summarize command
 *  Usage:
 *   /summarize                      => aggregate all numbers in chat
 *   /summarize peruser              => show per-user breakdown
 *   /summarize before12             => only entries with created_at hour < 12 (Asia/Yangon)
 */
async function handleSummarize(commandText, chatId, requesterId) {
  const tokens = commandText.split(/\s+/).slice(1).map(t => t.toLowerCase());
  const flagPerUser = tokens.includes("peruser");
  const flagBefore12 = tokens.includes("before12") || tokens.includes("before-12");

  try {
    // basic filter by chat_id
    let query = supabase.from("bets").select("number, amount, sender, created_at").eq("chat_id", chatId);

    if (flagBefore12) {
      // convert Asia/Yangon time threshold: keep server side simple by filtering hour in UTC offset
      // Supabase/PG: we can filter by date_part(hour at time zone 'Asia/Yangon', created_at) < 12
      query = supabase
        .from("bets")
        .select("number, amount, sender, created_at")
        .eq("chat_id", chatId)
        .filter("created_at", "not.is", null); // placeholder, we'll use RPC below
      // fallback: fetch all and filter in JS (safe for small volume)
      const all = await supabase.from("bets").select("number, amount, sender, created_at").eq("chat_id", chatId);
      if (all.error) throw all.error;
      const rows = all.data || [];
      // filter by Yangon local hour
      const filtered = rows.filter(r => {
        const dt = new Date(r.created_at); // created_at is ISO string UTC
        // shift to Asia/Yangon offset (UTC+6:30)
        const millis = dt.getTime() + (6.5 * 60 * 60 * 1000);
        const local = new Date(millis);
        return local.getUTCHours() < 12;
      });
      return await replyAggregates(filtered, chatId, flagPerUser);
    } else {
      // not before12, fetch all for chat
      const resp = await supabase.from("bets").select("number, amount, sender, created_at").eq("chat_id", chatId);
      if (resp.error) throw resp.error;
      return await replyAggregates(resp.data || [], chatId, flagPerUser);
    }
  } catch (err) {
    console.error("summarize error", err);
    await sendTelegramMessage(chatId, "❌ Error while summarizing. See server logs.");
  }
}

async function replyAggregates(rows, chatId, perUser) {
  if (!rows || rows.length === 0) {
    await sendTelegramMessage(chatId, "No data found for summary.");
    return;
  }

  if (!perUser) {
    // aggregate by number
    const agg = rows.reduce((acc, r) => {
      acc[r.number] = (acc[r.number] || 0) + (Number(r.amount) || 0);
      return acc;
    }, {});
    // format sorted by number
    const lines = Object.keys(agg)
      .sort()
      .map(n => `${n} - ${agg[n]}`);
    await sendTelegramMessage(chatId, `📊 Summary (numbers):\n${lines.join("\n")}`);
    return;
  } else {
    // per-user breakdown: for each number show sums per sender
    // Structure: { number: { sender: sum } }
    const map = {};
    for (const r of rows) {
      map[r.number] = map[r.number] || {};
      map[r.number][r.sender] = (map[r.number][r.sender] || 0) + Number(r.amount || 0);
    }
    // format
    const lines = [];
    const numbers = Object.keys(map).sort();
    for (const n of numbers) {
      const parts = Object.entries(map[n])
        .map(([sender, sum]) => `${sender}: ${sum}`)
        .join("; ");
      lines.push(`${n} -> ${parts}`);
    }
    await sendTelegramMessage(chatId, `📊 Summary (per user):\n${lines.join("\n")}`);
    return;
  }
}

async function sendTelegramMessage(chatId, text) {
  const url = `https://api.telegram.org/bot${TELEGRAM_TOKEN}/sendMessage`;
  await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ chat_id: chatId, text })
  });
}
