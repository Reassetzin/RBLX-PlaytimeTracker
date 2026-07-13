// server.js — Roblox → Supabase + Discord middleware
import express from "express";
import { createClient } from "@supabase/supabase-js";

const app  = express();
const PORT = process.env.PORT || 3000;
app.use(express.json());

const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_KEY
);

// ── Helpers ────────────────────────────────────────────────────────────────

function formatTime(seconds) {
  seconds = Math.floor(seconds);
  const h = Math.floor(seconds / 3600);
  const m = Math.floor((seconds % 3600) / 60);
  const s = seconds % 60;
  if (h > 0) return `${h}h ${m}m ${s}s`;
  if (m > 0) return `${m}m ${s}s`;
  return `${s}s`;
}

function ordinal(n) {
  const s = ["th", "st", "nd", "rd"];
  const v = n % 100;
  return n + (s[(v - 20) % 10] || s[v] || s[0]);
}

function rankColor(totalSeconds) {
  const h = totalSeconds / 3600;
  if (h >= 50) return 0xFFD700;
  if (h >= 10) return 0x9B59B6;
  if (h >= 1)  return 0x3498DB;
  return 0x2ECC71;
}

function rankIcon(totalSeconds) {
  const h = totalSeconds / 3600;
  if (h >= 50) return "🏆";
  if (h >= 10) return "💜";
  if (h >= 1)  return "🔵";
  return "🟢";
}

async function getRobloxAvatar(userId) {
  try {
    const res  = await fetch(
      `https://thumbnails.roblox.com/v1/users/avatar-headshot?userIds=${userId}&size=150x150&format=Png&isCircular=false`
    );
    const data = await res.json();
    return data?.data?.[0]?.imageUrl ?? null;
  } catch { return null; }
}

async function sendDiscordEmbed({ username, userId, gameName, sessionTime, totalTime, sessionCount }) {
  const webhookUrl = process.env.DISCORD_WEBHOOK_URL;
  if (!webhookUrl) return; // Discord is optional now that we have the dashboard

  const avatarUrl = await getRobloxAvatar(userId);
  const isFirst   = sessionCount === 1;
  const icon      = isFirst ? "👋" : rankIcon(totalTime);
  const color     = isFirst ? 0xFEE75C : rankColor(totalTime);

  const embed = {
    title: isFirst ? "👋 First Session!" : `${icon} Player Session Complete`,
    color,
    ...(avatarUrl && { thumbnail: { url: avatarUrl } }),
    fields: [
      { name: "👤  Player",         value: `\`${username}\``,              inline: true },
      { name: "⏱️  Session",        value: `\`${formatTime(sessionTime)}\``, inline: true },
      { name: "📈  Total Playtime", value: `\`${formatTime(totalTime)}\``,  inline: true },
      { name: "🔢  Sessions",       value: `\`${ordinal(sessionCount)}\``,  inline: true },
      { name: "⏳  Avg Session",    value: `\`${formatTime(Math.floor(totalTime / sessionCount))}\``, inline: true },
      { name: "🎮  Game",           value: `\`${gameName || "Unknown"}\``,  inline: true },
    ],
    footer: { text: "Roblox Playtime Tracker" },
    timestamp: new Date().toISOString(),
  };

  const res = await fetch(webhookUrl, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ embeds: [embed] }),
  });

  if (!res.ok) console.error(`Discord error ${res.status}:`, await res.text());
}

// ── Routes ─────────────────────────────────────────────────────────────────

app.get("/", (_req, res) => res.send("Playtime Tracker ✅"));

// Player joins game → add to live_players
app.post("/player-joined", async (req, res) => {
  const { username, userId, gameName } = req.body;
  if (!username || !userId) return res.status(400).json({ error: "Missing fields" });

  const { error } = await supabase.from("live_players").upsert({
    user_id: userId, username, game_name: gameName || "Unknown",
    joined_at: new Date().toISOString(),
  });

  if (error) { console.error("❌ Join:", error.message); return res.status(500).json({ error: error.message }); }
  console.log(`🟢 ${username} joined ${gameName}`);
  res.status(200).json({ ok: true });
});

// Player leaves game → remove from live_players + log session + Discord embed
app.post("/session-end", async (req, res) => {
  const { username, userId, gameName, sessionTime, totalTime, sessionCount } = req.body;
  if (!username || sessionTime == null) return res.status(400).json({ error: "Missing fields" });

  // Run all writes in parallel
  const [, sessionResult] = await Promise.all([
    supabase.from("live_players").delete().eq("user_id", userId),
    supabase.from("sessions").insert({
      username, user_id: userId, game_name: gameName || "Unknown",
      session_time: sessionTime, total_time: totalTime, session_count: sessionCount,
    }),
    sendDiscordEmbed({ username, userId, gameName, sessionTime, totalTime, sessionCount }),
  ]);

  if (sessionResult.error) {
    console.error("❌ Session insert:", sessionResult.error.message);
    return res.status(500).json({ error: sessionResult.error.message });
  }

  console.log(`✅ ${username} | ${gameName} | ${sessionTime}s | #${sessionCount}`);
  res.status(200).json({ ok: true });
});

app.listen(PORT, () => console.log(`Server on port ${PORT}`));
