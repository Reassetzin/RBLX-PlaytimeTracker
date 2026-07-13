'use client'

import { useEffect, useState, useCallback, useMemo, useRef } from 'react'
import { supabase, type Session, type LivePlayer } from '@/lib/supabase'
import { BarChart, Bar, XAxis, YAxis, Tooltip, ResponsiveContainer, Cell } from 'recharts'

const V='v2.8'
const BG='#111111',SURFACE='#1c1c1c',ELEV='#242424',BORDER='#2e2e2e'
const ACCENT='#60a5fa',GREEN='#4ade80',TEXT='#f0f0f0',TEXT2='#888',TEXT3='#444'
const TZ='America/New_York' // EST/EDT — all date comparisons use this

type SortKey = 'when'|'session'|'total'|'player'|'count'
type SortDir = 'asc'|'desc'

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
  const[now,setNow]                   =useState(new Date())
  const[loading,setLoading]           =useState(true)
  const[renamingGame,setRenamingGame] =useState<string|null>(null)
  const[renameVal,setRenameVal]       =useState('')
  const[saving,setSaving]             =useState(false)
  const renameRef                     =useRef<HTMLInputElement>(null)

  useEffect(()=>{const id=setInterval(()=>setNow(new Date()),1000);return()=>clearInterval(id)},[])

  const display=(raw:string)=>aliases[raw]||raw
  const rawsFor=(dn:string):string[]=>{
    const a=Object.entries(aliases).filter(([,v])=>v===dn).map(([k])=>k)
    return a.length>0?a:[dn]
  }

  // Supabase caps responses at 1000 rows — paginate with .range() to get everything
  const fetchAllSessions=async(sinceISO:string):Promise<Session[]>=>{
    const PAGE=1000
    const all:Session[]=[]
    for(let from=0;from<20000;from+=PAGE){
      const{data,error}=await supabase
        .from('sessions')
        .select('*')
        .gte('created_at',sinceISO)
        .order('created_at',{ascending:false})
        .range(from,from+PAGE-1)
      if(error||!data||data.length===0)break
      all.push(...data)
      if(data.length<PAGE)break
    }
    return all
  }

  const load=useCallback(async()=>{
    const cut=new Date();cut.setDate(cut.getDate()-30)
    const[s,{data:l},{data:a}]=await Promise.all([
      fetchAllSessions(cut.toISOString()),
      supabase.from('live_players').select('*').order('joined_at'),
      supabase.from('game_aliases').select('*'),
    ])
    if(s) setSessions(s)
    if(l) setLive(l)
    if(a){const map:Record<string,string>={};a.forEach((r:any)=>{map[r.raw_name]=r.display_name});setAliases(map)}
    setLoading(false)
  },[])

  useEffect(()=>{load()},[load])

  useEffect(()=>{
    const ch=supabase.channel('rt')
      .on('postgres_changes',{event:'INSERT',schema:'public',table:'sessions'},({new:s})=>{setSessions(p=>[s as Session,...p])})
      .on('postgres_changes',{event:'INSERT',schema:'public',table:'live_players'},({new:p})=>{
        setLive(prev=>prev.find(x=>x.user_id===(p as LivePlayer).user_id)?prev:[...prev,p as LivePlayer])
      })
      .on('postgres_changes',{event:'DELETE',schema:'public',table:'live_players'},({old:p})=>{
        setLive(prev=>prev.filter(x=>x.user_id!==p.user_id))
      })
      .subscribe()
    return()=>{supabase.removeChannel(ch)}
  },[])

  const games=useMemo(()=>[...new Set(sessions.map(s=>display(s.game_name)))].sort(),[sessions,aliases])

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
  const byDay     =useMemo(()=>byGame.filter(s=>sameDay(new Date(s.created_at),day)),[byGame,day])
  const liveShow  =useMemo(()=>live.filter(p=>game==='all'||display(p.game_name)===game),[live,game,aliases])
  const playtime  =useMemo(()=>byDay.reduce((a,s)=>a+s.session_time,0),[byDay])
  const players   =useMemo(()=>new Set(byGame.map(s=>s.username)).size,[byGame])
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

  const ChartTip=({active,payload,label}:any)=>{
    if(!active||!payload?.length)return null
    return<div style={{background:ELEV,border:`1px solid ${BORDER}`,borderRadius:8,padding:'8px 12px'}}>
      <p style={{fontSize:11,color:TEXT2}}>{label}</p>
      <p style={{fontSize:15,fontWeight:700,color:ACCENT}}>{payload[0].value}</p>
    </div>
  }

  // Column header button
  const ColHeader=({label,sortKey,align='left'}:{label:string;sortKey?:SortKey;align?:string})=>(
    <th style={{padding:'11px 16px',textAlign:align as any,fontSize:11,fontWeight:700,letterSpacing:'0.07em',color:sortKey&&sortBy===sortKey?ACCENT:TEXT3,textTransform:'uppercase',whiteSpace:'nowrap',userSelect:'none',cursor:sortKey?'pointer':'default'}}
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
              style={{padding:'8px 18px',fontSize:14,background:SURFACE,color:TEXT2,border:'none',borderRight:`1px solid ${BORDER}`,cursor:'pointer'}}>←</button>
            <div style={{padding:'8px 24px',background:ELEV,fontSize:14,fontWeight:600,color:TEXT,minWidth:130,textAlign:'center'}}>{dayLabel(day)}</div>
            <button onClick={()=>{if(!isToday){const d=new Date(day);d.setDate(d.getDate()+1);setDay(d)}}}
              style={{padding:'8px 18px',fontSize:14,background:SURFACE,color:isToday?TEXT3:TEXT2,border:'none',borderLeft:`1px solid ${BORDER}`,cursor:isToday?'default':'pointer',opacity:isToday?0.35:1}}>→</button>
          </div>
        </div>

        {/* Game Tabs */}
        <div style={{display:'flex',gap:8,overflowX:'auto',marginBottom:24,paddingBottom:4}}>
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
        <div style={{display:'grid',gridTemplateColumns:'repeat(2,1fr)',gap:12,marginBottom:28}}>
          {[
            isToday
              ? {label:'Live Now',    val:liveShow.length,          sub:liveShow.length===1?'1 player in-game':`${liveShow.length} players in-game`}
              : {label:'Avg Session', val:fmt(avgSession),           sub:`across ${byDay.length} sessions`},
            {label:dayLabel(day),     val:`${byDay.length} sessions`, sub:byDay.length>0?`avg ${fmt(avgSession)}`:'—'},
            {label:'Combined Playtime', val:fmt(playtime), sub:`${byDay.length} players' sessions`},
            {label:'Total Players',   val:players,                   sub:'unique (last 30 days)'},
          ].map(({label,val,sub})=>(
            <div key={label} style={{background:SURFACE,border:`1px solid ${BORDER}`,borderRadius:12,padding:'18px 20px'}}>
              <p style={{fontSize:11,fontWeight:700,letterSpacing:'0.07em',color:TEXT3,textTransform:'uppercase',marginBottom:10}}>{label}</p>
              <p style={{fontSize:28,fontWeight:700,color:TEXT,lineHeight:1}}>{val}</p>
              <p style={{fontSize:12,color:TEXT3,marginTop:5}}>{sub}</p>
            </div>
          ))}
        </div>

        {/* Live Now — today only */}
        {isToday&&(
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
                      <p style={{fontSize:12,color:TEXT2,marginTop:2}}>{display(p.game_name)}</p>
                    </div>
                    <p style={{fontSize:13,fontWeight:600,color:GREEN,flexShrink:0,fontVariantNumeric:'tabular-nums'}}>{elapsedSince(p.joined_at,now)}</p>
                  </div>
                ))}
              </div>
            )}
          </div>
        )}

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
            <p style={{fontSize:11,fontWeight:700,letterSpacing:'0.08em',color:TEXT3,textTransform:'uppercase'}}>Session History — {dayLabel(day)}</p>
            <input value={search} onChange={e=>setSearch(e.target.value)} placeholder="Search player…"
              style={{padding:'7px 14px',borderRadius:8,background:SURFACE,border:`1px solid ${BORDER}`,color:TEXT,fontSize:13,width:180,outline:'none'}}/>
          </div>
          <div style={{background:SURFACE,border:`1px solid ${BORDER}`,borderRadius:12,overflow:'hidden'}}>
            <div style={{overflowX:'auto'}}>
              <table style={{width:'100%',borderCollapse:'collapse',fontSize:13}}>
                <thead>
                  <tr style={{borderBottom:`1px solid ${BORDER}`}}>
                    <ColHeader label="Player"  sortKey="player" />
                    <ColHeader label="Game" />
                    <ColHeader label="Session" sortKey="session" />
                    <ColHeader label="Total"   sortKey="total" />
                    <ColHeader label="#"        sortKey="count" />
                    <ColHeader label="When"    sortKey="when"  align="right" />
                  </tr>
                </thead>
                <tbody>
                  {sorted.length===0?(
                    <tr><td colSpan={6} style={{padding:40,textAlign:'center',color:TEXT3,fontSize:13}}>
                      {search?`No results for "${search}"`:`No sessions on ${dayLabel(day).toLowerCase()}`}
                    </td></tr>
                  ):sorted.slice(0,100).map(s=>(
                    <tr key={s.id} style={{borderBottom:`1px solid ${BORDER}`}}>
                      <td style={{padding:'11px 16px',fontWeight:600,color:TEXT}}>{s.username}</td>
                      <td style={{padding:'11px 16px'}}>
                        <span style={{padding:'2px 8px',borderRadius:5,background:ELEV,color:TEXT2,fontSize:12,fontWeight:500}}>{display(s.game_name)}</span>
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
            {sorted.length>100&&(
              <div style={{padding:12,textAlign:'center',borderTop:`1px solid ${BORDER}`}}>
                <p style={{fontSize:12,color:TEXT3}}>Showing 100 of {sorted.length}</p>
              </div>
            )}
          </div>
        </div>

      </div>
    </div>
  )
}
