'use client'

import { useEffect, useState, useCallback, useMemo } from 'react'
import { supabase, type Session, type LivePlayer } from '@/lib/supabase'
import {
  BarChart, Bar, XAxis, YAxis, Tooltip, ResponsiveContainer, Cell,
} from 'recharts'

// ── Helpers ─────────────────────────────────────────────────────────────────

function fmt(seconds: number): string {
  seconds = Math.floor(seconds)
  const h = Math.floor(seconds / 3600)
  const m = Math.floor((seconds % 3600) / 60)
  const s = seconds % 60
  if (h > 0) return `${h}h ${m}m ${s}s`
  if (m > 0) return `${m}m ${s}s`
  return `${s}s`
}

function elapsed(joinedAt: string, now: Date): string {
  const secs = Math.floor((now.getTime() - new Date(joinedAt).getTime()) / 1000)
  return fmt(Math.max(0, secs))
}

function timeAgo(dateStr: string): string {
  const diff = Math.floor((Date.now() - new Date(dateStr).getTime()) / 1000)
  if (diff < 60)   return `${diff}s ago`
  if (diff < 3600) return `${Math.floor(diff / 60)}m ago`
  if (diff < 86400) return `${Math.floor(diff / 3600)}h ago`
  return new Date(dateStr).toLocaleDateString()
}

function isToday(dateStr: string): boolean {
  const d = new Date(dateStr)
  const t = new Date()
  return d.getDate() === t.getDate() && d.getMonth() === t.getMonth() && d.getFullYear() === t.getFullYear()
}

function buildHourlyData(sessions: Session[]) {
  const bins = Array.from({ length: 24 }, (_, i) => ({
    hour: i === 0 ? '12a' : i < 12 ? `${i}a` : i === 12 ? '12p' : `${i - 12}p`,
    sessions: 0,
  }))
  sessions.filter(s => isToday(s.created_at)).forEach(s => {
    bins[new Date(s.created_at).getHours()].sessions++
  })
  return bins
}

// ── Sub-components ───────────────────────────────────────────────────────────

function StatCard({ icon, label, value, accent = false }: {
  icon: string; label: string; value: string | number; accent?: boolean
}) {
  return (
    <div style={{ background: '#0e0e1c', border: '1px solid #1a1a2e' }}
      className="rounded-xl p-4 flex flex-col gap-1">
      <span className="text-xl">{icon}</span>
      <span className="text-xs uppercase tracking-widest" style={{ color: '#7c7c9a' }}>{label}</span>
      <span
        className="text-2xl font-mono font-bold"
        style={{ color: accent ? '#10b981' : '#f1f1ff' }}>
        {value}
      </span>
    </div>
  )
}

function LiveRow({ player, now }: { player: LivePlayer; now: Date }) {
  return (
    <div style={{ background: '#0e0e1c', border: '1px solid #1a1a2e' }}
      className="rounded-xl p-3 flex items-center gap-3">
      <span className="relative flex h-2.5 w-2.5 shrink-0">
        <span className="animate-ping absolute inline-flex h-full w-full rounded-full opacity-75"
          style={{ background: '#10b981' }} />
        <span className="relative inline-flex rounded-full h-2.5 w-2.5"
          style={{ background: '#10b981' }} />
      </span>
      <div className="flex-1 min-w-0">
        <p className="font-mono font-semibold truncate" style={{ color: '#f1f1ff' }}>
          {player.username}
        </p>
        <p className="text-xs truncate" style={{ color: '#7c7c9a' }}>{player.game_name}</p>
      </div>
      <span className="font-mono text-sm tabular-nums shrink-0" style={{ color: '#10b981' }}>
        {elapsed(player.joined_at, now)}
      </span>
    </div>
  )
}

function SessionRow({ session }: { session: Session }) {
  return (
    <tr className="border-b" style={{ borderColor: '#1a1a2e' }}>
      <td className="py-3 px-3">
        <span className="font-mono text-sm font-medium" style={{ color: '#f1f1ff' }}>
          {session.username}
        </span>
      </td>
      <td className="py-3 px-3 hidden sm:table-cell">
        <span className="text-xs px-2 py-0.5 rounded-full font-medium"
          style={{ background: '#1a1a2e', color: '#a5a5c0' }}>
          {session.game_name}
        </span>
      </td>
      <td className="py-3 px-3">
        <span className="font-mono text-sm" style={{ color: '#f1f1ff' }}>
          {fmt(session.session_time)}
        </span>
      </td>
      <td className="py-3 px-3 hidden md:table-cell">
        <span className="font-mono text-sm" style={{ color: '#7c7c9a' }}>
          {fmt(session.total_time)}
        </span>
      </td>
      <td className="py-3 px-3 hidden lg:table-cell">
        <span className="font-mono text-sm" style={{ color: '#7c7c9a' }}>
          #{session.session_count}
        </span>
      </td>
      <td className="py-3 px-3 text-right">
        <span className="text-xs" style={{ color: '#5a5a7a' }}>{timeAgo(session.created_at)}</span>
      </td>
    </tr>
  )
}

// ── Main Dashboard ───────────────────────────────────────────────────────────

export default function Dashboard() {
  const [sessions, setSessions]         = useState<Session[]>([])
  const [livePlayers, setLivePlayers]   = useState<LivePlayer[]>([])
  const [games, setGames]               = useState<string[]>([])
  const [selectedGame, setSelectedGame] = useState('all')
  const [search, setSearch]             = useState('')
  const [now, setNow]                   = useState(new Date())
  const [loading, setLoading]           = useState(true)

  // Tick clock for live timers
  useEffect(() => {
    const id = setInterval(() => setNow(new Date()), 1000)
    return () => clearInterval(id)
  }, [])

  // Fetch initial data
  const fetchData = useCallback(async () => {
    const [{ data: sessionData }, { data: liveData }] = await Promise.all([
      supabase.from('sessions').select('*').order('created_at', { ascending: false }).limit(200),
      supabase.from('live_players').select('*').order('joined_at', { ascending: true }),
    ])
    if (sessionData) {
      setSessions(sessionData)
      const uniqueGames = [...new Set(sessionData.map(s => s.game_name))].sort()
      setGames(uniqueGames)
    }
    if (liveData) setLivePlayers(liveData)
    setLoading(false)
  }, [])

  useEffect(() => { fetchData() }, [fetchData])

  // Realtime subscriptions
  useEffect(() => {
    const channel = supabase
      .channel('dashboard-realtime')
      .on('postgres_changes', { event: 'INSERT', schema: 'public', table: 'sessions' }, payload => {
        const s = payload.new as Session
        setSessions(prev => [s, ...prev])
        setGames(prev => prev.includes(s.game_name) ? prev : [...prev, s.game_name].sort())
      })
      .on('postgres_changes', { event: 'INSERT', schema: 'public', table: 'live_players' }, payload => {
        setLivePlayers(prev => {
          const exists = prev.find(p => p.user_id === (payload.new as LivePlayer).user_id)
          return exists ? prev : [...prev, payload.new as LivePlayer]
        })
      })
      .on('postgres_changes', { event: 'DELETE', schema: 'public', table: 'live_players' }, payload => {
        setLivePlayers(prev => prev.filter(p => p.user_id !== payload.old.user_id))
      })
      .subscribe()

    return () => { supabase.removeChannel(channel) }
  }, [])

  // Derived data
  const filteredSessions = useMemo(() => {
    return sessions
      .filter(s => selectedGame === 'all' || s.game_name === selectedGame)
      .filter(s => !search || s.username.toLowerCase().includes(search.toLowerCase()))
  }, [sessions, selectedGame, search])

  const filteredLive = useMemo(() => {
    return livePlayers.filter(p => selectedGame === 'all' || p.game_name === selectedGame)
  }, [livePlayers, selectedGame])

  const todaySessions = useMemo(() => filteredSessions.filter(s => isToday(s.created_at)), [filteredSessions])
  const todayPlaytime = useMemo(() => todaySessions.reduce((acc, s) => acc + s.session_time, 0), [todaySessions])
  const uniquePlayers = useMemo(() => new Set(filteredSessions.map(s => s.user_id)).size, [filteredSessions])
  const hourlyData    = useMemo(() => buildHourlyData(filteredSessions), [filteredSessions])

  const CustomTooltip = ({ active, payload, label }: any) => {
    if (!active || !payload?.length) return null
    return (
      <div style={{ background: '#0e0e1c', border: '1px solid #1a1a2e', padding: '8px 12px', borderRadius: 8 }}>
        <p style={{ color: '#7c7c9a', fontSize: 12 }}>{label}</p>
        <p style={{ color: '#6366f1', fontFamily: 'monospace', fontWeight: 700 }}>
          {payload[0].value} sessions
        </p>
      </div>
    )
  }

  if (loading) {
    return (
      <div className="min-h-screen flex items-center justify-center" style={{ background: '#07070f' }}>
        <div className="flex flex-col items-center gap-3">
          <div className="w-8 h-8 rounded-full border-2 border-t-transparent animate-spin"
            style={{ borderColor: '#6366f1', borderTopColor: 'transparent' }} />
          <span style={{ color: '#7c7c9a', fontFamily: 'monospace', fontSize: 13 }}>Loading dashboard…</span>
        </div>
      </div>
    )
  }

  return (
    <div className="min-h-screen" style={{ background: '#07070f', color: '#f1f1ff' }}>
      <div className="max-w-6xl mx-auto px-4 py-6 space-y-6">

        {/* ── Header ── */}
        <div className="flex items-center justify-between">
          <div>
            <h1 className="text-xl font-bold tracking-tight" style={{ color: '#f1f1ff' }}>
              ⬡ RBLX Dashboard
            </h1>
            <p className="text-xs mt-0.5" style={{ color: '#5a5a7a' }}>
              {games.length} game{games.length !== 1 ? 's' : ''} · live updates
            </p>
          </div>
          <div className="flex items-center gap-1.5">
            <span className="relative flex h-2 w-2">
              <span className="animate-ping absolute inline-flex h-full w-full rounded-full opacity-75"
                style={{ background: '#10b981' }} />
              <span className="relative inline-flex rounded-full h-2 w-2"
                style={{ background: '#10b981' }} />
            </span>
            <span className="text-xs" style={{ color: '#10b981' }}>Live</span>
          </div>
        </div>

        {/* ── Game Tabs ── */}
        <div className="flex gap-2 overflow-x-auto pb-1 scrollbar-hide">
          {['all', ...games].map(game => (
            <button
              key={game}
              onClick={() => setSelectedGame(game)}
              className="shrink-0 px-3 py-1.5 rounded-lg text-sm font-medium transition-all duration-150"
              style={{
                background: selectedGame === game ? '#6366f1' : '#0e0e1c',
                color: selectedGame === game ? '#fff' : '#7c7c9a',
                border: `1px solid ${selectedGame === game ? '#6366f1' : '#1a1a2e'}`,
              }}>
              {game === 'all' ? 'All Games' : game}
            </button>
          ))}
        </div>

        {/* ── Stats Cards ── */}
        <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
          <StatCard icon="🟢" label="Live Now"      value={filteredLive.length} accent />
          <StatCard icon="📊" label="Today"         value={`${todaySessions.length} sessions`} />
          <StatCard icon="⏱️" label="Today Playtime" value={fmt(todayPlaytime)} />
          <StatCard icon="👥" label="Total Players"  value={uniquePlayers} />
        </div>

        {/* ── Live Players ── */}
        <section>
          <h2 className="text-xs uppercase tracking-widest mb-3 font-semibold"
            style={{ color: '#5a5a7a' }}>
            Live Now
          </h2>
          {filteredLive.length === 0 ? (
            <div style={{ background: '#0e0e1c', border: '1px solid #1a1a2e' }}
              className="rounded-xl p-6 text-center">
              <p style={{ color: '#3a3a5a' }} className="font-mono text-sm">No players in-game</p>
            </div>
          ) : (
            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-2">
              {filteredLive.map(p => <LiveRow key={p.user_id} player={p} now={now} />)}
            </div>
          )}
        </section>

        {/* ── Hourly Chart ── */}
        <section>
          <h2 className="text-xs uppercase tracking-widest mb-3 font-semibold"
            style={{ color: '#5a5a7a' }}>
            Sessions Today by Hour
          </h2>
          <div style={{ background: '#0e0e1c', border: '1px solid #1a1a2e' }}
            className="rounded-xl p-4">
            {todaySessions.length === 0 ? (
              <div className="h-32 flex items-center justify-center">
                <p style={{ color: '#3a3a5a' }} className="font-mono text-sm">No sessions today yet</p>
              </div>
            ) : (
              <ResponsiveContainer width="100%" height={160}>
                <BarChart data={hourlyData} barSize={8}>
                  <XAxis
                    dataKey="hour"
                    tick={{ fill: '#5a5a7a', fontSize: 10, fontFamily: 'monospace' }}
                    axisLine={false} tickLine={false}
                    interval={2}
                  />
                  <YAxis hide allowDecimals={false} />
                  <Tooltip content={<CustomTooltip />} cursor={{ fill: 'rgba(99,102,241,0.08)' }} />
                  <Bar dataKey="sessions" radius={[4, 4, 0, 0]}>
                    {hourlyData.map((entry, i) => (
                      <Cell key={i}
                        fill={entry.sessions > 0 ? '#6366f1' : '#1a1a2e'}
                      />
                    ))}
                  </Bar>
                </BarChart>
              </ResponsiveContainer>
            )}
          </div>
        </section>

        {/* ── Sessions Table ── */}
        <section>
          <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 mb-3">
            <h2 className="text-xs uppercase tracking-widest font-semibold"
              style={{ color: '#5a5a7a' }}>
              Session History
            </h2>
            <input
              type="text"
              placeholder="Search player…"
              value={search}
              onChange={e => setSearch(e.target.value)}
              className="w-full sm:w-48 px-3 py-1.5 rounded-lg text-sm outline-none transition-all"
              style={{
                background: '#0e0e1c',
                border: '1px solid #1a1a2e',
                color: '#f1f1ff',
                fontFamily: 'monospace',
              }}
            />
          </div>

          <div style={{ background: '#0e0e1c', border: '1px solid #1a1a2e' }}
            className="rounded-xl overflow-hidden">
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr style={{ borderBottom: '1px solid #1a1a2e' }}>
                    {['Player', 'Game', 'Session', 'Total', '#', 'When'].map((h, i) => (
                      <th key={h}
                        className={`py-3 px-3 text-left text-xs uppercase tracking-wider font-medium
                          ${i === 1 ? 'hidden sm:table-cell' : ''}
                          ${i === 3 ? 'hidden md:table-cell' : ''}
                          ${i === 4 ? 'hidden lg:table-cell' : ''}
                          ${i === 5 ? 'text-right' : ''}
                        `}
                        style={{ color: '#5a5a7a' }}>
                        {h}
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {filteredSessions.length === 0 ? (
                    <tr>
                      <td colSpan={6} className="py-12 text-center"
                        style={{ color: '#3a3a5a', fontFamily: 'monospace', fontSize: 13 }}>
                        {search ? `No sessions matching "${search}"` : 'No sessions recorded yet'}
                      </td>
                    </tr>
                  ) : (
                    filteredSessions.slice(0, 100).map(s => <SessionRow key={s.id} session={s} />)
                  )}
                </tbody>
              </table>
            </div>
            {filteredSessions.length > 100 && (
              <div className="py-3 text-center border-t" style={{ borderColor: '#1a1a2e' }}>
                <span className="text-xs" style={{ color: '#5a5a7a' }}>
                  Showing 100 of {filteredSessions.length} sessions
                </span>
              </div>
            )}
          </div>
        </section>

      </div>
    </div>
  )
}
