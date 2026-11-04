import { useRef, useState } from 'react'
import { Link } from 'react-router-dom'
import { Avatar } from '../App'
import { LEVELS, MAX_BOTS, isBot, makeBots } from '../lib/bots'

export function RoomHeader({ title, code, room }) {
  const [copied, setCopied] = useState(false)
  const [showLink, setShowLink] = useState(false)
  const link = window.location.href

  const copy = async () => {
    let ok = false
    // 1) 최신 클립보드 API (https + 권한 필요)
    try {
      if (navigator.clipboard && window.isSecureContext) {
        await navigator.clipboard.writeText(link)
        ok = true
      }
    } catch { /* 다음 방법 시도 */ }
    // 2) 예전 방식 (임시 입력창 선택 후 복사)
    if (!ok) {
      try {
        const ta = document.createElement('textarea')
        ta.value = link
        ta.setAttribute('readonly', '')
        ta.style.position = 'fixed'
        ta.style.opacity = '0'
        document.body.appendChild(ta)
        ta.select()
        ta.setSelectionRange(0, link.length)
        ok = document.execCommand('copy')
        document.body.removeChild(ta)
      } catch { /* 실패 */ }
    }
    if (ok) {
      setCopied(true)
      setTimeout(() => setCopied(false), 1500)
    } else {
      // 3) 둘 다 막혀 있으면 링크를 직접 보여줘서 손으로 복사
      setShowLink(true)
    }
  }

  return (
    <>
    {showLink && (
      <div className="card row wrap link-box">
        <span className="small muted">자동 복사가 막혀 있어요. 아래 링크를 길게 누르거나 드래그해서 복사하세요.</span>
        <input className="input grow" readOnly value={link} onFocus={(e) => e.target.select()} autoFocus />
        <button className="btn sm" onClick={() => setShowLink(false)}>닫기</button>
      </div>
    )}
    <div className="row between wrap room-header">
      <div className="row">
        <Link to="/" className="btn ghost sm">← 홈</Link>
        <h2>{title}</h2>
      </div>
      <div className="row">
        <span className={'dot ' + (room.connected ? 'on' : '')} />
        <span className="code-badge">방 코드 {code}</span>
        <button className="btn sm" onClick={copy}>{copied ? '복사됨 ✓' : '초대 링크 복사'}</button>
      </div>
    </div>
    </>
  )
}

export function PlayerList({ room, players, scores = {}, highlight = {}, meId }) {
  const sorted = [...(players || room.players)].sort((a, b) => (scores[b.id] || 0) - (scores[a.id] || 0))
  return (
    <ul className="players">
      {sorted.map((p) => (
        <li key={p.id} className={(p.id === meId ? 'me ' : '') + (highlight[p.id] ? 'hl' : '')}>
          <Avatar p={p} size={28} />
          <span className="grow ellipsis">
            {p.nickname}
            {p.id === room.hostId && <span className="host-tag">방장</span>}
            {isBot(p.id) && <span className="bot-tag">BOT</span>}
          </span>
          {highlight[p.id] && <span className="small">{highlight[p.id]}</span>}
          <b>{scores[p.id] || 0}</b>
        </li>
      ))}
    </ul>
  )
}

export function Lobby({ room, onStart, minPlayers = 1, hint, count }) {
  const n = count ?? room.players.length
  return (
    <div className="card stack center-text">
      <div className="big-emoji">👋</div>
      <h3>팀원을 기다리는 중 ({n}명)</h3>
      <p className="muted small">초대 링크를 복사해서 공유하세요. {hint}</p>
      {room.isHost ? (
        <button className="btn primary lg" disabled={n < minPlayers} onClick={onStart}>
          {n < minPlayers ? `최소 ${minPlayers}명 필요 (봇 추가 가능)` : '게임 시작'}
        </button>
      ) : (
        <p className="muted">방장이 시작하면 바로 시작돼요.</p>
      )}
    </div>
  )
}

/** 대기실: 봇 추가/삭제 + 난이도 선택 (방장만 조작) */
export function BotControls({ room }) {
  const { state, setState, isHost } = room
  const bots = state.bots || []
  const level = state.botLevel || 'normal'
  return (
    <div className="card stack bot-controls">
      <div className="row between wrap">
        <h4>🤖 봇과 함께하기</h4>
        <span className="muted small">혼자서도 테스트할 수 있어요 · 봇과 한 게임은 랭킹에 반영되지 않아요</span>
      </div>
      <div className="row wrap">
        <span className="small">난이도</span>
        <div className="tabs">
          {Object.entries(LEVELS).map(([k, v]) => (
            <button key={k} className={'tab' + (level === k ? ' active' : '')} disabled={!isHost} onClick={() => setState((s) => ({ ...s, botLevel: k }))}>{v.label}</button>
          ))}
        </div>
        <span className="sep" />
        <span className="small">봇 {bots.length}명</span>
        <button className="btn sm" disabled={!isHost || bots.length === 0} onClick={() => setState((s) => ({ ...s, bots: (s.bots || []).slice(0, -1) }))}>−</button>
        <button className="btn sm" disabled={!isHost || bots.length >= MAX_BOTS} onClick={() => setState((s) => ({ ...s, bots: makeBots(s.bots || [], 1) }))}>+</button>
      </div>
    </div>
  )
}

export function Countdown({ endsAt }) {
  const left = Math.max(0, Math.ceil((endsAt - Date.now()) / 1000))
  return <span className={'countdown' + (left <= 5 ? ' urgent' : '')}>{left}</span>
}

/** 점수 계산 방식 안내 */
export function ScoreRules({ rules, compact }) {
  return (
    <div className={'card rules' + (compact ? ' compact' : '')}>
      <h4>🧮 점수 계산</h4>
      <ul>{rules.map((r) => <li key={r}>{r}</li>)}</ul>
    </div>
  )
}

const EMOJIS = ['👍', '😂', '😮', '👏', '🔥', '❤️', '🤔', '😭']

/** 팀즈처럼 화면 위로 날아가는 이모지 반응 (방 안 모두에게 보임) */
export function Reactions({ room, players }) {
  const [flying, setFlying] = useState([])
  const last = useRef(0)

  room.on('react', (d, from) => {
    if (!EMOJIS.includes(d?.emoji)) return
    const who = d.as || from
    const p = (players || room.players).find((x) => x.id === who)
    const item = { id: Math.random(), emoji: d.emoji, name: p?.nickname || '', x: 8 + Math.random() * 84, drift: (Math.random() - 0.5) * 80 }
    setFlying((f) => [...f.slice(-30), item])
    setTimeout(() => setFlying((f) => f.filter((i) => i.id !== item.id)), 3200)
  })

  const react = (emoji) => {
    const now = Date.now()
    if (now - last.current < 250) return // 연타 방지
    last.current = now
    room.send('react', { emoji })
  }

  return (
    <>
      <div className="card reactions">
        {EMOJIS.map((e) => (
          <button key={e} className="react-btn" onClick={() => react(e)} aria-label={`${e} 반응`}>{e}</button>
        ))}
      </div>
      <div className="fly-layer" aria-hidden>
        {flying.map((i) => (
          <div key={i.id} className="fly" style={{ left: `${i.x}%`, '--drift': `${i.drift}px` }}>
            <span className="fly-emoji">{i.emoji}</span>
            {i.name && <span className="fly-name">{i.name}</span>}
          </div>
        ))}
      </div>
    </>
  )
}
