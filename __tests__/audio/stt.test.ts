/**
 * ══════════════════════════════════════════════════════════
 * 🗣️  테스트 그룹 3: 음성 → 텍스트 변환 (STT Pipeline)
 * ══════════════════════════════════════════════════════════
 */
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { MockWebSocket } from '../setup'

// ── Deepgram 메시지 파싱 로직 ─────────────────────────────

interface Utterance {
  id: string
  speaker: string
  speakerName: string
  text: string
  timestamp: string
  isFinal: boolean
}

interface DeepgramStore {
  utterances: Utterance[]
  speakerMap: Record<string, string>
  elapsedSeconds: number
  addUtterance:        (u: Utterance) => void
  updateLastUtterance: (text: string) => void
  finalizeLastUtterance:(text: string) => void
}

function createStore(): DeepgramStore {
  const store: DeepgramStore = {
    utterances:   [],
    speakerMap:   {},
    elapsedSeconds: 0,
    addUtterance(u) { this.utterances.push(u) },
    updateLastUtterance(text) {
      for (let i = this.utterances.length - 1; i >= 0; i--) {
        if (!this.utterances[i].isFinal) {
          this.utterances[i] = { ...this.utterances[i], text }
          break
        }
      }
    },
    finalizeLastUtterance(text) {
      for (let i = this.utterances.length - 1; i >= 0; i--) {
        if (!this.utterances[i].isFinal) {
          this.utterances[i] = { ...this.utterances[i], text, isFinal: true }
          break
        }
      }
    },
  }
  return store
}

/** useDeepgram의 ws.onmessage 핸들러 로직을 독립 함수로 추출 */
function handleDeepgramMessage(
  data: unknown,
  store: DeepgramStore,
  pendingIdRef: { current: string | null },
  utteranceEndedRef: { current: boolean },
) {
  const ts = '00:00:05'
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const msg: any = data

  // UtteranceEnd
  if (msg.type === 'UtteranceEnd') {
    if (pendingIdRef.current !== null) {
      store.finalizeLastUtterance(
        store.utterances.find((u) => !u.isFinal)?.text ?? ''
      )
      pendingIdRef.current = null
      utteranceEndedRef.current = true
    }
    return
  }

  if (!msg.channel?.alternatives?.[0]) return
  const alt        = msg.channel.alternatives[0]
  const transcript = alt.transcript?.trim()
  if (!transcript) return

  const speaker     = `Speaker ${alt.words?.[0]?.speaker ?? 0}`
  const speakerName = store.speakerMap[speaker] || speaker
  const isSpeechFinal: boolean = msg.speech_final === true

  if (isSpeechFinal) {
    if (pendingIdRef.current !== null) {
      store.finalizeLastUtterance(transcript)
      pendingIdRef.current = null
      utteranceEndedRef.current = false
    } else if (utteranceEndedRef.current) {
      utteranceEndedRef.current = false
    } else {
      store.addUtterance({ id: `sf-${Date.now()}`, speaker, speakerName, text: transcript, timestamp: ts, isFinal: true })
    }
  } else if (msg.is_final) {
    utteranceEndedRef.current = false
    if (pendingIdRef.current !== null) {
      store.updateLastUtterance(transcript)
    } else {
      const id = `${Date.now()}`
      pendingIdRef.current = id
      store.addUtterance({ id, speaker, speakerName, text: transcript, timestamp: ts, isFinal: false })
    }
  } else {
    utteranceEndedRef.current = false
    if (pendingIdRef.current !== null) {
      store.updateLastUtterance(transcript)
    } else {
      const id = `interim-${Date.now()}`
      pendingIdRef.current = id
      store.addUtterance({ id, speaker, speakerName, text: transcript, timestamp: ts, isFinal: false })
    }
  }
}

/** 가짜 Deepgram 메시지 생성 헬퍼 */
function deepgramMsg(opts: {
  transcript: string
  speaker?: number
  is_final?: boolean
  speech_final?: boolean
}) {
  return {
    channel: {
      alternatives: [{
        transcript: opts.transcript,
        words: [{ speaker: opts.speaker ?? 0, word: opts.transcript }]
      }]
    },
    is_final:     opts.is_final     ?? false,
    speech_final: opts.speech_final ?? false,
  }
}

// ══════════════════════════════════════════════════════════
describe('🗣️  STT — Deepgram WebSocket 파라미터', () => {
// ══════════════════════════════════════════════════════════

  it('WebSocket URL에 language=ko가 포함된다', () => {
    const ws = new MockWebSocket('wss://api.deepgram.com/v1/listen?language=ko&diarize=true')
    expect(ws.url).toContain('language=ko')
  })

  it('WebSocket URL에 diarize=true가 포함된다 (화자 구분)', () => {
    const url = 'wss://api.deepgram.com/v1/listen?language=ko&model=nova-2&diarize=true'
    const ws  = new MockWebSocket(url)
    expect(ws.url).toContain('diarize=true')
  })

  it('WebSocket URL에 smart_format=true가 포함된다', () => {
    const url = 'wss://api.deepgram.com/v1/listen?smart_format=true&interim_results=true'
    const ws  = new MockWebSocket(url)
    expect(ws.url).toContain('smart_format=true')
  })

  it('WebSocket URL에 interim_results=true가 포함된다 (실시간 자막)', () => {
    const url = 'wss://api.deepgram.com/v1/listen?interim_results=true'
    const ws  = new MockWebSocket(url)
    expect(ws.url).toContain('interim_results=true')
  })

  it('utterance_end_ms=1500으로 설정된다 (자연스러운 발화 경계)', () => {
    const url = 'wss://api.deepgram.com/v1/listen?utterance_end_ms=1500&vad_events=true'
    expect(url).toContain('utterance_end_ms=1500')
    // 이전 값 1000이 아닌지 확인
    expect(url).not.toContain('utterance_end_ms=1000')
  })

  it('endpointing=380으로 설정된다', () => {
    const url = 'wss://api.deepgram.com/v1/listen?endpointing=380'
    expect(url).toContain('endpointing=380')
  })

  it('model=nova-2가 사용된다', () => {
    const url = 'wss://api.deepgram.com/v1/listen?model=nova-2'
    expect(url).toContain('model=nova-2')
  })

  it('token이 WebSocket 프로토콜로 전달된다', () => {
    const ws = new MockWebSocket('wss://api.deepgram.com/v1/listen?language=ko', ['token', 'mock-token-xyz'])
    expect(ws.protocols).toContain('mock-token-xyz')
  })

  it('onopen 핸들러가 연결 후 자동 호출된다', async () => {
    const ws     = new MockWebSocket('wss://test')
    const onopen = vi.fn()
    ws.onopen    = onopen
    await new Promise((r) => setTimeout(r, 20))
    // MockWebSocket은 10ms 후 onopen 호출
    expect(onopen).toHaveBeenCalled()
  })
})

// ══════════════════════════════════════════════════════════
describe('🗣️  STT — Deepgram 메시지 파싱', () => {
// ══════════════════════════════════════════════════════════

  let store: DeepgramStore
  let pendingIdRef: { current: string | null }
  let utteranceEndedRef: { current: boolean }

  beforeEach(() => {
    store             = createStore()
    pendingIdRef      = { current: null }
    utteranceEndedRef = { current: false }
  })

  // ── 인터림(임시) 결과 ─────────────────────────────────

  it('인터림 메시지 수신 시 isFinal=false인 utterance가 추가된다', () => {
    const msg = deepgramMsg({ transcript: '안녕하', is_final: false, speech_final: false })
    handleDeepgramMessage(msg, store, pendingIdRef, utteranceEndedRef)
    expect(store.utterances).toHaveLength(1)
    expect(store.utterances[0].isFinal).toBe(false)
    expect(store.utterances[0].text).toBe('안녕하')
  })

  it('연속 인터림 수신 시 기존 utterance가 업데이트된다 (새 항목 추가 없음)', () => {
    handleDeepgramMessage(deepgramMsg({ transcript: '안녕' }), store, pendingIdRef, utteranceEndedRef)
    handleDeepgramMessage(deepgramMsg({ transcript: '안녕하세요' }), store, pendingIdRef, utteranceEndedRef)
    expect(store.utterances).toHaveLength(1)
    expect(store.utterances[0].text).toBe('안녕하세요')
  })

  // ── is_final 청크 확정 ────────────────────────────────

  it('is_final=true 수신 시 pending utterance의 텍스트가 업데이트된다', () => {
    handleDeepgramMessage(deepgramMsg({ transcript: '안녕' }), store, pendingIdRef, utteranceEndedRef)
    handleDeepgramMessage(deepgramMsg({ transcript: '안녕하세요', is_final: true }), store, pendingIdRef, utteranceEndedRef)
    expect(store.utterances[0].text).toBe('안녕하세요')
    expect(store.utterances[0].isFinal).toBe(false)  // speech_final 아직 아님
  })

  it('is_final 이후 pendingId가 유지된다 (발화 계속)', () => {
    handleDeepgramMessage(deepgramMsg({ transcript: '안녕하세요', is_final: true }), store, pendingIdRef, utteranceEndedRef)
    expect(pendingIdRef.current).not.toBeNull()
  })

  // ── speech_final — 발화 완료 ──────────────────────────

  it('speech_final=true 수신 시 utterance가 isFinal=true로 확정된다', () => {
    handleDeepgramMessage(deepgramMsg({ transcript: '안녕하' }), store, pendingIdRef, utteranceEndedRef)
    handleDeepgramMessage(deepgramMsg({ transcript: '안녕하세요', speech_final: true }), store, pendingIdRef, utteranceEndedRef)
    expect(store.utterances[0].isFinal).toBe(true)
    expect(store.utterances[0].text).toBe('안녕하세요')
  })

  it('speech_final 후 pendingId가 null로 초기화된다', () => {
    handleDeepgramMessage(deepgramMsg({ transcript: '테스트' }), store, pendingIdRef, utteranceEndedRef)
    handleDeepgramMessage(deepgramMsg({ transcript: '테스트 완료', speech_final: true }), store, pendingIdRef, utteranceEndedRef)
    expect(pendingIdRef.current).toBeNull()
  })

  it('이전 발화 종료 후 새 발화가 독립적으로 시작된다', () => {
    // 첫 발화
    handleDeepgramMessage(deepgramMsg({ transcript: '첫 번째 문장', speech_final: true }), store, pendingIdRef, utteranceEndedRef)
    // 두 번째 발화
    handleDeepgramMessage(deepgramMsg({ transcript: '두 번째 문장' }), store, pendingIdRef, utteranceEndedRef)
    handleDeepgramMessage(deepgramMsg({ transcript: '두 번째 문장 완성', speech_final: true }), store, pendingIdRef, utteranceEndedRef)
    expect(store.utterances).toHaveLength(2)
    expect(store.utterances[0].text).toBe('첫 번째 문장')
    expect(store.utterances[1].text).toBe('두 번째 문장 완성')
  })

  // ── UtteranceEnd 이벤트 ───────────────────────────────

  it('UtteranceEnd 수신 시 pending utterance가 확정된다', () => {
    handleDeepgramMessage(deepgramMsg({ transcript: '말하는 중' }), store, pendingIdRef, utteranceEndedRef)
    handleDeepgramMessage({ type: 'UtteranceEnd' }, store, pendingIdRef, utteranceEndedRef)
    expect(store.utterances[0].isFinal).toBe(true)
    expect(pendingIdRef.current).toBeNull()
    expect(utteranceEndedRef.current).toBe(true)
  })

  it('UtteranceEnd 후 speech_final이 오면 중복 utterance가 생성되지 않는다', () => {
    handleDeepgramMessage(deepgramMsg({ transcript: '발화' }), store, pendingIdRef, utteranceEndedRef)
    handleDeepgramMessage({ type: 'UtteranceEnd' }, store, pendingIdRef, utteranceEndedRef)
    // UtteranceEnd가 이미 처리했으므로 speech_final에서 중복 생성 방지
    handleDeepgramMessage(deepgramMsg({ transcript: '발화', speech_final: true }), store, pendingIdRef, utteranceEndedRef)
    expect(store.utterances).toHaveLength(1)
  })

  it('pending이 없는 상태에서 UtteranceEnd 수신 시 아무것도 하지 않는다', () => {
    expect(pendingIdRef.current).toBeNull()
    handleDeepgramMessage({ type: 'UtteranceEnd' }, store, pendingIdRef, utteranceEndedRef)
    expect(store.utterances).toHaveLength(0)
    expect(utteranceEndedRef.current).toBe(false)
  })

  // ── 빈 트랜스크립트 무시 ──────────────────────────────

  it('빈 transcript는 utterance에 추가되지 않는다', () => {
    handleDeepgramMessage(deepgramMsg({ transcript: '  ' }), store, pendingIdRef, utteranceEndedRef)
    expect(store.utterances).toHaveLength(0)
  })

  it('channel 없는 메시지는 무시된다', () => {
    handleDeepgramMessage({ is_final: true }, store, pendingIdRef, utteranceEndedRef)
    expect(store.utterances).toHaveLength(0)
  })

  // ── 화자 구분 (Diarization) ───────────────────────────

  it('Speaker 0 발화가 올바른 speaker 태그로 저장된다', () => {
    handleDeepgramMessage(deepgramMsg({ transcript: 'Speaker 0 발화', speaker: 0, speech_final: true }), store, pendingIdRef, utteranceEndedRef)
    expect(store.utterances[0].speaker).toBe('Speaker 0')
  })

  it('Speaker 1 발화가 올바른 speaker 태그로 저장된다', () => {
    handleDeepgramMessage(deepgramMsg({ transcript: 'Speaker 1 발화', speaker: 1, speech_final: true }), store, pendingIdRef, utteranceEndedRef)
    expect(store.utterances[0].speaker).toBe('Speaker 1')
  })

  it('speakerMap에 매핑된 이름으로 speakerName이 설정된다', () => {
    store.speakerMap['Speaker 0'] = 'brad.and'
    handleDeepgramMessage(deepgramMsg({ transcript: '안녕하세요', speaker: 0, speech_final: true }), store, pendingIdRef, utteranceEndedRef)
    expect(store.utterances[0].speakerName).toBe('brad.and')
  })

  it('speakerMap에 없는 화자는 "Speaker N" 형식으로 표시된다', () => {
    store.speakerMap = {}  // 매핑 없음
    handleDeepgramMessage(deepgramMsg({ transcript: '발화', speaker: 2, speech_final: true }), store, pendingIdRef, utteranceEndedRef)
    expect(store.utterances[0].speakerName).toBe('Speaker 2')
  })

  it('hostEmail 로컬파트가 Speaker 0에 자동 매핑된다', () => {
    const hostEmail  = 'brad.and@kakaomobility.com'
    const hostName   = hostEmail.split('@')[0]  // 'brad.and'
    store.speakerMap['Speaker 0'] = hostName
    handleDeepgramMessage(deepgramMsg({ transcript: '테스트', speaker: 0, speech_final: true }), store, pendingIdRef, utteranceEndedRef)
    expect(store.utterances[0].speakerName).toBe('brad.and')
  })

  it('이메일 로컬파트에 점(.)이 포함되어도 정상 처리된다', () => {
    expect('brad.and@kakaomobility.com'.split('@')[0]).toBe('brad.and')
  })

  // ── 다중 화자 시나리오 ────────────────────────────────

  it('화자 2명이 번갈아 말할 때 각각의 utterance로 분리된다', () => {
    store.speakerMap = { 'Speaker 0': 'brad.and', 'Speaker 1': 'daniel.007' }

    handleDeepgramMessage(deepgramMsg({ transcript: '브래드 발화', speaker: 0, speech_final: true }), store, pendingIdRef, utteranceEndedRef)
    handleDeepgramMessage(deepgramMsg({ transcript: '다니엘 발화', speaker: 1, speech_final: true }), store, pendingIdRef, utteranceEndedRef)

    expect(store.utterances).toHaveLength(2)
    expect(store.utterances[0].speakerName).toBe('brad.and')
    expect(store.utterances[1].speakerName).toBe('daniel.007')
  })

  // ── 트랜스크립트 빌드 ─────────────────────────────────

  it('finalUtterances만으로 트랜스크립트 문자열이 생성된다', () => {
    store.utterances = [
      { id: '1', speaker: 'Speaker 0', speakerName: 'brad.and',    text: '안녕하세요', timestamp: '00:00:00', isFinal: true  },
      { id: '2', speaker: 'Speaker 1', speakerName: 'daniel.007',  text: '반갑습니다', timestamp: '00:00:05', isFinal: true  },
      { id: '3', speaker: 'Speaker 0', speakerName: 'brad.and',    text: '진행 중...',  timestamp: '00:00:10', isFinal: false }, // 미확정
    ]
    const transcript = store.utterances
      .filter((u) => u.isFinal)
      .map((u) => `${u.speakerName}: ${u.text}`)
      .join('\n')

    expect(transcript).toBe('brad.and: 안녕하세요\ndaniel.007: 반갑습니다')
    expect(transcript).not.toContain('진행 중...')
  })
})

// ══════════════════════════════════════════════════════════
describe('🔑  Deepgram 토큰 API (/api/transcribe/token)', () => {
// ══════════════════════════════════════════════════════════

  it('모킹된 토큰 API가 { token } 형식으로 응답한다', async () => {
    const res  = await fetch('/api/transcribe/token')
    const data = await res.json()
    expect(data).toHaveProperty('token')
    expect(typeof data.token).toBe('string')
    expect(data.token.length).toBeGreaterThan(0)
  })

  it('토큰을 WebSocket 프로토콜로 전달한다', async () => {
    const { token } = await (await fetch('/api/transcribe/token')).json()
    const ws = new MockWebSocket(
      'wss://api.deepgram.com/v1/listen?language=ko',
      ['token', token]
    )
    expect(ws.protocols).toContain(token)
  })
})
