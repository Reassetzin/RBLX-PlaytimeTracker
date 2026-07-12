// server.js
// Middleware between Roblox and Discord
// Receives player session data → sends a clean Discord embed
//
// Deploy free on: https://railway.app
// Required env vars:
//   DISCORD_WEBHOOK_URL  — your Discord channel webhook URL
//   SECRET_KEY           — any random string (add same value to Roblox script)

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

// Pick embed color based on total playtime (gamified feel)
function rankColor(totalSeconds) {
  const hours = totalSeconds / 3600;
  if (hours >= 50)  return 0xFFD700; // gold  — veteran
  if (hours >= 10)  return 0x9B59B6; // purple — regular
  if (hours >= 1)   return 0x3498DB; // blue  — familiar
  return 0x2ECC71;                   // green — new player
}

function rankLabel(totalSeconds) {
  const hours = totalSeconds / 3600;
  if (hours >= 50)  return "🏆 Veteran";
  if (hours >= 10)  return "💜 Regular";
  if (hours >= 1)   return "🔵 Familiar";
  return "🟢 New Player";
}

async function sendDiscordEmbed({ username, userId, sessionTime, totalTime }) {
  const webhookUrl = process.env.DISCORD_WEBHOOK_URL;
  if (!webhookUrl) throw new Error("DISCORD_WEBHOOK_URL not set");

  const sessionFmt = formatTime(sessionTime);
  const totalFmt   = formatTime(totalTime);

  const embed = {
    title: "📋 Player Session Complete",
    color: rankColor(totalTime),
    thumbnail: {
      url: `https://thumbs.roblox.com/v1/users/avatar-headshot?userIds=${userId}&size=150x150&format=Png&isCircular=false`
        .replace("thumbs.roblox.com/v1", "thumbnails.roblox.com/v1"), // correct endpoint
    },
    fields: [
      {
        name: "👤  Player",
        value: `\`${username}\``,
        inline: true,
      },
      {
        name: "⏱️  Session",
        value: `\`${sessionFmt}\``,
        inline: true,
      },
      {
        name: "📈  Total Playtime",
        value: `\`${totalFmt}\``,
        inline: true,
      },
      {
        name: "🏅  Rank",
        value: rankLabel(totalTime),
        inline: false,
      },
    ],
    footer: {
      text: "Roblox Playtime Tracker",
    },
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

// Health check — Railway/Render ping this to keep the server alive
app.get("/", (_req, res) => {
  res.send("Playtime Tracker is running ✅");
});

// Roblox posts here when a player leaves
app.post("/session-end", async (req, res) => {
  const { username, userId, sessionTime, totalTime } = req.body;

  // Basic validation
  if (!username || sessionTime == null || totalTime == null) {
    return res.status(400).json({ error: "Missing required fields" });
  }

  try {
    await sendDiscordEmbed({ username, userId, sessionTime, totalTime });
    console.log(`✅ Reported: ${username} | session=${sessionTime}s total=${totalTime}s`);
    res.status(200).json({ ok: true });
  } catch (err) {
    console.error("❌ Failed to send embed:", err.message);
    res.status(500).json({ error: err.message });
  }
});

// ── Start ──────────────────────────────────────────────────────────────────

app.listen(PORT, () => {
  console.log(`Server listening on port ${PORT}`);
});
