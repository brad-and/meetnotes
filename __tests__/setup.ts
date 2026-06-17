/**
 * ══════════════════════════════════════════════════════════
 * MeetNotes 테스트 환경 설정
 * Web Audio API, MediaRecorder, WebSocket, getUserMedia 모킹
 * ══════════════════════════════════════════════════════════
 */
import { vi } from 'vitest'

// ── Web Audio API 모킹 ────────────────────────────────────

export const mockGainNode = {
  gain: { value: 1.0 },
  connect: vi.fn(),
  disconnect: vi.fn(),
}

export const mockCompressorNode = {
  threshold: { value: 0 },
  knee:      { value: 0 },
  ratio:     { value: 1 },
  attack:    { value: 0 },
  release:   { value: 0 },
  connect:   vi.fn(),
  disconnect: vi.fn(),
}

export const mockAnalyserNode = {
  fftSize: 2048,
  smoothingTimeConstant: 0.8,
  connect:   vi.fn(),
  disconnect: vi.fn(),
  /** 기본: 무음 (128 = 0 진폭) */
  getByteTimeDomainData: vi.fn((arr: Uint8Array) => arr.fill(128)),
}

export const mockSourceNode = {
  connect:    vi.fn(),
  disconnect: vi.fn(),
}

export const mockDestinationNode = {
  connect:    vi.fn(),
  disconnect: vi.fn(),
  stream: {
    getAudioTracks: vi.fn(() => [{ readyState: 'live', stop: vi.fn() }]),
    getTracks:      vi.fn(() => [{ readyState: 'live', stop: vi.fn() }]),
  },
}

export const mockAudioContext = {
  state: 'suspended' as AudioContextState,
  sampleRate: 48000,
  resume:  vi.fn(async () => { mockAudioContext.state = 'running' }),
  close:   vi.fn(async () => { mockAudioContext.state = 'closed' }),
  suspend: vi.fn(async () => { mockAudioContext.state = 'suspended' }),
  createMediaStreamSource:   vi.fn(() => mockSourceNode),
  createGain:                vi.fn(() => mockGainNode),
  createDynamicsCompressor:  vi.fn(() => mockCompressorNode),
  createAnalyser:            vi.fn(() => mockAnalyserNode),
  createMediaStreamDestination: vi.fn(() => mockDestinationNode),
}

global.AudioContext = vi.fn(() => mockAudioContext) as unknown as typeof AudioContext

// ── MediaRecorder 모킹 ────────────────────────────────────
export const mockMediaRecorder = {
  state: 'inactive' as RecordingState,
  ondataavailable: null as ((e: BlobEvent) => void) | null,
  onerror:  null as ((e: Event) => void) | null,
  start:    vi.fn(function(this: typeof mockMediaRecorder) { this.state = 'recording' }),
  stop:     vi.fn(function(this: typeof mockMediaRecorder) { this.state = 'inactive'  }),
  pause:    vi.fn(function(this: typeof mockMediaRecorder) { this.state = 'paused'    }),
  resume:   vi.fn(function(this: typeof mockMediaRecorder) { this.state = 'recording' }),
}

global.MediaRecorder = vi.fn(() => mockMediaRecorder) as unknown as typeof MediaRecorder
;(global.MediaRecorder as unknown as { isTypeSupported: (t: string) => boolean }).isTypeSupported =
  vi.fn((type: string) =>
    ['audio/webm;codecs=opus', 'audio/webm', 'audio/ogg;codecs=opus'].includes(type)
  )

// ── getUserMedia 모킹 ─────────────────────────────────────
export const mockStream = {
  getTracks:      vi.fn(() => [{ stop: vi.fn(), readyState: 'live' }]),
  getAudioTracks: vi.fn(() => [{ stop: vi.fn(), readyState: 'live' }]),
}

Object.defineProperty(global.navigator, 'mediaDevices', {
  value: {
    getUserMedia:    vi.fn(async () => mockStream),
    enumerateDevices: vi.fn(async () => [
      { deviceId: 'default', kind: 'audioinput', label: 'MacBook Pro Microphone' },
      { deviceId: 'ext-001',  kind: 'audioinput', label: 'Jabra Speak 510 Microphone' },
    ]),
    addEventListener:    vi.fn(),
    removeEventListener: vi.fn(),
  },
  writable: true,
})

// ── WebSocket 모킹 ────────────────────────────────────────
export class MockWebSocket {
  url: string
  protocols?: string | string[]
  readyState = 1 // OPEN
  onopen:    ((e: Event) => void) | null = null
  onmessage: ((e: MessageEvent) => void) | null = null
  onerror:   ((e: Event) => void) | null = null
  onclose:   ((e: CloseEvent) => void) | null = null
  sentData:  unknown[] = []

  constructor(url: string, protocols?: string | string[]) {
    this.url = url
    this.protocols = protocols
    // 다음 틱에 onopen 자동 호출 (비동기 연결 시뮬레이션)
    setTimeout(() => this.onopen?.(new Event('open')), 10)
  }

  send  = vi.fn((data: unknown) => { this.sentData.push(data) })
  close = vi.fn(() => { this.readyState = 3 })

  /** 테스트에서 Deepgram 응답을 시뮬레이션할 때 사용 */
  simulateMessage(data: unknown) {
    this.onmessage?.(new MessageEvent('message', { data: JSON.stringify(data) }))
  }
}

global.WebSocket = MockWebSocket as unknown as typeof WebSocket

// ── fetch 모킹 (토큰 발급 API) ────────────────────────────
global.fetch = vi.fn(async (url: string) => {
  if (typeof url === 'string' && url.includes('/api/transcribe/token')) {
    return { ok: true, json: async () => ({ token: 'mock-token-xyz' }) } as Response
  }
  return { ok: false, json: async () => ({}) } as Response
})
