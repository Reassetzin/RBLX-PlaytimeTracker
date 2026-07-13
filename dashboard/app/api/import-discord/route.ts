import { NextResponse } from 'next/server'
import { createClient } from '@supabase/supabase-js'

const BOT_TOKEN  = process.env.DISCORD_BOT_TOKEN!
const CHANNEL_ID = process.env.DISCORD_CHANNEL_ID!

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_KEY!
)

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
  const username = field(embed.fields, 'Player')
  if (!username) return null
  const sessionTime  = parseTime(field(embed.fields, 'Session'))
  const totalTime    = parseTime(field(embed.fields, 'Total'))
  const sessionCount = parseOrdinal(field(embed.fields, 'Sessions'))
  const gameName     = field(embed.fields, 'Game') || 'Merge a Capybara!'
  // Use Discord message timestamp (most reliable - always set by Discord)
  const createdAt    = msg.timestamp
  if (!sessionTime && !totalTime) return null
  return { username, sessionTime, totalTime, sessionCount, gameName, createdAt }
}

async function lookupUserIds(usernames: string[]): Promise<Record<string, number>> {
  const map: Record<string, number> = {}
  for (let i = 0; i < usernames.length; i += 100) {
    try {
      const res = await fetch('https://users.roblox.com/v1/usernames/users', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ usernames: usernames.slice(i, i + 100), excludeBannedUsers: false }),
      })
      const data = await res.json()
      for (const u of data.data || []) map[u.name.toLowerCase()] = u.id
    } catch { /* skip */ }
  }
  return map
}

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

export async function GET(req: Request) {
  const dry = new URL(req.url).searchParams.get('dry') === 'true'
  if (!BOT_TOKEN || !CHANNEL_ID) {
    return NextResponse.json({ error: 'Missing env vars' }, { status: 400 })
  }

  // Verify created_at can be set before doing anything
  if (!dry) {
    const testTs = '2000-01-01T00:00:00.000Z'
    const { data: testInsert } = await supabase
      .from('sessions')
      .insert({ username: '__test__', user_id: 0, game_name: '__test__', session_time: 1, total_time: 1, session_count: 1, created_at: testTs })
      .select('created_at')
      .single()

    await supabase.from('sessions').delete().eq('username', '__test__')

    if (testInsert?.created_at?.startsWith('2000') === false) {
      return NextResponse.json({
        error: 'Supabase is ignoring the created_at value — check SUPABASE_SERVICE_KEY env var',
        stored: testInsert?.created_at,
        expected: testTs,
      }, { status: 500 })
    }
  }

  const { data: existing } = await supabase.from('sessions').select('username, game_name, session_count, created_at')
  const existingKeys = new Set((existing || []).map((s: any) =>
    `${s.username.toLowerCase()}|${s.game_name}|${s.session_count}`
  ))

  const messages = await fetchAllMessages()
  const parsed = messages.map(parseMessage).filter(Boolean) as any[]

  const toInsert: any[] = []
  const seen = new Set<string>()
  for (const s of parsed) {
    const key = s.sessionCount > 0
      ? `${s.username.toLowerCase()}|${s.gameName}|${s.sessionCount}`
      : `${s.username.toLowerCase()}|${s.gameName}|${Math.floor(new Date(s.createdAt).getTime() / 60000)}`
    if (existingKeys.has(key) || seen.has(key)) continue
    seen.add(key)
    toInsert.push(s)
  }

  const uniqueUsernames = [...new Set(toInsert.map(s => s.username))]
  const userIdMap = await lookupUserIds(uniqueUsernames)

  const rows = toInsert.map(s => ({
    username:      s.username,
    user_id:       userIdMap[s.username.toLowerCase()] ?? 0,
    game_name:     s.gameName,
    session_time:  s.sessionTime,
    total_time:    s.totalTime,
    session_count: s.sessionCount || 1,
    created_at:    new Date(s.createdAt).toISOString(),
  }))

  let inserted = 0, errors = 0, errorSamples: any[] = []
  if (!dry) {
    for (let i = 0; i < rows.length; i += 25) {
      const batch = rows.slice(i, i + 25)
      const { error, data } = await supabase
        .from('sessions')
        .insert(batch)
        .select('created_at')
      if (!error) {
        inserted += batch.length
      } else {
        errors++
        if (errorSamples.length < 3) errorSamples.push(error.message)
      }
    }
  }

  return NextResponse.json({
    messagesScanned: messages.length,
    embedsParsed:    parsed.length,
    alreadyInDB:     parsed.length - toInsert.length,
    toImport:        toInsert.length,
    inserted:        dry ? '(dry run)' : inserted,
    errors,
    errorSamples,
    sampleTimestamps: rows.slice(0, 3).map(r => ({ username: r.username, created_at: r.created_at })),
  })
}
