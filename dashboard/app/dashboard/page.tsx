'use client'

import { useEffect, useState, useCallback, useMemo, useRef } from 'react'
import { supabase, type Session, type LivePlayer } from '@/lib/supabase'
import { BarChart, Bar, XAxis, YAxis, Tooltip, ResponsiveContainer, Cell } from 'recharts'

const V = 'v2.2'
const BG      = '#111111'
const SURFACE = '#1c1c1c'
const ELEV    = '#242424'
const BORDER  = '#2e2e2e'
const ACCENT  = '#60a5fa'
const GREEN   = '#4ade80'
const TEXT    = '#f0f0f0'
const TEXT2   = '#888'
const TEXT3   = '#444'

function fmt(s: number) {
  s = Math.floor(s)
  const h = Math.floor(s / 3600), m = Math.floor((s % 3600) / 60), sec = s % 60
  if (h > 0) return `${h}h ${m}m ${sec}s`
  if (m > 0) return `${m}m ${sec}s`
  return `${sec}s`
}
function elapsedSince(d: string, now: Date) { return fmt(Math.max(0, Math.floor((now.getTime() - new Date(d).getTime()) / 1000))) }
function timeAgo(d: string) {
  const s = Math.floor((Date.now() - new Date(d).getTime()) / 1000)
  if (s < 60) return `${s}s ago`; if (s < 3600) return `${Math.floor(s/60)}m ago`
  if (s < 86400) return `${Math.floor(s/3600)}h ago`; return new Date(d).toLocaleDateString()
}
function sameDay(a: Date, b: Date) { return a.toDateString() === b.toDateString() }
function dayLabel(d: Date) {
  const t = new Date(), y = new Date(); y.setDate(t.getDate()-1)
  if (sameDay(d,t)) return 'Today'; if (sameDay(d,y)) return 'Yesterday'
  return d.toLocaleDateString('en-US',{weekday:'short',month:'short',day:'numeric'})
}
function buildHourly(sessions: Session[], day: Date) {
  const bins = Array.from({length:24},(_,i)=>({h:i===0?'12a':i<12?`${i}a`:i===12?'12p':`${i-12}p`,n:0}))
  sessions.filter(s=>sameDay(new Date(s.created_at),day)).forEach(s=>{bins[new Date(s.created_at).getHours()].n++})
  return bins
}

export default function Dashboard() {
  const [sessions, setSessions]         = useState<Session[]>([])
  const [live, setLive]                 = useState<LivePlayer[]>([])
  const [games, setGames]               = useState<string[]>([])
  const [game, setGame]                 = useState('all')
  const [day, setDay]                   = useState(new Date())
  const [search, setSearch]             = useState('')
  const [now, setNow]                   = useState(new Date())
  const [loading, setLoading]           = useState(true)
  const [renamingGame, setRenamingGame] = useState<string|null>(null)
  const [renameVal, setRenameVal]       = useState('')
  const [saving, setSaving]             = useState(false)
  const renameRef                       = useRef<HTMLInputElement>(null)

  useEffect(()=>{const id=setInterval(()=>setNow(new Date()),1000);return()=>clearInterval(id)},[])

  const load = useCallback(async()=>{
    const cut=new Date(); cut.setDate(cut.getDate()-30)
    const[{data:s},{data:l}]=await Promise.all([
      supabase.from('sessions').select('*').gte('created_at',cut.toISOString()).order('created_at',{ascending:false}).limit(2000),
      supabase.from('live_players').select('*').order('joined_at'),
    ])
    if(s){setSessions(s);setGames([...new Set(s.map((x:Session)=>x.game_name))].sort())}
    if(l) setLive(l)
    setLoading(false)
  },[])

  useEffect(()=>{load()},[load])

  useEffect(()=>{
    const ch=supabase.channel('rt')
      .on('postgres_changes',{event:'INSERT',schema:'public',table:'sessions'},({new:s})=>{
        setSessions(p=>[s as Session,...p])
        setGames(p=>p.includes((s as Session).game_name)?p:[...p,(s as Session).game_name].sort())
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

  const startRename=(g:string)=>{setRenamingGame(g);setRenameVal(g);setTimeout(()=>renameRef.current?.focus(),50)}
  const cancelRename=()=>setRenamingGame(null)
  const commitRename=async()=>{
    if(!renamingGame) return
    const n=renameVal.trim(); if(!n||n===renamingGame){cancelRename();return}
    setSaving(true)
    await Promise.all([
      supabase.from('sessions').update({game_name:n}).eq('game_name',renamingGame),
      supabase.from('live_players').update({game_name:n}).eq('game_name',renamingGame),
    ])
    setSessions(p=>p.map(s=>s.game_name===renamingGame?{...s,game_name:n}:s))
    setLive(p=>p.map(x=>x.game_name===renamingGame?{...x,game_name:n}:x))
    setGames(p=>[...new Set(p.map(g=>g===renamingGame?n:g))].sort())
    if(game===renamingGame) setGame(n)
    setRenamingGame(null); setSaving(false)
  }
  const deleteGame=async(g:string)=>{
    if(!confirm(`Delete all data for "${g}"? This cannot be undone.`)) return
    await Promise.all([
      supabase.from('sessions').delete().eq('game_name',g),
      supabase.from('live_players').delete().eq('game_name',g),
    ])
    setSessions(p=>p.filter(s=>s.game_name!==g))
    setLive(p=>p.filter(x=>x.game_name!==g))
    setGames(p=>p.filter(x=>x!==g))
    if(game===g) setGame('all')
  }

  const byGame    = useMemo(()=>sessions.filter(s=>game==='all'||s.game_name===game),[sessions,game])
  const bySearch  = useMemo(()=>byGame.filter(s=>!search||s.username.toLowerCase().includes(search.toLowerCase())),[byGame,search])
  const byDay     = useMemo(()=>byGame.filter(s=>sameDay(new Date(s.created_at),day)),[byGame,day])
  const liveShow  = useMemo(()=>live.filter(p=>game==='all'||p.game_name===game),[live,game])
  const playtime  = useMemo(()=>byDay.reduce((a,s)=>a+s.session_time,0),[byDay])
  const players   = useMemo(()=>new Set(byGame.map(s=>s.username)).size,[byGame])
  const hourly    = useMemo(()=>buildHourly(byGame,day),[byGame,day])
  const isToday   = sameDay(day,new Date())

  const ChartTip=({active,payload,label}:any)=>{
    if(!active||!payload?.length) return null
    return <div style={{background:ELEV,border:`1px solid ${BORDER}`,borderRadius:8,padding:'8px 12px'}}>
      <p style={{fontSize:11,color:TEXT2}}>{label}</p>
      <p style={{fontSize:15,fontWeight:700,color:ACCENT}}>{payload[0].value}</p>
    </div>
  }

  const btn=(bg:string,color:string,extra={})=>({background:bg,color,border:'none',cursor:'pointer',...extra})

  if(loading) return(
    <div style={{minHeight:'100vh',display:'flex',alignItems:'center',justifyContent:'center',background:BG}}>
      <p style={{color:TEXT2,fontSize:14}}>Loading…</p>
    </div>
  )

  return(
    <div style={{minHeight:'100vh',background:BG,color:TEXT,fontFamily:"'Inter',system-ui,sans-serif"}}>
      <div style={{maxWidth:1100,margin:'0 auto',padding:'24px 16px 64px'}}>

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
            <style>{`@keyframes ping{75%,100%{transform:scale(2);opacity:0}}`}</style>
          </div>
        </div>

        {/* Date Nav */}
        <div style={{display:'flex',justifyContent:'center',marginBottom:24}}>
          <div style={{display:'flex',borderRadius:10,overflow:'hidden',border:`1px solid ${BORDER}`}}>
            <button onClick={()=>{const d=new Date(day);d.setDate(d.getDate()-1);setDay(d)}}
              style={{...btn(SURFACE,TEXT2),padding:'8px 18px',fontSize:14,borderRight:`1px solid ${BORDER}`}}>←</button>
            <div style={{padding:'8px 24px',background:ELEV,fontSize:14,fontWeight:600,color:TEXT,minWidth:130,textAlign:'center'}}>
              {dayLabel(day)}
            </div>
            <button onClick={()=>{if(!isToday){const d=new Date(day);d.setDate(d.getDate()+1);setDay(d)}}}
              style={{...btn(SURFACE,isToday?TEXT3:TEXT2),padding:'8px 18px',fontSize:14,borderLeft:`1px solid ${BORDER}`,opacity:isToday?0.35:1}}>→</button>
          </div>
        </div>

        {/* Game Tabs */}
        <div style={{display:'flex',gap:8,overflowX:'auto',marginBottom:24,paddingBottom:4}}>
          <button onClick={()=>setGame('all')}
            style={{...btn(game==='all'?ACCENT:'transparent',game==='all'?'#fff':TEXT2),padding:'7px 16px',borderRadius:8,fontSize:13,fontWeight:500,border:`1px solid ${game==='all'?ACCENT:BORDER}`,flexShrink:0,transition:'all 0.15s'}}>
            All Games
          </button>
          {games.map(g=>(
            <div key={g} style={{display:'flex',flexShrink:0,borderRadius:8,overflow:'hidden',border:`1px solid ${BORDER}`,background:SURFACE}}>
              {renamingGame===g?(
                <div style={{display:'flex',alignItems:'center',gap:4,padding:'0 10px',borderColor:ACCENT,borderWidth:1,borderStyle:'solid',borderRadius:8}}>
                  <input ref={renameRef} value={renameVal} onChange={e=>setRenameVal(e.target.value)}
                    onKeyDown={e=>{if(e.key==='Enter')commitRename();if(e.key==='Escape')cancelRename()}}
                    style={{background:'transparent',border:'none',color:TEXT,fontSize:13,width:110,outline:'none'}}/>
                  <button onClick={commitRename} disabled={saving} style={{...btn('transparent',GREEN),fontSize:14,padding:'0 3px'}}>{saving?'…':'✓'}</button>
                  <button onClick={cancelRename} style={{...btn('transparent',TEXT3),fontSize:14,padding:'0 3px'}}>✕</button>
                </div>
              ):(
                <>
                  <button onClick={()=>setGame(g)}
                    style={{...btn('transparent',game===g?TEXT:TEXT2),padding:'7px 14px',fontSize:13,fontWeight:game===g?600:400}}>
                    {g}
                  </button>
                  <div style={{display:'flex',borderLeft:`1px solid ${BORDER}`}}>
                    <button onClick={()=>startRename(g)} title="Rename" style={{...btn('transparent',TEXT3),padding:'7px 9px',fontSize:12}}>✏️</button>
                    <button onClick={()=>deleteGame(g)} title="Delete" style={{...btn('transparent',TEXT3),padding:'7px 9px',fontSize:12,borderLeft:`1px solid ${BORDER}`}}>🗑️</button>
                  </div>
                </>
              )}
            </div>
          ))}
        </div>

        {/* Stats */}
        <div style={{display:'grid',gridTemplateColumns:'repeat(2,1fr)',gap:12,marginBottom:28}}>
          {[
            {label:'Live Now', val:liveShow.length, sub:liveShow.length===1?'1 player in-game':`${liveShow.length} players in-game`},
            {label:dayLabel(day),   val:`${byDay.length} sessions`, sub:byDay.length>0?`avg ${fmt(Math.floor(playtime/byDay.length))}`:'—'},
            {label:'Playtime',      val:fmt(playtime),          sub:'today'},
            {label:'Total Players', val:players,                sub:'unique'},
          ].map(({label,val,sub})=>(
            <div key={label} style={{background:SURFACE,border:`1px solid ${BORDER}`,borderRadius:12,padding:'18px 20px'}}>
              <p style={{fontSize:11,fontWeight:700,letterSpacing:'0.07em',color:TEXT3,textTransform:'uppercase',marginBottom:10}}>{label}</p>
              <p style={{fontSize:28,fontWeight:700,color:TEXT,lineHeight:1}}>{val}</p>
              <p style={{fontSize:12,color:TEXT3,marginTop:5}}>{sub}</p>
            </div>
          ))}
        </div>

        {/* Live Now */}
        <div style={{marginBottom:28}}>
          <p style={{fontSize:11,fontWeight:700,letterSpacing:'0.08em',color:TEXT3,textTransform:'uppercase',marginBottom:12}}>Live Now</p>
          {liveShow.length===0?(
            <div style={{background:SURFACE,border:`1px solid ${BORDER}`,borderRadius:12,padding:28,textAlign:'center'}}>
              <p style={{color:TEXT3,fontSize:13}}>No players in-game</p>
            </div>
          ):(
            <div style={{display:'grid',gridTemplateColumns:'repeat(auto-fill,minmax(250px,1fr))',gap:8}}>
              {liveShow.map(p=>(
                <div key={p.user_id} style={{background:SURFACE,border:`1px solid ${BORDER}`,borderRadius:12,padding:'12px 16px',display:'flex',alignItems:'center',gap:12}}>
                  <span style={{position:'relative',display:'inline-flex',width:8,height:8,flexShrink:0}}>
                    <span style={{position:'absolute',inset:0,borderRadius:'50%',background:GREEN,opacity:0.4,animation:'ping 1.5s infinite'}}/>
                    <span style={{width:8,height:8,borderRadius:'50%',background:GREEN,display:'block'}}/>
                  </span>
                  <div style={{flex:1,minWidth:0}}>
                    <p style={{fontWeight:600,fontSize:14,color:TEXT,overflow:'hidden',textOverflow:'ellipsis',whiteSpace:'nowrap'}}>{p.username}</p>
                    <p style={{fontSize:12,color:TEXT2,marginTop:2}}>{p.game_name}</p>
                  </div>
                  <p style={{fontSize:13,fontWeight:600,color:GREEN,flexShrink:0,fontVariantNumeric:'tabular-nums'}}>{elapsedSince(p.joined_at,now)}</p>
                </div>
              ))}
            </div>
          )}
        </div>

        {/* Chart */}
        <div style={{marginBottom:28}}>
          <p style={{fontSize:11,fontWeight:700,letterSpacing:'0.08em',color:TEXT3,textTransform:'uppercase',marginBottom:12}}>Sessions by Hour — {dayLabel(day)}</p>
          <div style={{background:SURFACE,border:`1px solid ${BORDER}`,borderRadius:12,padding:'16px 12px 8px'}}>
            {byDay.length===0?(
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

        {/* Table */}
        <div>
          <div style={{display:'flex',alignItems:'center',justifyContent:'space-between',marginBottom:12,flexWrap:'wrap',gap:8}}>
            <p style={{fontSize:11,fontWeight:700,letterSpacing:'0.08em',color:TEXT3,textTransform:'uppercase'}}>Session History</p>
            <input value={search} onChange={e=>setSearch(e.target.value)} placeholder="Search player…"
              style={{padding:'7px 14px',borderRadius:8,background:SURFACE,border:`1px solid ${BORDER}`,color:TEXT,fontSize:13,width:180,outline:'none'}}/>
          </div>
          <div style={{background:SURFACE,border:`1px solid ${BORDER}`,borderRadius:12,overflow:'hidden'}}>
            <div style={{overflowX:'auto'}}>
              <table style={{width:'100%',borderCollapse:'collapse',fontSize:13}}>
                <thead>
                  <tr style={{borderBottom:`1px solid ${BORDER}`}}>
                    {['Player','Game','Session','Total','#','When'].map((h,i)=>(
                      <th key={h} style={{padding:'11px 16px',textAlign:i===5?'right':'left',fontSize:11,fontWeight:700,letterSpacing:'0.07em',color:TEXT3,textTransform:'uppercase'}}>{h}</th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {bySearch.length===0?(
                    <tr><td colSpan={6} style={{padding:40,textAlign:'center',color:TEXT3,fontSize:13}}>
                      {search?`No results for "${search}"`:'No sessions yet'}
                    </td></tr>
                  ):bySearch.slice(0,100).map(s=>(
                    <tr key={s.id} style={{borderBottom:`1px solid ${BORDER}`}}>
                      <td style={{padding:'11px 16px',fontWeight:600,color:TEXT}}>{s.username}</td>
                      <td style={{padding:'11px 16px'}}>
                        <span style={{padding:'2px 8px',borderRadius:5,background:ELEV,color:TEXT2,fontSize:12,fontWeight:500}}>{s.game_name}</span>
                      </td>
                      <td style={{padding:'11px 16px',color:TEXT,fontVariantNumeric:'tabular-nums'}}>{fmt(s.session_time)}</td>
                      <td style={{padding:'11px 16px',color:TEXT2,fontVariantNumeric:'tabular-nums'}}>{fmt(s.total_time)}</td>
                      <td style={{padding:'11px 16px',color:TEXT3}}>#{s.session_count}</td>
                      <td style={{padding:'11px 16px',color:TEXT3,textAlign:'right'}}>{timeAgo(s.created_at)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            {bySearch.length>100&&(
              <div style={{padding:12,textAlign:'center',borderTop:`1px solid ${BORDER}`}}>
                <p style={{fontSize:12,color:TEXT3}}>Showing 100 of {bySearch.length}</p>
              </div>
            )}
          </div>
        </div>

      </div>
    </div>
  )
}
