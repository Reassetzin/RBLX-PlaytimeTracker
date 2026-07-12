// server.js
import express from "express";

const app  = express();
const PORT = process.env.PORT || 3000;
app.use(express.json());

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

// Color + icon scale by total playtime (no rank names)
function rankColor(totalSeconds) {
  const h = totalSeconds / 3600;
  if (h >= 50) return 0xFFD700; // gold
  if (h >= 10) return 0x9B59B6; // purple
  if (h >= 1)  return 0x3498DB; // blue
  return 0x2ECC71;               // green
}

function rankIcon(totalSeconds) {
  const h = totalSeconds / 3600;
  if (h >= 50) return "🏆";
  if (h >= 10) return "💜";
  if (h >= 1)  return "🔵";
  return "🟢";
}

// Fetch the player's Roblox headshot URL
async function getRobloxAvatar(userId) {
  try {
    const res  = await fetch(
      `https://thumbnails.roblox.com/v1/users/avatar-headshot?userIds=${userId}&size=150x150&format=Png&isCircular=false`
    );
    const data = await res.json();
    return data?.data?.[0]?.imageUrl ?? null;
  } catch {
    return null;
  }
}

async function sendDiscordEmbed({ username, userId, gameName, sessionTime, totalTime, sessionCount }) {
  const webhookUrl = process.env.DISCORD_WEBHOOK_URL;
  if (!webhookUrl) throw new Error("DISCORD_WEBHOOK_URL not set");

  const sessionFmt = formatTime(sessionTime);
  const totalFmt   = formatTime(totalTime);
  const avgFmt     = formatTime(Math.floor(totalTime / sessionCount));
  const avatarUrl  = await getRobloxAvatar(userId);
  const isFirst    = sessionCount === 1;

  const icon  = isFirst ? "👋" : rankIcon(totalTime);
  const color = isFirst ? 0xFEE75C : rankColor(totalTime);
  const title = isFirst
    ? "👋 First Session!"
    : `${icon} Player Session Complete`;

  const embed = {
    title,
    color,
    ...(avatarUrl && { thumbnail: { url: avatarUrl } }),
    fields: [
      { name: "👤  Player",         value: `\`${username}\``,             inline: true },
      { name: "⏱️  Session",        value: `\`${sessionFmt}\``,           inline: true },
      { name: "📈  Total Playtime", value: `\`${totalFmt}\``,             inline: true },
      { name: "🔢  Sessions",       value: `\`${ordinal(sessionCount)}\``, inline: true },
      { name: "⏳  Avg Session",    value: `\`${avgFmt}\``,               inline: true },
      { name: "🎮  Game",           value: `\`${gameName || "Unknown"}\``, inline: true },
    ],
    footer: { text: "Roblox Playtime Tracker" },
    timestamp: new Date().toISOString(),
  };

  const res = await fetch(webhookUrl, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ embeds: [embed] }),
  });

  if (!res.ok) {
    const body = await res.text();
    throw new Error(`Discord responded ${res.status}: ${body}`);
  }
}

// ── Routes ─────────────────────────────────────────────────────────────────

app.get("/", (_req, res) => res.send("Playtime Tracker is running ✅"));

app.post("/session-end", async (req, res) => {
  const { username, userId, gameName, sessionTime, totalTime, sessionCount } = req.body;

  if (!username || sessionTime == null || totalTime == null) {
    return res.status(400).json({ error: "Missing required fields" });
  }

  try {
    await sendDiscordEmbed({ username, userId, gameName, sessionTime, totalTime, sessionCount });
    console.log(`✅ ${username} | ${gameName} | session=${sessionTime}s | total=${totalTime}s | #${sessionCount}`);
    res.status(200).json({ ok: true });
  } catch (err) {
    console.error("❌", err.message);
    res.status(500).json({ error: err.message });
  }
});

// ── Start ──────────────────────────────────────────────────────────────────

app.listen(PORT, () => console.log(`Server listening on port ${PORT}`));
