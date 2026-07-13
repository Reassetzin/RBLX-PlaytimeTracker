'use client'

import { useEffect, useState, useCallback, useMemo, useRef } from 'react'
import { supabase, type Session, type LivePlayer } from '@/lib/supabase'
import { BarChart, Bar, XAxis, YAxis, Tooltip, ResponsiveContainer, Cell } from 'recharts'

// ── Helpers ─────────────────────────────────────────────────────────────────

function fmt(s: number) {
  s = Math.floor(s)
  const h = Math.floor(s / 3600), m = Math.floor((s % 3600) / 60), sec = s % 60
  if (h > 0) return `${h}h ${m}m ${sec}s`
  if (m > 0) return `${m}m ${sec}s`
  return `${sec}s`
}

function elapsedSince(dateStr: string, now: Date) {
  return fmt(Math.max(0, Math.floor((now.getTime() - new Date(dateStr).getTime()) / 1000)))
}

function timeAgo(dateStr: string) {
  const d = Math.floor((Date.now() - new Date(dateStr).getTime()) / 1000)
  if (d < 60) return `${d}s ago`
  if (d < 3600) return `${Math.floor(d / 60)}m ago`
  if (d < 86400) return `${Math.floor(d / 3600)}h ago`
  return new Date(dateStr).toLocaleDateString()
}

function sameDay(a: Date, b: Date) {
  return a.getDate() === b.getDate() && a.getMonth() === b.getMonth() && a.getFullYear() === b.getFullYear()
}

function formatDateLabel(d: Date) {
  const today = new Date()
  const yesterday = new Date(); yesterday.setDate(today.getDate() - 1)
  if (sameDay(d, today)) return 'Today'
  if (sameDay(d, yesterday)) return 'Yesterday'
  return d.toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric' })
}

function buildHourly(sessions: Session[], day: Date) {
  const bins = Array.from({ length: 24 }, (_, i) => ({
    h: i === 0 ? '12a' : i < 12 ? `${i}a` : i === 12 ? '12p' : `${i - 12}p`,
    n: 0,
  }))
  sessions.filter(s => sameDay(new Date(s.created_at), day))
    .forEach(s => { bins[new Date(s.created_at).getHours()].n++ })
  return bins
}

// ── Components ───────────────────────────────────────────────────────────────

function Card({ children, style = {} }: { children: React.ReactNode; style?: React.CSSProperties }) {
  return (
    <div style={{ background: 'var(--surface)', border: '1px solid var(--border)', borderRadius: 12, ...style }}>
      {children}
    </div>
  )
}

function StatCard({ label, value, sub }: { label: string; value: string | number; sub?: string }) {
  return (
    <Card style={{ padding: '16px 20px' }}>
      <p style={{ fontSize: 11, fontWeight: 600, letterSpacing: '0.08em', color: 'var(--text-2)', textTransform: 'uppercase', marginBottom: 8 }}>{label}</p>
      <p style={{ fontSize: 26, fontWeight: 700, color: 'var(--text)', lineHeight: 1 }}>{value}</p>
      {sub && <p style={{ fontSize: 12, color: 'var(--text-3)', marginTop: 4 }}>{sub}</p>}
    </Card>
  )
}

function Dot({ color = 'var(--green)', pulse = false }: { color?: string; pulse?: boolean }) {
  return (
    <span style={{ position: 'relative', display: 'inline-flex', width: 8, height: 8, flexShrink: 0 }}>
      {pulse && <span style={{ position: 'absolute', inset: 0, borderRadius: '50%', background: color, opacity: 0.4, animation: 'ping 1.5s cubic-bezier(0,0,0.2,1) infinite' }} />}
      <span style={{ position: 'relative', width: 8, height: 8, borderRadius: '50%', background: color, display: 'inline-block' }} />
      <style>{`@keyframes ping { 75%,100%{transform:scale(2);opacity:0} }`}</style>
    </span>
  )
}

function LiveCard({ player, now }: { player: LivePlayer; now: Date }) {
  return (
    <Card style={{ padding: '12px 16px', display: 'flex', alignItems: 'center', gap: 12 }}>
      <Dot pulse />
      <div style={{ flex: 1, minWidth: 0 }}>
        <p style={{ fontWeight: 600, fontSize: 14, color: 'var(--text)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{player.username}</p>
        <p style={{ fontSize: 12, color: 'var(--text-2)', marginTop: 2 }}>{player.game_name}</p>
      </div>
      <p style={{ fontSize: 13, fontWeight: 600, color: 'var(--green)', fontVariantNumeric: 'tabular-nums', flexShrink: 0 }}>{elapsedSince(player.joined_at, now)}</p>
    </Card>
  )
}

function SectionLabel({ children }: { children: React.ReactNode }) {
  return <p style={{ fontSize: 11, fontWeight: 700, letterSpacing: '0.08em', color: 'var(--text-3)', textTransform: 'uppercase', marginBottom: 12 }}>{children}</p>
}

// ── Main Dashboard ───────────────────────────────────────────────────────────

export default function Dashboard() {
  const [sessions, setSessions]           = useState<Session[]>([])
  const [live, setLive]                   = useState<LivePlayer[]>([])
  const [games, setGames]                 = useState<string[]>([])
  const [selectedGame, setSelectedGame]   = useState('all')
  const [selectedDay, setSelectedDay]     = useState(new Date())
  const [search, setSearch]               = useState('')
  const [now, setNow]                     = useState(new Date())
  const [loading, setLoading]             = useState(true)
  const [renamingGame, setRenamingGame]   = useState<string | null>(null)
  const [renameVal, setRenameVal]         = useState('')
  const [renaming, setRenaming]           = useState(false)
  const renameRef                         = useRef<HTMLInputElement>(null)

  useEffect(() => { const id = setInterval(() => setNow(new Date()), 1000); return () => clearInterval(id) }, [])

  const fetchData = useCallback(async () => {
    const cutoff = new Date(); cutoff.setDate(cutoff.getDate() - 30)
    const [{ data: s }, { data: l }] = await Promise.all([
      supabase.from('sessions').select('*').gte('created_at', cutoff.toISOString()).order('created_at', { ascending: false }).limit(2000),
      supabase.from('live_players').select('*').order('joined_at'),
    ])
    if (s) { setSessions(s); setGames([...new Set(s.map(x => x.game_name))].sort()) }
    if (l) setLive(l)
    setLoading(false)
  }, [])

  useEffect(() => { fetchData() }, [fetchData])

  useEffect(() => {
    const ch = supabase.channel('rt')
      .on('postgres_changes', { event: 'INSERT', schema: 'public', table: 'sessions' }, ({ new: s }) => {
        setSessions(p => [s as Session, ...p])
        setGames(p => p.includes((s as Session).game_name) ? p : [...p, (s as Session).game_name].sort())
      })
      .on('postgres_changes', { event: 'INSERT', schema: 'public', table: 'live_players' }, ({ new: p }) => {
        setLive(prev => prev.find(x => x.user_id === (p as LivePlayer).user_id) ? prev : [...prev, p as LivePlayer])
      })
      .on('postgres_changes', { event: 'DELETE', schema: 'public', table: 'live_players' }, ({ old: p }) => {
        setLive(prev => prev.filter(x => x.user_id !== p.user_id))
      })
      .subscribe()
    return () => { supabase.removeChannel(ch) }
  }, [])

  // Start rename
  const startRename = (game: string) => {
    setRenamingGame(game); setRenameVal(game)
    setTimeout(() => renameRef.current?.focus(), 50)
  }

  // Commit rename
  const commitRename = async () => {
    if (!renamingGame) return
    const newName = renameVal.trim()
    if (!newName || newName === renamingGame) { setRenamingGame(null); return }
    setRenaming(true)
    await Promise.all([
      supabase.from('sessions').update({ game_name: newName }).eq('game_name', renamingGame),
      supabase.from('live_players').update({ game_name: newName }).eq('game_name', renamingGame),
    ])
    setSessions(p => p.map(s => s.game_name === renamingGame ? { ...s, game_name: newName } : s))
    setLive(p => p.map(x => x.game_name === renamingGame ? { ...x, game_name: newName } : x))
    setGames(p => [...new Set(p.map(g => g === renamingGame ? newName : g))].sort())
    if (selectedGame === renamingGame) setSelectedGame(newName)
    setRenamingGame(null); setRenaming(false)
  }

  // Delete game (removes all sessions)
  const deleteGame = async (game: string) => {
    if (!confirm(`Delete all sessions for "${game}"? This cannot be undone.`)) return
    await Promise.all([
      supabase.from('sessions').delete().eq('game_name', game),
      supabase.from('live_players').delete().eq('game_name', game),
    ])
    setSessions(p => p.filter(s => s.game_name !== game))
    setLive(p => p.filter(x => x.game_name !== game))
    setGames(p => p.filter(g => g !== game))
    if (selectedGame === game) setSelectedGame('all')
  }

  // Derived
  const filteredByGame   = useMemo(() => sessions.filter(s => selectedGame === 'all' || s.game_name === selectedGame), [sessions, selectedGame])
  const filteredBySearch = useMemo(() => filteredByGame.filter(s => !search || s.username.toLowerCase().includes(search.toLowerCase())), [filteredByGame, search])
  const dayFiltered      = useMemo(() => filteredByGame.filter(s => sameDay(new Date(s.created_at), selectedDay)), [filteredByGame, selectedDay])
  const liveFiltered     = useMemo(() => live.filter(p => selectedGame === 'all' || p.game_name === selectedGame), [live, selectedGame])
  const todayPlaytime    = useMemo(() => dayFiltered.reduce((a, s) => a + s.session_time, 0), [dayFiltered])
  const uniquePlayers    = useMemo(() => new Set(filteredByGame.map(s => s.user_id)).size, [filteredByGame])
  const hourly           = useMemo(() => buildHourly(filteredByGame, selectedDay), [filteredByGame, selectedDay])
  const isToday          = sameDay(selectedDay, new Date())

  const ChartTip = ({ active, payload, label }: any) => {
    if (!active || !payload?.length) return null
    return (
      <div style={{ background: 'var(--elevated)', border: '1px solid var(--border)', borderRadius: 8, padding: '8px 12px' }}>
        <p style={{ fontSize: 12, color: 'var(--text-2)' }}>{label}</p>
        <p style={{ fontSize: 14, fontWeight: 700, color: 'var(--accent)' }}>{payload[0].value} sessions</p>
      </div>
    )
  }

  if (loading) return (
    <div style={{ minHeight: '100vh', display: 'flex', alignItems: 'center', justifyContent: 'center', background: 'var(--bg)' }}>
      <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 12 }}>
        <div style={{ width: 28, height: 28, borderRadius: '50%', border: '2px solid var(--accent)', borderTopColor: 'transparent', animation: 'spin 0.7s linear infinite' }} />
        <style>{`@keyframes spin{to{transform:rotate(360deg)}}`}</style>
        <p style={{ fontSize: 13, color: 'var(--text-2)' }}>Loading…</p>
      </div>
    </div>
  )

  return (
    <div style={{ minHeight: '100vh', background: 'var(--bg)', padding: '0 0 48px' }}>
      <div style={{ maxWidth: 1100, margin: '0 auto', padding: '0 16px' }}>

        {/* Header */}
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '24px 0 20px' }}>
          <div>
            <h1 style={{ fontSize: 18, fontWeight: 700, color: 'var(--text)' }}>RBLX Dashboard</h1>
            <p style={{ fontSize: 12, color: 'var(--text-3)', marginTop: 2 }}>{games.length} game{games.length !== 1 ? 's' : ''}</p>
          </div>
          <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
            <Dot pulse color="var(--green)" />
            <span style={{ fontSize: 12, fontWeight: 600, color: 'var(--green)' }}>Live</span>
          </div>
        </div>

        {/* Date Nav */}
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 0, marginBottom: 20 }}>
          <button onClick={() => { const d = new Date(selectedDay); d.setDate(d.getDate() - 1); setSelectedDay(d) }}
            style={{ padding: '7px 16px', background: 'var(--surface)', border: '1px solid var(--border)', borderRight: 'none', borderRadius: '8px 0 0 8px', color: 'var(--text-2)', fontSize: 13, cursor: 'pointer' }}>
            ←
          </button>
          <div style={{ padding: '7px 20px', background: 'var(--elevated)', border: '1px solid var(--border)', fontSize: 13, fontWeight: 600, color: 'var(--text)', minWidth: 120, textAlign: 'center' }}>
            {formatDateLabel(selectedDay)}
          </div>
          <button onClick={() => { if (!isToday) { const d = new Date(selectedDay); d.setDate(d.getDate() + 1); setSelectedDay(d) } }}
            style={{ padding: '7px 16px', background: isToday ? 'var(--surface)' : 'var(--surface)', border: '1px solid var(--border)', borderLeft: 'none', borderRadius: '0 8px 8px 0', color: isToday ? 'var(--text-3)' : 'var(--text-2)', fontSize: 13, cursor: isToday ? 'default' : 'pointer', opacity: isToday ? 0.4 : 1 }}>
            →
          </button>
        </div>

        {/* Game Tabs */}
        <div style={{ display: 'flex', gap: 8, overflowX: 'auto', marginBottom: 20, paddingBottom: 4 }} className="scrollbar-hide">
          <button onClick={() => setSelectedGame('all')}
            style={{ padding: '7px 14px', borderRadius: 8, fontSize: 13, fontWeight: 500, cursor: 'pointer', flexShrink: 0, border: '1px solid', transition: 'all 0.15s', background: selectedGame === 'all' ? 'var(--accent)' : 'var(--surface)', color: selectedGame === 'all' ? '#fff' : 'var(--text-2)', borderColor: selectedGame === 'all' ? 'var(--accent)' : 'var(--border)' }}>
            All Games
          </button>
          {games.map(game => (
            <div key={game} style={{ display: 'flex', alignItems: 'center', gap: 0, flexShrink: 0 }}>
              {renamingGame === game ? (
                <div style={{ display: 'flex', alignItems: 'center', gap: 4, background: 'var(--surface)', border: '1px solid var(--accent)', borderRadius: 8, padding: '0 8px', height: 34 }}>
                  <input ref={renameRef} value={renameVal} onChange={e => setRenameVal(e.target.value)}
                    onKeyDown={e => { if (e.key === 'Enter') commitRename(); if (e.key === 'Escape') setRenamingGame(null) }}
                    style={{ background: 'transparent', border: 'none', color: 'var(--text)', fontSize: 13, width: 120 }} />
                  <button onClick={commitRename} disabled={renaming} style={{ color: 'var(--green)', fontSize: 14, cursor: 'pointer', background: 'none', border: 'none', padding: '0 2px' }}>✓</button>
                  <button onClick={() => setRenamingGame(null)} style={{ color: 'var(--text-3)', fontSize: 14, cursor: 'pointer', background: 'none', border: 'none', padding: '0 2px' }}>✕</button>
                </div>
              ) : (
                <div style={{ display: 'flex', alignItems: 'center', background: selectedGame === game ? 'var(--elevated)' : 'var(--surface)', border: `1px solid ${selectedGame === game ? 'var(--border)' : 'var(--border)'}`, borderRadius: 8, overflow: 'hidden' }}>
                  <button onClick={() => setSelectedGame(game)}
                    style={{ padding: '7px 12px', fontSize: 13, fontWeight: 500, cursor: 'pointer', background: 'transparent', border: 'none', color: selectedGame === game ? 'var(--text)' : 'var(--text-2)' }}>
                    {game}
                  </button>
                  <div style={{ display: 'flex', borderLeft: '1px solid var(--border)' }}>
                    <button onClick={() => startRename(game)} title="Rename"
                      style={{ padding: '7px 8px', fontSize: 12, cursor: 'pointer', background: 'transparent', border: 'none', color: 'var(--text-3)' }}>✏️</button>
                    <button onClick={() => deleteGame(game)} title="Delete all sessions"
                      style={{ padding: '7px 8px', fontSize: 12, cursor: 'pointer', background: 'transparent', border: 'none', color: 'var(--text-3)' }}>🗑️</button>
                  </div>
                </div>
              )}
            </div>
          ))}
        </div>

        {/* Stats */}
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(2, 1fr)', gap: 12, marginBottom: 24 }} className="sm:grid-cols-4">
          <StatCard label="Live Now"       value={liveFiltered.length}      sub={liveFiltered.length === 1 ? '1 player in-game' : `${liveFiltered.length} players in-game`} />
          <StatCard label={`${formatDateLabel(selectedDay)}`} value={`${dayFiltered.length} sessions`} sub={fmt(todayPlaytime) + ' total'} />
          <StatCard label="Today Playtime" value={fmt(todayPlaytime)}        sub={dayFiltered.length > 0 ? `avg ${fmt(Math.floor(todayPlaytime / dayFiltered.length))}` : '—'} />
          <StatCard label="Total Players"  value={uniquePlayers}             sub="unique players" />
        </div>

        {/* Live */}
        <div style={{ marginBottom: 28 }}>
          <SectionLabel>Live Now</SectionLabel>
          {liveFiltered.length === 0 ? (
            <Card style={{ padding: '24px', textAlign: 'center' }}>
              <p style={{ color: 'var(--text-3)', fontSize: 13 }}>No players in-game</p>
            </Card>
          ) : (
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(260px, 1fr))', gap: 8 }}>
              {liveFiltered.map(p => <LiveCard key={p.user_id} player={p} now={now} />)}
            </div>
          )}
        </div>

        {/* Chart */}
        <div style={{ marginBottom: 28 }}>
          <SectionLabel>Sessions by Hour — {formatDateLabel(selectedDay)}</SectionLabel>
          <Card style={{ padding: '16px 16px 8px' }}>
            {dayFiltered.length === 0 ? (
              <div style={{ height: 120, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                <p style={{ color: 'var(--text-3)', fontSize: 13 }}>No sessions on this day</p>
              </div>
            ) : (
              <ResponsiveContainer width="100%" height={140}>
                <BarChart data={hourly} barSize={6}>
                  <XAxis dataKey="h" tick={{ fill: 'var(--text-3)', fontSize: 10 }} axisLine={false} tickLine={false} interval={2} />
                  <YAxis hide allowDecimals={false} />
                  <Tooltip content={<ChartTip />} cursor={{ fill: 'rgba(96,165,250,0.06)' }} />
                  <Bar dataKey="n" radius={[3, 3, 0, 0]}>
                    {hourly.map((e, i) => <Cell key={i} fill={e.n > 0 ? 'var(--accent)' : 'var(--border)'} />)}
                  </Bar>
                </BarChart>
              </ResponsiveContainer>
            )}
          </Card>
        </div>

        {/* Session Table */}
        <div>
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 12, flexWrap: 'wrap', gap: 8 }}>
            <SectionLabel>Session History</SectionLabel>
            <input value={search} onChange={e => setSearch(e.target.value)} placeholder="Search player…"
              style={{ padding: '7px 12px', borderRadius: 8, background: 'var(--surface)', border: '1px solid var(--border)', color: 'var(--text)', fontSize: 13, width: 180 }} />
          </div>
          <Card>
            <div style={{ overflowX: 'auto' }}>
              <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 13 }}>
                <thead>
                  <tr style={{ borderBottom: '1px solid var(--border)' }}>
                    {['Player', 'Game', 'Session', 'Total', '#', 'When'].map((h, i) => (
                      <th key={h} style={{ padding: '11px 16px', textAlign: i === 5 ? 'right' : 'left', fontSize: 11, fontWeight: 700, letterSpacing: '0.06em', color: 'var(--text-3)', textTransform: 'uppercase',
                        display: i === 1 ? undefined : i === 3 ? undefined : i === 4 ? undefined : undefined }}>
                        {h}
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {filteredBySearch.length === 0 ? (
                    <tr><td colSpan={6} style={{ padding: '40px', textAlign: 'center', color: 'var(--text-3)', fontSize: 13 }}>
                      {search ? `No results for "${search}"` : 'No sessions recorded yet'}
                    </td></tr>
                  ) : filteredBySearch.slice(0, 100).map(s => (
                    <tr key={s.id} style={{ borderBottom: '1px solid var(--border)' }}>
                      <td style={{ padding: '11px 16px', fontWeight: 600, color: 'var(--text)' }}>{s.username}</td>
                      <td style={{ padding: '11px 16px' }}>
                        <span style={{ padding: '2px 8px', borderRadius: 5, background: 'var(--elevated)', color: 'var(--text-2)', fontSize: 12, fontWeight: 500 }}>{s.game_name}</span>
                      </td>
                      <td style={{ padding: '11px 16px', color: 'var(--text)', fontVariantNumeric: 'tabular-nums' }}>{fmt(s.session_time)}</td>
                      <td style={{ padding: '11px 16px', color: 'var(--text-2)', fontVariantNumeric: 'tabular-nums' }}>{fmt(s.total_time)}</td>
                      <td style={{ padding: '11px 16px', color: 'var(--text-3)' }}>#{s.session_count}</td>
                      <td style={{ padding: '11px 16px', color: 'var(--text-3)', textAlign: 'right' }}>{timeAgo(s.created_at)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            {filteredBySearch.length > 100 && (
              <div style={{ padding: '12px', textAlign: 'center', borderTop: '1px solid var(--border)' }}>
                <p style={{ fontSize: 12, color: 'var(--text-3)' }}>Showing 100 of {filteredBySearch.length} sessions</p>
              </div>
            )}
          </Card>
        </div>

      </div>
    </div>
  )
}
