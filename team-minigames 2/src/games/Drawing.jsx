import { useEffect, useRef, useState } from 'react'
import { useParams } from 'react-router-dom'
import { useRoom } from '../lib/useRoom'
import { saveScore, shuffle } from '../lib/supabase'
import { useLocalDeadline, useNow } from '../lib/clock'
import { Countdown, Lobby, PlayerList, Reactions, RoomHeader, ScoreRules } from './RoomShell'
import { Results } from './Quiz'

const ROUND_TIME = 80000
const REVEAL_TIME = 5000
const W = 800
const H = 600
const COLORS = ['#111827', '#ef4444', '#f97316', '#eab308', '#22c55e', '#3b82f6', '#8b5cf6', '#ec4899', '#92400e', '#ffffff']
const SIZES = [4, 10, 24]

const WORDS = [
  '사과', '바나나', '고양이', '강아지', '자동차', '비행기', '우산', '안경', '컴퓨터', '커피',
  '눈사람', '무지개', '피자', '햄버거', '기린', '코끼리', '자전거', '시계', '카메라', '로켓',
  '등대', '선인장', '해바라기', '거북이', '문어', '아이스크림', '케이크', '기타', '피아노', '모자',
  '양말', '치킨', '라면', '김밥', '노트북', '마우스', '헤드폰', '텐트', '캠핑', '산',
  '화산', '번개', '달팽이', '펭귄', '상어', '나비', '꽃게', '수박', '딸기', '포도',
  '열쇠', '자물쇠', '전구', '연필', '가위', '택배', '엘리베이터', '회의', '야근', '출근',
]

const INITIAL = { phase: 'lobby', round: 0, order: [], drawerId: null, word: '', wordVer: 0, rerolled: false, winner: null, scores: {}, duration: 0, gameId: null }

const norm = (s) => s.replace(/\s+/g, '').toLowerCase()

// 점수 계산 (화면에 안내되는 규칙과 동일)
const GUESS_MAX = 300
const GUESS_MIN = 50
const DRAWER_BONUS = 100
const guessPoints = (elapsed) => Math.max(GUESS_MIN, Math.round(GUESS_MAX * Math.max(0, 1 - elapsed / ROUND_TIME)))

const DRAW_RULES = [
  `가장 먼저 맞힌 사람: 빨리 맞힐수록 높은 점수 (최대 ${GUESS_MAX}점 → 최소 ${GUESS_MIN}점)`,
  `그린 사람: 누군가 맞히면 +${DRAWER_BONUS}점`,
  '한 명이 맞히면 바로 다음 문제로 넘어가요',
  `제한 시간 ${ROUND_TIME / 1000}초 · 그리는 사람은 단어를 1번 바꿀 수 있어요`,
]

export default function Drawing({ me }) {
  const { code } = useParams()
  const room = useRoom('draw', code.toUpperCase(), me, INITIAL)
  const { state, isHost, setState, stateRef } = room
  useNow(250)
  const turnKey = `${state.gameId}-${state.round}`
  const roundKey = `${turnKey}-${state.wordVer}` // 단어를 바꾸면 그림판·타이머 초기화
  const endsAt = useLocalDeadline(`${roundKey}-${state.phase}`, state.duration)
  const isDrawer = state.phase === 'drawing' && state.drawerId === me.id
  const canSeeWord = isDrawer || state.phase === 'reveal'

  // ── 채팅
  const [chat, setChat] = useState([])
  const [text, setText] = useState('')
  const chatEnd = useRef(null)
  const pushChat = (m) => setChat((c) => [...c.slice(-80), { ...m, key: Math.random() }])
  useEffect(() => { chatEnd.current?.scrollIntoView({ block: 'nearest' }) }, [chat])

  const byId = Object.fromEntries(room.players.map((p) => [p.id, p]))
  const playersRef = useRef(room.players)
  playersRef.current = room.players

  room.on('chat', (m) => pushChat(m))

  // ── 호스트: 채팅/정답 판정
  room.on('guess', (data, from) => {
    if (!isHost) return
    const s = stateRef.current
    const nickname = playersRef.current.find((p) => p.id === from)?.nickname || '?'
    const text = data.text
    if (s.phase === 'drawing' && from === s.drawerId) {
      // 그리는 사람도 채팅 가능. 단, 정답이 들어간 말은 막기
      if (norm(text).includes(norm(s.word))) room.send('chat', { kind: 'system', text: '🙊 그리는 사람의 메시지에 정답이 들어 있어서 가렸어요' })
      else room.send('chat', { kind: 'guess', from, nickname, text })
      return
    }
    if (s.phase === 'drawing' && norm(text) === norm(s.word)) {
      const points = guessPoints(data.elapsed)
      const scores = { ...s.scores, [from]: (s.scores[from] || 0) + points, [s.drawerId]: (s.scores[s.drawerId] || 0) + DRAWER_BONUS }
      room.send('chat', { kind: 'correct', from, nickname, text, points, drawerName: playersRef.current.find((p) => p.id === s.drawerId)?.nickname })
      setState({ ...s, scores, winner: { id: from, points }, phase: 'reveal', duration: REVEAL_TIME })
      return
    }
    room.send('chat', { kind: 'guess', from, nickname, text })
  })

  // ── 호스트: 단어 새로고침 (그리는 사람, 라운드당 1회)
  room.on('reroll', (_d, from) => {
    if (!isHost) return
    const s = stateRef.current
    if (s.phase !== 'drawing' || from !== s.drawerId || s.rerolled) return
    const word = pickWord(s.used)
    setState({ ...s, word, used: [...(s.used || []), word], rerolled: true, wordVer: (s.wordVer || 0) + 1, duration: ROUND_TIME })
    room.send('chat', { kind: 'system', text: '🔄 그리는 사람이 단어를 바꿨어요. 타이머가 다시 시작돼요' })
  })

  // ── 호스트: 라운드 진행
  useEffect(() => {
    if (!isHost) return
    if (state.phase === 'drawing') {
      const t = setTimeout(() => {
        const s = stateRef.current
        if (s.phase === 'drawing' && s.round === state.round && s.wordVer === state.wordVer) setState({ ...s, winner: null, phase: 'reveal', duration: REVEAL_TIME })
      }, ROUND_TIME + 500)
      return () => clearTimeout(t)
    }
    if (state.phase === 'reveal') {
      const t = setTimeout(() => {
        const s = stateRef.current
        // 나간 사람 순서는 건너뛰기
        let next = s.round + 1
        const alive = new Set(playersRef.current.map((p) => p.id))
        while (next < s.order.length && !alive.has(s.order[next])) next++
        if (next >= s.order.length) setState({ ...s, phase: 'end', duration: 0 })
        else {
          const word = pickWord(s.used)
          setState({ ...s, phase: 'drawing', round: next, drawerId: s.order[next], word, used: [...(s.used || []), word], rerolled: false, wordVer: 0, winner: null, duration: ROUND_TIME })
        }
      }, REVEAL_TIME)
      return () => clearTimeout(t)
    }
  }, [isHost, state.phase, state.round, state.wordVer, state.gameId, setState, stateRef])

  // 라운드 시작/공개 알림
  useEffect(() => {
    if (state.phase === 'drawing') {
      const d = byId[state.drawerId]
      pushChat({ kind: 'system', text: `✏️ 라운드 ${state.round + 1}: ${d?.nickname || '?'}님이 그려요` })
    }
    if (state.phase === 'reveal') pushChat({ kind: 'system', text: state.winner ? `정답은 "${state.word}"! 곧 다음 문제로 넘어가요` : `⏰ 시간 초과! 정답은 "${state.word}" 였어요` })
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [turnKey, state.phase])

  // ── 게임 종료 시 내 점수 저장
  const savedFor = useRef(null)
  useEffect(() => {
    if (state.phase === 'end' && state.gameId && savedFor.current !== state.gameId) {
      savedFor.current = state.gameId
      const mine = state.scores[me.id]
      if (mine !== undefined) saveScore(me.id, 'drawing', mine, { room: code, players: Object.keys(state.scores).length })
    }
  }, [state.phase, state.gameId, state.scores, me.id, code])

  const start = () => {
    const order = shuffle(room.players.map((p) => p.id))
    const scores = Object.fromEntries(order.map((id) => [id, 0]))
    const word = pickWord([])
    setState({ phase: 'drawing', round: 0, order, drawerId: order[0], word, used: [word], rerolled: false, wordVer: 0, winner: null, scores, duration: ROUND_TIME, gameId: Date.now() })
    setChat([])
  }

  const roundStartLocal = useRef({ key: null, at: 0 })
  if (roundStartLocal.current.key !== roundKey) roundStartLocal.current = { key: roundKey, at: Date.now() }

  const sendGuess = (e) => {
    e.preventDefault()
    const t = text.trim()
    if (!t) return
    room.send('guess', { text: t.slice(0, 40), elapsed: Date.now() - roundStartLocal.current.at })
    setText('')
  }

  const hl = {}
  if (state.drawerId && state.phase === 'drawing') hl[state.drawerId] = '✏️'
  if (state.phase === 'reveal' && state.winner) {
    hl[state.winner.id] = `✓ +${state.winner.points}`
    hl[state.drawerId] = `✏️ +${DRAWER_BONUS}`
  }

  return (
    <div className="stack">
      <RoomHeader title="🎨 그림 맞추기" code={code.toUpperCase()} room={room} />

      {state.phase === 'lobby' && (
        <>
          <Lobby room={room} onStart={start} minPlayers={2} hint="모든 사람이 한 번씩 그려요." />
          <ScoreRules rules={DRAW_RULES} />
        </>
      )}

      {state.phase === 'end' && <Results scores={state.scores} players={room.players} meId={me.id} onRestart={isHost ? start : null} unit="점" />}

      {(state.phase === 'drawing' || state.phase === 'reveal') && (
        <div className="room-layout draw">
          <div className="stack">
            <div className="card row between wrap">
              <span className="pill">라운드 {state.round + 1} / {state.order.length}</span>
              <div className="row">
                <div className="word">
                  {canSeeWord ? state.word : state.word.split('').map(() => '＿').join(' ')}
                  {!canSeeWord && <span className="muted small"> ({state.word.length}글자)</span>}
                </div>
                {isDrawer && (
                  <button className="btn sm" disabled={state.rerolled} onClick={() => room.send('reroll', {})} title="라운드당 1번">
                    🔄 {state.rerolled ? '변경 완료' : '다른 단어 (1회)'}
                  </button>
                )}
              </div>
              {state.phase === 'drawing' ? <Countdown endsAt={endsAt} /> : <span className="pill">정답 공개</span>}
            </div>
            <Board room={room} me={me} isDrawer={isDrawer} roundKey={roundKey} />
            <Reactions room={room} />
          </div>
          <aside className="stack">
            <div className="card">
              <PlayerList room={room} scores={state.scores} highlight={hl} meId={me.id} />
            </div>
            <div className="card chat">
              <div className="chat-log">
                {chat.map((m) => (
                  <div key={m.key} className={'chat-line ' + m.kind}>
                    {m.kind === 'system' && m.text}
                    {m.kind === 'guess' && (<><b style={{ color: byId[m.from]?.color }}>{m.nickname}</b> {m.text}</>)}
                    {m.kind === 'correct' && (
                      <>
                        <span className="correct-tag">✅ 정답</span>
                        <b style={{ color: byId[m.from]?.color }}>{m.nickname}</b> {m.text}
                        <span className="correct-pts">+{m.points}{m.drawerName ? ` · ${m.drawerName} +${DRAWER_BONUS}` : ''}</span>
                      </>
                    )}
                  </div>
                ))}
                <div ref={chatEnd} />
              </div>
              <form className="row" onSubmit={sendGuess}>
                <input
                  className="input grow"
                  placeholder={isDrawer ? '채팅 (정답 단어는 가려져요)' : '정답이나 채팅을 입력하세요'}
                  value={text}
                  onChange={(e) => setText(e.target.value)}
                  maxLength={40}
                />
                <button className="btn">전송</button>
              </form>
            </div>
            <ScoreRules rules={DRAW_RULES} compact />
          </aside>
        </div>
      )}

      {state.phase === 'lobby' && (
        <div className="card"><h4>참가자</h4><PlayerList room={room} meId={me.id} /></div>
      )}
    </div>
  )
}

function pickWord(used = []) {
  const pool = WORDS.filter((w) => !used.includes(w))
  return (pool.length ? pool : WORDS)[Math.floor(Math.random() * (pool.length || WORDS.length))]
}

/** 실시간 그림판 */
function Board({ room, me, isDrawer, roundKey }) {
  const canvasRef = useRef(null)
  const [color, setColor] = useState(COLORS[0])
  const [size, setSize] = useState(SIZES[0])
  const drawing = useRef(null) // { id, last, pending: [] }
  const remote = useRef({}) // strokeId -> last point

  const ctx = () => canvasRef.current?.getContext('2d')
  const clear = () => {
    const c = ctx()
    if (!c) return
    c.fillStyle = '#fff'
    c.fillRect(0, 0, W, H)
  }
  const line = (from, to, col, sz) => {
    const c = ctx()
    if (!c) return
    c.strokeStyle = col
    c.lineWidth = sz
    c.lineCap = 'round'
    c.lineJoin = 'round'
    c.beginPath()
    c.moveTo(from[0], from[1])
    c.lineTo(to[0], to[1])
    c.stroke()
  }

  // 라운드가 바뀌면 캔버스 초기화
  useEffect(() => { clear(); remote.current = {} }, [roundKey])

  // 다른 사람 그림 수신
  room.on('stroke', (s, from) => {
    if (from === me.id) return
    let last = remote.current[s.id] || s.pts[0]
    for (const p of s.pts) { line(last, p, s.color, s.size); last = p }
    remote.current[s.id] = last
  })
  room.on('clear', (_d, from) => { if (from !== me.id) clear() })

  // 배치 전송 (50ms마다)
  useEffect(() => {
    if (!isDrawer) return
    const t = setInterval(() => {
      const d = drawing.current
      if (d && d.pending.length) {
        room.send('stroke', { id: d.id, color: d.color, size: d.size, pts: d.pending })
        d.pending = []
      }
    }, 50)
    return () => clearInterval(t)
  }, [isDrawer, room])

  const pos = (e) => {
    const r = canvasRef.current.getBoundingClientRect()
    return [Math.round(((e.clientX - r.left) / r.width) * W), Math.round(((e.clientY - r.top) / r.height) * H)]
  }

  const down = (e) => {
    if (!isDrawer) return
    e.currentTarget.setPointerCapture(e.pointerId)
    const p = pos(e)
    drawing.current = { id: `${me.id}-${Date.now()}`, last: p, pending: [p], color, size }
    line(p, p, color, size)
  }
  const move = (e) => {
    const d = drawing.current
    if (!isDrawer || !d) return
    const p = pos(e)
    line(d.last, p, d.color, d.size)
    d.last = p
    d.pending.push(p)
  }
  const up = () => {
    const d = drawing.current
    if (d && d.pending.length) room.send('stroke', { id: d.id, color: d.color, size: d.size, pts: d.pending })
    drawing.current = null
  }

  return (
    <div className="card board-card">
      <canvas
        ref={canvasRef}
        width={W}
        height={H}
        className={'canvas' + (isDrawer ? ' can-draw' : '')}
        onPointerDown={down}
        onPointerMove={move}
        onPointerUp={up}
        onPointerCancel={up}
      />
      {isDrawer && (
        <div className="row wrap tools">
          {COLORS.map((c) => (
            <button key={c} className={'swatch' + (color === c ? ' on' : '')} style={{ background: c }} onClick={() => setColor(c)} title={c === '#ffffff' ? '지우개' : c} />
          ))}
          <span className="sep" />
          {SIZES.map((s) => (
            <button key={s} className={'size' + (size === s ? ' on' : '')} onClick={() => setSize(s)}>
              <span style={{ width: s / 1.5 + 4, height: s / 1.5 + 4 }} />
            </button>
          ))}
          <span className="sep" />
          <button className="btn sm" onClick={() => { clear(); room.send('clear', {}) }}>전체 지우기</button>
        </div>
      )}
    </div>
  )
}
