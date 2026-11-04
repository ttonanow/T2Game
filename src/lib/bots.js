// 혼자 테스트할 때 같이 플레이하는 봇
export const BOT_NAMES = ['알파봇', '베타봇', '감마봇', '델타봇', '오메가봇']
const BOT_COLORS = ['#64748b', '#0ea5e9', '#84cc16', '#f43f5e', '#8b5cf6']
export const MAX_BOTS = BOT_NAMES.length

export const LEVELS = {
  easy: { label: '쉬움' },
  normal: { label: '보통' },
  hard: { label: '어려움' },
}

// 퀴즈: 정답률과 답하는 데 걸리는 시간(ms)
export const QUIZ_BOT = {
  easy: { acc: 0.45, min: 6000, max: 13000 },
  normal: { acc: 0.7, min: 3500, max: 9000 },
  hard: { acc: 0.92, min: 1500, max: 5000 },
}

// 그림 맞추기: 정답을 맞힐 확률과 맞히는 시점(ms)
export const DRAW_BOT = {
  easy: { p: 0.45, min: 45000, max: 75000 },
  normal: { p: 0.7, min: 25000, max: 55000 },
  hard: { p: 0.9, min: 10000, max: 30000 },
}

export const isBot = (id) => typeof id === 'string' && id.startsWith('bot-')

export function makeBots(existing, n) {
  const bots = [...existing]
  for (let i = 0; i < BOT_NAMES.length && bots.length < existing.length + n && bots.length < MAX_BOTS; i++) {
    const id = `bot-${i}`
    if (!bots.find((b) => b.id === id)) bots.push({ id, nickname: BOT_NAMES[i], color: BOT_COLORS[i], bot: true })
  }
  return bots
}

export const rand = (min, max) => min + Math.random() * (max - min)
export const pick = (arr) => arr[Math.floor(Math.random() * arr.length)]

const CHO = ['ㄱ', 'ㄲ', 'ㄴ', 'ㄷ', 'ㄸ', 'ㄹ', 'ㅁ', 'ㅂ', 'ㅃ', 'ㅅ', 'ㅆ', 'ㅇ', 'ㅈ', 'ㅉ', 'ㅊ', 'ㅋ', 'ㅌ', 'ㅍ', 'ㅎ']
/** 초성 힌트 (예: 눈사람 → ㄴㅅㄹ) */
export function chosung(word) {
  return [...word].map((ch) => {
    const c = ch.charCodeAt(0) - 0xac00
    return c >= 0 && c < 11172 ? CHO[Math.floor(c / 588)] : ch
  }).join('')
}

export const BOT_CHAT = ['음…', '이거 뭐지?', 'ㅋㅋㅋㅋ', '어렵다', '오 알 것 같은데', '잘 그리시네요 👏']
export const BOT_EMOJIS = ['👍', '😂', '😮', '👏', '🔥', '🤔']
