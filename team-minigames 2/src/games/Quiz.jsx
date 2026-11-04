import { useEffect, useRef } from 'react'
import { useParams, useSearchParams } from 'react-router-dom'
import { useRoom } from '../lib/useRoom'
import { saveScore, shuffle } from '../lib/supabase'
import { useLocalDeadline, useNow } from '../lib/clock'
import { QUIZ_BANK } from './quizBank'
import { BotControls, Countdown, Lobby, PlayerList, Reactions, RoomHeader, ScoreRules } from './RoomShell'
import { BOT_EMOJIS, QUIZ_BOT, makeBots, pick, rand } from '../lib/bots'
import { Avatar } from '../App'

const QUESTIONS = 10
const Q_TIME = 15000
const REVEAL_TIME = 4000
const LABELS = ['A', 'B', 'C', 'D']

const QUIZ_RULES = [
  '정답: 기본 500점 + 속도 보너스 최대 500점 (빨리 맞힐수록 높음)',
  '오답·시간 초과: 0점',
  `문제당 ${Q_TIME / 1000}초 · 총 ${QUESTIONS}문제 · 모두 답하면 바로 정답 공개`,
]

const INITIAL = { bots: [], botLevel: 'normal', phase: 'lobby', qIndex: 0, questions: [], scores: {}, answers: {}, duration: 0, gameId: null }

export default function Quiz({ me }) {
  const { code } = useParams()
  const room = useRoom('quiz', code.toUpperCase(), me, INITIAL)
  const { state, isHost, setState, stateRef } = room
  useNow(250)
  const qStartLocal = useRef({ key: null, at: 0 })

  const key = `${state.gameId}-${state.phase}-${state.qIndex}`
  const endsAt = useLocalDeadline(key, state.duration)
  if (state.phase === 'question' && qStartLocal.current.key !== key) qStartLocal.current = { key, at: Date.now() }

  const allPlayers = [...room.players, ...(state.bots || [])]
  const allRef = useRef(allPlayers)
  allRef.current = allPlayers

  // ── 호스트: 채점 (사람/봇 공통)
  const applyAnswer = (from, qIndex, choice, elapsed) => {
    const s = stateRef.current
    if (s.phase !== 'question' || qIndex !== s.qIndex || s.answers[from]) return
    const q = s.questions[s.qIndex]
    const correct = choice === q.a
    const remaining = Math.max(0, 1 - elapsed / Q_TIME)
    const points = correct ? 500 + Math.round(500 * remaining) : 0
    const answers = { ...s.answers, [from]: { choice, correct, points } }
    const scores = { ...s.scores, [from]: (s.scores[from] || 0) + points }
    const allIn = allRef.current.every((p) => answers[p.id])
    setState({ ...s, answers, scores, ...(allIn ? { phase: 'reveal', duration: REVEAL_TIME } : {}) })
  }
  const applyRef = useRef(applyAnswer)
  applyRef.current = applyAnswer

  room.on('answer', (data, from) => {
    if (isHost) applyAnswer(from, data.qIndex, data.choice, data.elapsed)
  })

  // ── 호스트: 봇이 문제 풀기
  useEffect(() => {
    if (!isHost) return
    const s = stateRef.current
    const bots = s.bots || []
    if (!bots.length) return
    const timers = []
    if (s.phase === 'question') {
      const cfg = QUIZ_BOT[s.botLevel] || QUIZ_BOT.normal
      const q = s.questions[s.qIndex]
      for (const b of bots) {
        const ms = rand(cfg.min, Math.min(cfg.max, Q_TIME - 300))
        const choice = Math.random() < cfg.acc ? q.a : pick([0, 1, 2, 3].filter((i) => i !== q.a))
        timers.push(setTimeout(() => applyRef.current(b.id, s.qIndex, choice, ms), ms))
      }
    }
    if (s.phase === 'reveal') {
      for (const b of bots) {
        if (Math.random() < 0.35) timers.push(setTimeout(() => room.send('react', { emoji: pick(BOT_EMOJIS), as: b.id }), rand(200, 2500)))
      }
    }
    return () => timers.forEach(clearTimeout)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isHost, state.phase, state.qIndex, state.gameId])

  // 연습 모드로 들어오면 봇 자동 추가 (?bots=3)
  const [params] = useSearchParams()
  const autoBots = useRef(false)
  useEffect(() => {
    const n = Number(params.get('bots'))
    if (isHost && n && !autoBots.current && state.phase === 'lobby') {
      autoBots.current = true
      setState((s) => ({ ...s, bots: makeBots(s.bots || [], n) }))
    }
  }, [isHost, params, state.phase, setState])

  // ── 호스트: 타이머 진행
  useEffect(() => {
    if (!isHost) return
    if (state.phase === 'question') {
      const t = setTimeout(() => {
        const s = stateRef.current
        if (s.phase === 'question' && s.qIndex === state.qIndex) setState({ ...s, phase: 'reveal', duration: REVEAL_TIME })
      }, Q_TIME + 500)
      return () => clearTimeout(t)
    }
    if (state.phase === 'reveal') {
      const t = setTimeout(() => {
        const s = stateRef.current
        if (s.qIndex + 1 >= s.questions.length) setState({ ...s, phase: 'end', duration: 0 })
        else setState({ ...s, phase: 'question', qIndex: s.qIndex + 1, answers: {}, duration: Q_TIME })
      }, REVEAL_TIME)
      return () => clearTimeout(t)
    }
  }, [isHost, state.phase, state.qIndex, state.gameId, setState, stateRef])

  // ── 모두: 게임 종료 시 내 점수 저장 (한 번만)
  const savedFor = useRef(null)
  useEffect(() => {
    if (state.phase === 'end' && state.gameId && savedFor.current !== state.gameId) {
      savedFor.current = state.gameId
      const mine = state.scores[me.id]
      // 봇과 한 연습 게임은 랭킹에 저장하지 않음
      if (mine !== undefined && !(state.bots || []).length) {
        const rank = Object.values(state.scores).filter((v) => v > mine).length + 1
        saveScore(me.id, 'quiz', mine, { room: code, rank, players: Object.keys(state.scores).length })
      }
    }
  }, [state.phase, state.gameId, state.scores, me.id, code])

  const start = () => {
    const questions = shuffle(QUIZ_BANK).slice(0, QUESTIONS).map((q) => {
      // 보기 순서도 섞기
      const order = shuffle([0, 1, 2, 3])
      return { q: q.q, c: order.map((i) => q.c[i]), a: order.indexOf(q.a) }
    })
    const scores = Object.fromEntries(allRef.current.map((p) => [p.id, 0]))
    setState((s) => ({ ...s, phase: 'question', qIndex: 0, questions, scores, answers: {}, duration: Q_TIME, gameId: Date.now() }))
  }

  const answer = (choice) => {
    if (state.answers[me.id]) return
    room.send('answer', { qIndex: state.qIndex, choice, elapsed: Date.now() - qStartLocal.current.at })
  }

  const q = state.questions[state.qIndex]
  const myAnswer = state.answers[me.id]
  const answeredHl = Object.fromEntries(
    Object.entries(state.answers).map(([id, a]) => [id, state.phase === 'reveal' ? (a.correct ? `+${a.points}` : '✗') : '✓']),
  )

  return (
    <div className="stack">
      <RoomHeader title="🧠 실시간 퀴즈" code={code.toUpperCase()} room={room} />
      <div className="room-layout">
        <div className="stack">
          {state.phase === 'lobby' && <Lobby room={room} count={allPlayers.length} onStart={start} hint={`문제 ${QUESTIONS}개, 문제당 ${Q_TIME / 1000}초`} />}
          {state.phase === 'lobby' && <BotControls room={room} />}
          {state.phase === 'lobby' && <ScoreRules rules={QUIZ_RULES} />}

          {(state.phase === 'question' || state.phase === 'reveal') && q && (
            <div className="card stack">
              <div className="row between">
                <span className="pill">문제 {state.qIndex + 1} / {state.questions.length}</span>
                {state.phase === 'question' ? <Countdown endsAt={endsAt} /> : <span className="pill">정답 공개</span>}
              </div>
              {state.phase === 'question' && (
                <div className="progress"><div style={{ width: `${Math.max(0, (endsAt - Date.now()) / Q_TIME) * 100}%` }} /></div>
              )}
              <h2 className="question">{q.q}</h2>
              <div className="choices">
                {q.c.map((c, i) => {
                  let cls = 'choice c' + i
                  if (myAnswer?.choice === i) cls += ' picked'
                  if (state.phase === 'reveal') cls += i === q.a ? ' correct' : ' dim'
                  return (
                    <button key={i} className={cls} disabled={!!myAnswer || state.phase !== 'question'} onClick={() => answer(i)}>
                      <span className="choice-label">{LABELS[i]}</span>{c}
                    </button>
                  )
                })}
              </div>
              <p className="muted small center-text">
                {state.phase === 'question'
                  ? myAnswer ? '제출 완료! 다른 사람을 기다리는 중…' : '빠를수록 점수가 높아요'
                  : myAnswer?.correct ? `정답! +${myAnswer.points}점 🎉` : myAnswer ? '아쉬워요 😢' : '시간 초과 ⏰'}
              </p>
            </div>
          )}

          {state.phase !== 'lobby' && <Reactions room={room} players={allPlayers} />}

          {state.phase === 'end' && <Results scores={state.scores} players={allPlayers} practice={(state.bots || []).length > 0} meId={me.id} onRestart={room.isHost ? start : null} unit="점" />}
        </div>
        <aside className="stack">
          <div className="card">
            <h4>참가자</h4>
            <PlayerList room={room} players={allPlayers} scores={state.scores} highlight={answeredHl} meId={me.id} />
          </div>
          {state.phase !== 'lobby' && <ScoreRules rules={QUIZ_RULES} compact />}
        </aside>
      </div>
    </div>
  )
}

export function Results({ scores, players, meId, onRestart, unit, practice }) {
  const byId = Object.fromEntries(players.map((p) => [p.id, p]))
  const ranked = Object.entries(scores).sort((a, b) => b[1] - a[1])
  return (
    <div className="card stack center-text">
      <div className="big-emoji">🏆</div>
      <h2>최종 결과</h2>
      <ol className="board podium">
        {ranked.map(([id, s], i) => (
          <li key={id} className={id === meId ? 'me' : ''}>
            <span className="rank">{['🥇', '🥈', '🥉'][i] || i + 1}</span>
            <Avatar p={byId[id] || { nickname: '?' }} size={28} />
            <span className="grow">{byId[id]?.nickname || '(나감)'}</span>
            <b>{s.toLocaleString()}{unit}</b>
          </li>
        ))}
      </ol>
      <p className="muted small">{practice ? '🤖 봇과 한 연습 게임이라 랭킹에는 반영되지 않아요.' : '점수가 랭킹에 반영됐어요.'}</p>
      {onRestart ? <button className="btn primary" onClick={onRestart}>한 판 더!</button> : <p className="muted small">방장이 새 게임을 시작할 수 있어요.</p>}
    </div>
  )
}
