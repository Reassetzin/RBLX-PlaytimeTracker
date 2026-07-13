import { NextResponse } from 'next/server'
import { createClient } from '@supabase/supabase-js'

const BOT_TOKEN  = process.env.DISCORD_BOT_TOKEN!
const CHANNEL_ID = process.env.DISCORD_CHANNEL_ID!

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_KEY!
)

// ── Parsers ────────────────────────────────────────────────────────────────

function parseTime(s: string): number {
  s = s.replace(/`/g, '').trim()
  let t = 0
  const h = s.match(/(\d+)h/); if (h) t += parseInt(h[1]) * 3600
  const m = s.match(/(\d+)m/); if (m) t += parseInt(m[1]) * 60
  const sec = s.match(/(\d+)s/); if (sec) t += parseInt(sec[1])
  return t
}

function parseOrdinal(s: string): number {
  return parseInt(s.replace(/`/g, '').replace(/[a-z]+$/i, '')) || 0
}

function field(fields: any[], name: string): string {
  return (fields.find((f: any) => f.name.includes(name))?.value || '').replace(/`/g, '').trim()
}

function parseMessage(msg: any) {
  const embed = msg.embeds?.[0]
  if (!embed?.fields?.length) return null

  const username    = field(embed.fields, 'Player')
  if (!username) return null

  const sessionTime  = parseTime(field(embed.fields, 'Session'))
  const totalTime    = parseTime(field(embed.fields, 'Total'))
  const sessionCount = parseOrdinal(field(embed.fields, 'Sessions'))
  const gameName     = field(embed.fields, 'Game') || 'Merge a Capybara'
  const createdAt    = embed.timestamp || msg.timestamp

  if (!sessionTime && !totalTime) return null

  return { username, sessionTime, totalTime, sessionCount, gameName, createdAt }
}

// ── Roblox user ID lookup ──────────────────────────────────────────────────

async function lookupUserIds(usernames: string[]): Promise<Record<string, number>> {
  const map: Record<string, number> = {}
  // Batch 100 at a time
  for (let i = 0; i < usernames.length; i += 100) {
    const batch = usernames.slice(i, i + 100)
    try {
      const res = await fetch('https://users.roblox.com/v1/usernames/users', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ usernames: batch, excludeBannedUsers: false }),
      })
      const data = await res.json()
      for (const u of data.data || []) {
        map[u.name.toLowerCase()] = u.id
      }
    } catch { /* skip if Roblox API fails */ }
  }
  return map
}

// ── Fetch all Discord messages ─────────────────────────────────────────────

async function fetchAllMessages(): Promise<any[]> {
  const all: any[] = []
  let before: string | null = null

  while (true) {
    const beforeParam: string = before ? `&before=${before}` : ''
    const url: string = `https://discord.com/api/v10/channels/${CHANNEL_ID}/messages?limit=100${beforeParam}`
    const res = await fetch(url, { headers: { Authorization: `Bot ${BOT_TOKEN}` } })
    if (!res.ok) break

    const batch = await res.json()
    if (!Array.isArray(batch) || !batch.length) break

    all.push(...batch)
    before = batch[batch.length - 1].id
    if (batch.length < 100) break
  }

  return all
}

// ── Route ─────────────────────────────────────────────────────────────────

export async function GET(req: Request) {
  const dry = new URL(req.url).searchParams.get('dry') === 'true'

  if (!BOT_TOKEN || !CHANNEL_ID) {
    return NextResponse.json({ error: 'Missing DISCORD_BOT_TOKEN or DISCORD_CHANNEL_ID env vars' }, { status: 400 })
  }

  // 1. Fetch existing sessions for dedup
  const { data: existing } = await supabase.from('sessions').select('username, game_name, session_count')
  const existingKeys = new Set((existing || []).map((s: any) => `${s.username.toLowerCase()}|${s.game_name}|${s.session_count}`))

  // 2. Fetch all Discord messages
  const messages = await fetchAllMessages()

  // 3. Parse embeds
  const parsed = messages.map(parseMessage).filter(Boolean) as any[]

  // 4. Deduplicate
  const toInsert: any[] = []
  const seen = new Set<string>()

  for (const s of parsed) {
    // Use session_count if available, otherwise fall back to timestamp-minute
    const key = s.sessionCount > 0
      ? `${s.username.toLowerCase()}|${s.gameName}|${s.sessionCount}`
      : `${s.username.toLowerCase()}|${s.gameName}|${Math.floor(new Date(s.createdAt).getTime() / 60000)}`

    if (existingKeys.has(key) || seen.has(key)) continue
    seen.add(key)
    toInsert.push(s)
  }

  // 5. Look up Roblox user IDs
  const uniqueUsernames = [...new Set(toInsert.map(s => s.username))]
  const userIdMap = await lookupUserIds(uniqueUsernames)

  // 6. Build insert rows
  const rows = toInsert.map(s => ({
    username:      s.username,
    user_id:       userIdMap[s.username.toLowerCase()] ?? 0,
    game_name:     s.gameName,
    session_time:  s.sessionTime,
    total_time:    s.totalTime,
    session_count: s.sessionCount || 1,
    created_at:    s.createdAt,
  }))

  // 7. Insert (skip if dry run)
  let inserted = 0, errors = 0
  if (!dry) {
    for (let i = 0; i < rows.length; i += 50) {
      const { error } = await supabase.from('sessions').insert(rows.slice(i, i + 50))
      if (!error) inserted += Math.min(50, rows.length - i)
      else errors++
    }
  }

  return NextResponse.json({
    messagesScanned: messages.length,
    embedsParsed:    parsed.length,
    alreadyInDB:     parsed.length - toInsert.length,
    toImport:        toInsert.length,
    inserted:        dry ? '(dry run)' : inserted,
    errors,
    preview:         rows.slice(0, 5), // show first 5 for verification
  }, { status: 200 })
}
