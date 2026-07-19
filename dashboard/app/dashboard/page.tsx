'use client'

import { useEffect, useState, useCallback, useMemo, useRef } from 'react'
import { supabase, type Session, type LivePlayer } from '@/lib/supabase'
import { BarChart, Bar, XAxis, YAxis, Tooltip, ResponsiveContainer, Cell } from 'recharts'

const V='v3.2'
const BG='#111111',SURFACE='#1c1c1c',ELEV='#242424',BORDER='#2e2e2e'
const ACCENT='#60a5fa',GREEN='#4ade80',TEXT='#f0f0f0',TEXT2='#888',TEXT3='#444'
const TZ='America/New_York' // EST/EDT — all date comparisons use this

type SortKey = 'when'|'session'|'total'|'player'|'count'
type SortDir = 'asc'|'desc'
type View    = 'sessions'|'players'
type PSortKey= 'name'|'total'|'sessions'|'avg'|'last'

type PlayerRow = {
  username: string
  totalTime: number
  sessions: number
  avg: number
  last: string
  games: string[]
}

function fmt(s:number){
  s=Math.floor(s);const h=Math.floor(s/3600),m=Math.floor((s%3600)/60),sec=s%60
  if(h>0)return`${h}h ${m}m ${sec}s`;if(m>0)return`${m}m ${sec}s`;return`${sec}s`
}
function elapsedSince(d:string,now:Date){return fmt(Math.max(0,Math.floor((now.getTime()-new Date(d).getTime())/1000)))}
function timeAgo(d:string){
  const s=Math.floor((Date.now()-new Date(d).getTime())/1000)
  if(s<60)return`${s}s ago`;if(s<3600)return`${Math.floor(s/60)}m ago`
  if(s<86400)return`${Math.floor(s/3600)}h ago`
  return new Date(d).toLocaleDateString('en-US',{timeZone:TZ})
}
// Convert date to YYYY-MM-DD string in EST/EDT
function toESTDay(d:Date):string{
  return new Intl.DateTimeFormat('en-CA',{timeZone:TZ,year:'numeric',month:'2-digit',day:'2-digit'}).format(d)
}
function sameDay(a:Date,b:Date){return toESTDay(a)===toESTDay(b)}
function dayLabel(d:Date){
  const t=new Date(),y=new Date();y.setDate(t.getDate()-1)
  if(sameDay(d,t))return'Today';if(sameDay(d,y))return'Yesterday'
  return d.toLocaleDateString('en-US',{timeZone:TZ,weekday:'short',month:'short',day:'numeric'})
}
function buildHourly(sessions:Session[],day:Date){
  const bins=Array.from({length:24},(_,i)=>({h:i===0?'12a':i<12?`${i}a`:i===12?'12p':`${i-12}p`,n:0}))
  sessions.filter(s=>sameDay(new Date(s.created_at),day)).forEach(s=>{
    const hr=parseInt(new Intl.DateTimeFormat('en-US',{timeZone:TZ,hour:'numeric',hour12:false}).format(new Date(s.created_at)))
    bins[hr%24].n++
  })
  return bins
}

export default function Dashboard(){
  const[sessions,setSessions]         =useState<Session[]>([])
  const[live,setLive]                 =useState<LivePlayer[]>([])
  const[aliases,setAliases]           =useState<Record<string,string>>({})
  const[game,setGame]                 =useState('all')
  const[day,setDay]                   =useState(new Date())
  const[search,setSearch]             =useState('')
  const[sortBy,setSortBy]             =useState<SortKey>('when')
  const[sortDir,setSortDir]           =useState<SortDir>('desc')
  const[view,setView]                 =useState<View>('sessions')
  const[pSortBy,setPSortBy]           =useState<PSortKey>('total')
  const[pSortDir,setPSortDir]         =useState<SortDir>('desc')
  const[now,setNow]                   =useState(new Date())
  const[loading,setLoading]           =useState(true)
  const[dayLoading,setDayLoading]     =useState(true)
  const[lbLoading,setLbLoading]       =useState(false)
  const[rawGames,setRawGames]         =useState<string[]>([])
  const[lbRows,setLbRows]             =useState<PlayerRow[]>([])
  const[renamingGame,setRenamingGame] =useState<string|null>(null)
  const[renameVal,setRenameVal]       =useState('')
  const[saving,setSaving]             =useState(false)
  const renameRef                     =useRef<HTMLInputElement>(null)
  const dayRef                        =useRef(day)
  useEffect(()=>{dayRef.current=day},[day])

  useEffect(()=>{const id=setInterval(()=>setNow(new Date()),1000);return()=>clearInterval(id)},[])

  const display=(raw:string)=>aliases[raw]||raw
  const rawsFor=(dn:string):string[]=>{
    const a=Object.entries(aliases).filter(([,v])=>v===dn).map(([k])=>k)
    return a.length>0?a:[dn]
  }

  // Fetch only the selected day's sessions (EST day boundaries -> UTC range)
  const fetchDaySessions=async(d:Date):Promise<Session[]>=>{
    // Build EST midnight-to-midnight window
    const ymd=toESTDay(d)
    const start=new Date(`${ymd}T00:00:00-05:00`)
    const end=new Date(start.getTime()+24*60*60*1000)
    const all:Session[]=[]
    const PAGE=1000
    for(let from=0;from<10000;from+=PAGE){
      const{data,error}=await supabase
        .from('sessions').select('*')
        .gte('created_at',start.toISOString())
        .lt('created_at',end.toISOString())
        .order('created_at',{ascending:false})
        .range(from,from+PAGE-1)
      if(error||!data||data.length===0)break
      all.push(...data)
      if(data.length<PAGE)break
    }
    return all
  }

  // Initial load: live players, aliases, game list (all tiny)
  const load=useCallback(async()=>{
    const[{data:l},{data:a},{data:g}]=await Promise.all([
      supabase.from('live_players').select('*').order('joined_at'),
      supabase.from('game_aliases').select('*'),
      supabase.rpc('get_distinct_games'),
    ])
    if(l) setLive(l)
    if(a){const map:Record<string,string>={};a.forEach((r:any)=>{map[r.raw_name]=r.display_name});setAliases(map)}
    if(g) setRawGames(g.map((r:any)=>r.game_name))
    setLoading(false)
  },[])

  useEffect(()=>{load()},[load])

  // Re-fetch sessions whenever the selected day changes
  useEffect(()=>{
    let cancelled=false
    setDayLoading(true)
    fetchDaySessions(day).then(rows=>{
      if(!cancelled){setSessions(rows);setDayLoading(false)}
    })
    return()=>{cancelled=true}
  },[day])

  useEffect(()=>{
    const ch=supabase.channel('rt')
      .on('postgres_changes',{event:'INSERT',schema:'public',table:'sessions'},({new:s})=>{
        const row=s as Session
        setSessions(p=>sameDay(new Date(row.created_at),dayRef.current)?[row,...p]:p)
        setRawGames(p=>p.includes(row.game_name)?p:[...p,row.game_name])
      })
      .on('postgres_changes',{event:'INSERT',schema:'public',table:'live_players'},({new:p})=>{
        setLive(prev=>prev.find(x=>x.user_id===(p as LivePlayer).user_id)?prev:[...prev,p as LivePlayer])
      })
      .on('postgres_changes',{event:'DELETE',schema:'public',table:'live_players'},({old:p})=>{
        setLive(prev=>prev.filter(x=>x.user_id!==p.user_id))
      })
      .subscribe()
    return()=>{supabase.removeChannel(ch)}
  },[])

  const games=useMemo(()=>[...new Set(rawGames.map(display))].sort(),[rawGames,aliases])

  const startRename=(g:string)=>{setRenamingGame(g);setRenameVal(g);setTimeout(()=>renameRef.current?.focus(),50)}
  const cancelRename=()=>setRenamingGame(null)
  const commitRename=async()=>{
    if(!renamingGame)return
    const n=renameVal.trim()
    if(!n||n===renamingGame){cancelRename();return}
    setSaving(true)
    const raws=rawsFor(renamingGame)
    await Promise.all(raws.map(r=>supabase.from('game_aliases').upsert({raw_name:r,display_name:n})))
    setAliases(prev=>{const next={...prev};raws.forEach(r=>{next[r]=n});return next})
    if(game===renamingGame)setGame(n)
    setRenamingGame(null);setSaving(false)
  }
  const deleteGame=async(g:string)=>{
    if(!confirm(`Delete all data for "${g}"? This cannot be undone.`))return
    const raws=rawsFor(g)
    await Promise.all([
      ...raws.map(r=>supabase.from('sessions').delete().eq('game_name',r)),
      ...raws.map(r=>supabase.from('live_players').delete().eq('game_name',r)),
      ...raws.map(r=>supabase.from('game_aliases').delete().eq('raw_name',r)),
    ])
    setSessions(p=>p.filter(s=>!raws.includes(s.game_name)))
    setLive(p=>p.filter(x=>!raws.includes(x.game_name)))
    setAliases(prev=>{const next={...prev};raws.forEach(r=>delete next[r]);return next})
    if(game===g)setGame('all')
  }

  // Sort toggle
  const toggleSort=(key:SortKey)=>{
    if(sortBy===key)setSortDir(d=>d==='desc'?'asc':'desc')
    else{setSortBy(key);setSortDir('desc')}
  }
  const sortIcon=(key:SortKey)=>sortBy===key?(sortDir==='desc'?'↓':'↑'):'↕'

  const isToday   =sameDay(day,new Date())
  const byGame    =useMemo(()=>sessions.filter(s=>game==='all'||display(s.game_name)===game),[sessions,game,aliases])
  const byDay     =byGame // sessions are already scoped to the selected day
  const liveShow  =useMemo(()=>live.filter(p=>game==='all'||display(p.game_name)===game),[live,game,aliases])
  const playtime  =useMemo(()=>byDay.reduce((a,s)=>a+s.session_time,0),[byDay])
  const players   =useMemo(()=>new Set(byDay.map(s=>s.username)).size,[byDay])
  const hourly    =useMemo(()=>buildHourly(byGame,day),[byGame,day])
  const avgSession=byDay.length>0?Math.floor(playtime/byDay.length):0

  const sorted=useMemo(()=>{
    const filtered=byDay.filter(s=>!search||s.username.toLowerCase().includes(search.toLowerCase()))
    return[...filtered].sort((a,b)=>{
      let diff=0
      if(sortBy==='session') diff=a.session_time-b.session_time
      else if(sortBy==='total') diff=a.total_time-b.total_time
      else if(sortBy==='player') diff=a.username.localeCompare(b.username)
      else if(sortBy==='count') diff=a.session_count-b.session_count
      else diff=new Date(a.created_at).getTime()-new Date(b.created_at).getTime()
      return sortDir==='desc'?-diff:diff
    })
  },[byDay,search,sortBy,sortDir])

  // ── Player leaderboard — aggregated server-side via RPC ──────────────────
  useEffect(()=>{
    if(view!=='players')return
    let cancelled=false
    setLbLoading(true)
    const p_games = game==='all' ? null : rawsFor(game)
    supabase.rpc('get_player_leaderboard',{p_games,p_days:30}).then(({data})=>{
      if(cancelled)return
      setLbRows((data||[]).map((r:any)=>({
        username:r.username,
        totalTime:Number(r.total_time),
        sessions:Number(r.sessions),
        avg:Number(r.avg_time),
        last:r.last_seen,
        games:[],
      })))
      setLbLoading(false)
    })
    return()=>{cancelled=true}
  },[view,game,aliases])

  const playerSorted=useMemo(()=>{
    const filtered=lbRows.filter(r=>!search||r.username.toLowerCase().includes(search.toLowerCase()))
    return[...filtered].sort((a,b)=>{
      let diff=0
      if(pSortBy==='name')          diff=a.username.localeCompare(b.username)
      else if(pSortBy==='sessions') diff=a.sessions-b.sessions
      else if(pSortBy==='avg')      diff=a.avg-b.avg
      else if(pSortBy==='last')     diff=new Date(a.last).getTime()-new Date(b.last).getTime()
      else                          diff=a.totalTime-b.totalTime
      return pSortDir==='desc'?-diff:diff
    })
  },[lbRows,search,pSortBy,pSortDir])

  const togglePSort=(k:PSortKey)=>{
    if(pSortBy===k)setPSortDir(d=>d==='desc'?'asc':'desc')
    else{setPSortBy(k);setPSortDir('desc')}
  }
  const pSortIcon=(k:PSortKey)=>pSortBy===k?(pSortDir==='desc'?'↓':'↑'):'↕'

  const medal=(i:number)=>i===0?'🥇':i===1?'🥈':i===2?'🥉':`${i+1}`

  const ChartTip=({active,payload,label}:any)=>{
    if(!active||!payload?.length)return null
    return<div style={{background:ELEV,border:`1px solid ${BORDER}`,borderRadius:8,padding:'8px 12px'}}>
      <p style={{fontSize:11,color:TEXT2}}>{label}</p>
      <p style={{fontSize:15,fontWeight:700,color:ACCENT}}>{payload[0].value}</p>
    </div>
  }

  // Column header button
  const ColHeader=({label,sortKey,align='left',hideSm=false}:{label:string;sortKey?:SortKey;align?:string;hideSm?:boolean})=>(
    <th className={hideSm?'hide-sm':''}
      style={{textAlign:align as any,color:sortKey&&sortBy===sortKey?ACCENT:TEXT3,cursor:sortKey?'pointer':'default'}}
      onClick={()=>sortKey&&toggleSort(sortKey)}>
      {label}{sortKey&&<span style={{marginLeft:4,opacity:0.6}}>{sortIcon(sortKey)}</span>}
    </th>
  )

  if(loading)return(
    <div style={{minHeight:'100vh',display:'flex',alignItems:'center',justifyContent:'center',background:BG}}>
      <p style={{color:TEXT2,fontSize:14}}>Loading…</p>
    </div>
  )

  return(
    <div style={{minHeight:'100vh',background:BG,color:TEXT,fontFamily:"'Inter',system-ui,sans-serif"}}>
      <style>{`
        @keyframes ping{75%,100%{transform:scale(2);opacity:0}}

        .wrap{max-width:1100px;margin:0 auto;padding:24px 16px 64px}

        /* Stat cards */
        .stat-grid{display:grid;grid-template-columns:repeat(4,1fr);gap:12px;margin-bottom:28px}
        .stat-card{background:${SURFACE};border:1px solid ${BORDER};border-radius:12px;padding:16px 18px;min-width:0}
        .stat-label{font-size:11px;font-weight:700;letter-spacing:.07em;color:${TEXT3};text-transform:uppercase;margin-bottom:8px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
        .stat-val{font-size:26px;font-weight:700;color:${TEXT};line-height:1.1;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
        .stat-sub{font-size:12px;color:${TEXT3};margin-top:5px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}

        /* Live player cards */
        .live-grid{display:grid;grid-template-columns:repeat(auto-fill,minmax(250px,1fr));gap:8px}
        .live-card{background:${SURFACE};border:1px solid ${BORDER};border-radius:12px;padding:12px 14px;display:flex;align-items:center;gap:10px;min-width:0}
        .live-name{font-weight:600;font-size:14px;color:${TEXT};overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
        .live-game{font-size:12px;color:${TEXT2};margin-top:2px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
        .live-time{font-size:13px;font-weight:600;color:${GREEN};flex-shrink:0;font-variant-numeric:tabular-nums}

        /* Section labels */
        .sec{font-size:11px;font-weight:700;letter-spacing:.08em;color:${TEXT3};text-transform:uppercase;margin-bottom:12px}

        /* Game tabs */
        .tabs{display:flex;gap:8px;overflow-x:auto;margin-bottom:24px;padding-bottom:4px;-ms-overflow-style:none;scrollbar-width:none}
        .tabs::-webkit-scrollbar{display:none}

        /* Table */
        .tbl{width:100%;border-collapse:collapse;font-size:13px}
        .tbl th{padding:11px 14px;font-size:11px;font-weight:700;letter-spacing:.06em;text-transform:uppercase;white-space:nowrap;user-select:none}
        .tbl td{padding:11px 14px;white-space:nowrap}
        .num{font-variant-numeric:tabular-nums}

        /* ── Mobile ── */
        @media (max-width:640px){
          .wrap{padding:16px 12px 48px}
          .stat-grid{grid-template-columns:repeat(2,1fr);gap:8px;margin-bottom:20px}
          .stat-card{padding:12px 12px}
          .stat-label{font-size:9px;letter-spacing:.06em;margin-bottom:5px}
          .stat-val{font-size:19px}
          .stat-sub{font-size:10px;margin-top:3px}
          .live-grid{grid-template-columns:1fr;gap:6px}
          .live-card{padding:10px 12px}
          .live-name{font-size:13px}
          .live-game{font-size:11px}
          .live-time{font-size:12px}
          .sec{font-size:10px;margin-bottom:8px}
          .tabs{gap:6px;margin-bottom:18px}
          .tbl{font-size:12px}
          .tbl th{padding:9px 10px;font-size:9px}
          .tbl td{padding:9px 10px}
          /* Hide low-value columns on phones */
          .hide-sm{display:none}
        }
      `}</style>
      <div className="wrap">

        {/* Header */}
        <div style={{display:'flex',alignItems:'flex-start',justifyContent:'space-between',marginBottom:24}}>
          <div>
            <div style={{display:'flex',alignItems:'center',gap:10}}>
              <h1 style={{fontSize:20,fontWeight:700,color:TEXT}}>RBLX Dashboard</h1>
              <span style={{fontSize:10,fontWeight:700,padding:'2px 7px',borderRadius:20,background:ELEV,color:TEXT3,letterSpacing:'0.05em'}}>{V}</span>
            </div>
            <p style={{fontSize:12,color:TEXT3,marginTop:3}}>{games.length} game{games.length!==1?'s':''}</p>
          </div>
          <div style={{display:'flex',alignItems:'center',gap:6,padding:'6px 12px',borderRadius:20,background:SURFACE,border:`1px solid ${BORDER}`}}>
            <span style={{position:'relative',display:'inline-flex',width:8,height:8}}>
              <span style={{position:'absolute',inset:0,borderRadius:'50%',background:GREEN,opacity:0.4,animation:'ping 1.5s infinite'}}/>
              <span style={{width:8,height:8,borderRadius:'50%',background:GREEN,display:'block'}}/>
            </span>
            <span style={{fontSize:12,fontWeight:600,color:GREEN}}>Live</span>
          </div>
        </div>

        {/* Date Nav */}
        <div style={{display:'flex',justifyContent:'center',marginBottom:24}}>
          <div style={{display:'flex',borderRadius:10,overflow:'hidden',border:`1px solid ${BORDER}`}}>
            <button onClick={()=>{const d=new Date(day);d.setDate(d.getDate()-1);setDay(d)}}
              style={{padding:'8px 18px',fontSize:14,background:SURFACE,color:TEXT2,border:'none',borderRight:`1px solid ${BORDER}`,cursor:'pointer'}}>←</button>
            <div style={{padding:'8px 24px',background:ELEV,fontSize:14,fontWeight:600,color:TEXT,minWidth:130,textAlign:'center'}}>{dayLabel(day)}</div>
            <button onClick={()=>{if(!isToday){const d=new Date(day);d.setDate(d.getDate()+1);setDay(d)}}}
              style={{padding:'8px 18px',fontSize:14,background:SURFACE,color:isToday?TEXT3:TEXT2,border:'none',borderLeft:`1px solid ${BORDER}`,cursor:isToday?'default':'pointer',opacity:isToday?0.35:1}}>→</button>
          </div>
        </div>

        {/* Game Tabs */}
        <div className="tabs">
          <button onClick={()=>setGame('all')}
            style={{padding:'7px 16px',borderRadius:8,fontSize:13,fontWeight:500,border:`1px solid ${game==='all'?ACCENT:BORDER}`,background:game==='all'?ACCENT:'transparent',color:game==='all'?'#fff':TEXT2,cursor:'pointer',flexShrink:0}}>
            All Games
          </button>
          {games.map(g=>(
            <div key={g} style={{display:'flex',flexShrink:0,borderRadius:8,overflow:'hidden',border:`1px solid ${BORDER}`,background:SURFACE}}>
              {renamingGame===g?(
                <div style={{display:'flex',alignItems:'center',gap:4,padding:'0 10px',border:`1px solid ${ACCENT}`,borderRadius:8}}>
                  <input ref={renameRef} value={renameVal} onChange={e=>setRenameVal(e.target.value)}
                    onKeyDown={e=>{if(e.key==='Enter')commitRename();if(e.key==='Escape')cancelRename()}}
                    style={{background:'transparent',border:'none',color:TEXT,fontSize:13,width:130,outline:'none'}}/>
                  <button onClick={commitRename} disabled={saving} style={{background:'none',border:'none',color:GREEN,fontSize:14,cursor:'pointer',padding:'0 3px'}}>{saving?'…':'✓'}</button>
                  <button onClick={cancelRename} style={{background:'none',border:'none',color:TEXT3,fontSize:14,cursor:'pointer',padding:'0 3px'}}>✕</button>
                </div>
              ):(
                <>
                  <button onClick={()=>setGame(g)}
                    style={{padding:'7px 14px',fontSize:13,fontWeight:game===g?600:400,background:'transparent',border:'none',color:game===g?TEXT:TEXT2,cursor:'pointer'}}>
                    {g}
                  </button>
                  <div style={{display:'flex',borderLeft:`1px solid ${BORDER}`}}>
                    <button onClick={()=>startRename(g)} title="Rename" style={{padding:'7px 9px',fontSize:12,background:'transparent',border:'none',color:TEXT3,cursor:'pointer'}}>✏️</button>
                    <button onClick={()=>deleteGame(g)} title="Delete" style={{padding:'7px 9px',fontSize:12,background:'transparent',border:'none',color:TEXT3,cursor:'pointer',borderLeft:`1px solid ${BORDER}`}}>🗑️</button>
                  </div>
                </>
              )}
            </div>
          ))}
        </div>

        {/* Stats */}
        <div className="stat-grid">
          {[
            isToday
              ? {label:'Live Now',  val:String(liveShow.length),  sub:liveShow.length===1?'player in-game':'players in-game'}
              : {label:'Avg',       val:fmt(avgSession),           sub:`over ${byDay.length} sessions`},
            {label:'Sessions',      val:String(byDay.length),      sub:byDay.length>0?`avg ${fmt(avgSession)}`:dayLabel(day).toLowerCase()},
            {label:'Playtime',      val:fmt(playtime),             sub:`combined ${dayLabel(day).toLowerCase()}`},
            {label:'Players',       val:String(players),           sub:`unique ${dayLabel(day).toLowerCase()}`},
          ].map(({label,val,sub})=>(
            <div key={label} className="stat-card">
              <p className="stat-label">{label}</p>
              <p className="stat-val">{dayLoading?'—':val}</p>
              <p className="stat-sub">{sub}</p>
            </div>
          ))}
        </div>

        {/* Live Now — today only */}
        {isToday&&(
          <div style={{marginBottom:28}}>
            <p className="sec">Live Now</p>
            {liveShow.length===0?(
              <div style={{background:SURFACE,border:`1px solid ${BORDER}`,borderRadius:12,padding:28,textAlign:'center'}}>
                <p style={{color:TEXT3,fontSize:13}}>No players in-game</p>
              </div>
            ):(
              <div className="live-grid">
                {liveShow.map(p=>(
                  <div key={p.user_id} className="live-card">
                    <span style={{position:'relative',display:'inline-flex',width:8,height:8,flexShrink:0}}>
                      <span style={{position:'absolute',inset:0,borderRadius:'50%',background:GREEN,opacity:0.4,animation:'ping 1.5s infinite'}}/>
                      <span style={{width:8,height:8,borderRadius:'50%',background:GREEN,display:'block'}}/>
                    </span>
                    <div style={{flex:1,minWidth:0}}>
                      <p className="live-name">{p.username}</p>
                      <p className="live-game">{display(p.game_name)}</p>
                    </div>
                    <p className="live-time">{elapsedSince(p.joined_at,now)}</p>
                  </div>
                ))}
              </div>
            )}
          </div>
        )}

        {/* Chart */}
        <div style={{marginBottom:28}}>
          <p className="sec">Sessions by Hour — {dayLabel(day)}</p>
          <div style={{background:SURFACE,border:`1px solid ${BORDER}`,borderRadius:12,padding:'16px 12px 8px'}}>
            {dayLoading?(
              <div style={{height:120,display:'flex',alignItems:'center',justifyContent:'center'}}>
                <p style={{color:TEXT3,fontSize:13}}>Loading…</p>
              </div>
            ):byDay.length===0?(
              <div style={{height:120,display:'flex',alignItems:'center',justifyContent:'center'}}>
                <p style={{color:TEXT3,fontSize:13}}>No sessions on this day</p>
              </div>
            ):(
              <ResponsiveContainer width="100%" height={140}>
                <BarChart data={hourly} barSize={6}>
                  <XAxis dataKey="h" tick={{fill:TEXT3,fontSize:10}} axisLine={false} tickLine={false} interval={2}/>
                  <YAxis hide allowDecimals={false}/>
                  <Tooltip content={<ChartTip/>} cursor={{fill:'rgba(96,165,250,0.06)'}}/>
                  <Bar dataKey="n" radius={[3,3,0,0]}>
                    {hourly.map((e,i)=><Cell key={i} fill={e.n>0?ACCENT:BORDER}/>)}
                  </Bar>
                </BarChart>
              </ResponsiveContainer>
            )}
          </div>
        </div>

        {/* View Tabs + Table */}
        <div>
          <div style={{display:'flex',alignItems:'center',justifyContent:'space-between',marginBottom:12,flexWrap:'wrap',gap:10}}>
            {/* Sessions / Players toggle */}
            <div style={{display:'flex',borderRadius:9,overflow:'hidden',border:`1px solid ${BORDER}`}}>
              {(['sessions','players'] as View[]).map(v=>(
                <button key={v} onClick={()=>setView(v)}
                  style={{padding:'7px 18px',fontSize:13,fontWeight:view===v?600:500,textTransform:'capitalize',
                    background:view===v?ELEV:SURFACE,color:view===v?TEXT:TEXT2,border:'none',cursor:'pointer'}}>
                  {v==='sessions'?'Sessions':'Players'}
                </button>
              ))}
            </div>
            <input value={search} onChange={e=>setSearch(e.target.value)} placeholder="Search player…"
              style={{padding:'7px 14px',borderRadius:8,background:SURFACE,border:`1px solid ${BORDER}`,color:TEXT,fontSize:13,width:180,outline:'none'}}/>
          </div>

          <p className="sec">
            {view==='sessions'
              ? `Sessions — ${dayLabel(day)}`
              : `Leaderboard — ${game==='all'?'All Games':game} · last 30 days`}
          </p>

          <div style={{background:SURFACE,border:`1px solid ${BORDER}`,borderRadius:12,overflow:'hidden'}}>
            <div style={{overflowX:'auto'}}>

              {view==='sessions'?(
                <table className="tbl">
                  <thead>
                    <tr style={{borderBottom:`1px solid ${BORDER}`}}>
                      <ColHeader label="Player"  sortKey="player" />
                      <ColHeader label="Game" hideSm />
                      <ColHeader label="Session" sortKey="session" />
                      <ColHeader label="Total"   sortKey="total" hideSm />
                      <ColHeader label="#"       sortKey="count" hideSm />
                      <ColHeader label="When"    sortKey="when"  align="right" />
                    </tr>
                  </thead>
                  <tbody>
                    {dayLoading?(
                      <tr><td colSpan={6} style={{padding:40,textAlign:'center',color:TEXT3}}>Loading…</td></tr>
                    ):sorted.length===0?(
                      <tr><td colSpan={6} style={{padding:40,textAlign:'center',color:TEXT3}}>
                        {search?`No results for "${search}"`:`No sessions on ${dayLabel(day).toLowerCase()}`}
                      </td></tr>
                    ):sorted.slice(0,100).map(s=>(
                      <tr key={s.id} style={{borderBottom:`1px solid ${BORDER}`}}>
                        <td style={{fontWeight:600,color:TEXT,maxWidth:130,overflow:'hidden',textOverflow:'ellipsis'}}>{s.username}</td>
                        <td className="hide-sm">
                          <span style={{padding:'2px 8px',borderRadius:5,background:ELEV,color:TEXT2,fontSize:12,fontWeight:500}}>{display(s.game_name)}</span>
                        </td>
                        <td className="num" style={{color:TEXT}}>{fmt(s.session_time)}</td>
                        <td className="num hide-sm" style={{color:TEXT2}}>{fmt(s.total_time)}</td>
                        <td className="hide-sm" style={{color:TEXT3}}>#{s.session_count}</td>
                        <td style={{color:TEXT3,textAlign:'right'}}>{timeAgo(s.created_at)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              ):(
                <table className="tbl">
                  <thead>
                    <tr style={{borderBottom:`1px solid ${BORDER}`}}>
                      <th style={{textAlign:'center',color:TEXT3,width:44}}>#</th>
                      {([
                        {l:'Player',   k:'name'     as PSortKey, a:'left',  h:false},
                        {l:'Playtime', k:'total'    as PSortKey, a:'left',  h:false},
                        {l:'Sess',     k:'sessions' as PSortKey, a:'left',  h:false},
                        {l:'Avg',      k:'avg'      as PSortKey, a:'left',  h:true},
                        {l:'Last Seen',k:'last'     as PSortKey, a:'right', h:true},
                      ]).map(({l,k,a,h})=>(
                        <th key={l} onClick={()=>togglePSort(k)} className={h?'hide-sm':''}
                          style={{textAlign:a as any,color:pSortBy===k?ACCENT:TEXT3,cursor:'pointer'}}>
                          {l}<span style={{marginLeft:4,opacity:0.6}}>{pSortIcon(k)}</span>
                        </th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {lbLoading?(
                      <tr><td colSpan={6} style={{padding:40,textAlign:'center',color:TEXT3}}>Loading…</td></tr>
                    ):playerSorted.length===0?(
                      <tr><td colSpan={6} style={{padding:40,textAlign:'center',color:TEXT3}}>
                        {search?`No results for "${search}"`:'No players yet'}
                      </td></tr>
                    ):playerSorted.slice(0,100).map((r,i)=>{
                      const ranked = pSortBy==='total' && pSortDir==='desc'
                      return(
                        <tr key={r.username} style={{borderBottom:`1px solid ${BORDER}`}}>
                          <td style={{textAlign:'center',fontSize:ranked&&i<3?15:12,color:TEXT3,fontWeight:600}}>
                            {ranked?medal(i):i+1}
                          </td>
                          <td style={{fontWeight:600,color:TEXT,maxWidth:130,overflow:'hidden',textOverflow:'ellipsis'}}>{r.username}</td>
                          <td className="num" style={{color:TEXT,fontWeight:600}}>{fmt(r.totalTime)}</td>
                          <td className="num" style={{color:TEXT2}}>{r.sessions}</td>
                          <td className="num hide-sm" style={{color:TEXT2}}>{fmt(r.avg)}</td>
                          <td className="hide-sm" style={{color:TEXT3,textAlign:'right'}}>{timeAgo(r.last)}</td>
                        </tr>
                      )
                    })}
                  </tbody>
                </table>
              )}

            </div>

            {view==='sessions'&&sorted.length>100&&(
              <div style={{padding:12,textAlign:'center',borderTop:`1px solid ${BORDER}`}}>
                <p style={{fontSize:12,color:TEXT3}}>Showing 100 of {sorted.length}</p>
              </div>
            )}
            {view==='players'&&playerSorted.length>100&&(
              <div style={{padding:12,textAlign:'center',borderTop:`1px solid ${BORDER}`}}>
                <p style={{fontSize:12,color:TEXT3}}>Showing 100 of {playerSorted.length} players</p>
              </div>
            )}
          </div>
        </div>

      </div>
    </div>
  )
}
