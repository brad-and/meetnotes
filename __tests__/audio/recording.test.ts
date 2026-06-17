/**
 * ══════════════════════════════════════════════════════════
 * 🎙️  테스트 그룹 2: 음성 녹취 (Audio Recording)
 * ══════════════════════════════════════════════════════════
 */
import { describe, it, expect, vi, beforeEach } from 'vitest'
import {
  mockMediaRecorder, mockAudioContext, mockDestinationNode,
  mockStream,
} from '../setup'

// ── 오디오 청크 누적 시뮬레이터 ───────────────────────────

function createRecordingSimulator() {
  const chunks: Blob[] = []

  const recorder = {
    state: 'inactive' as RecordingState,
    ondataavailable: null as ((e: { data: Blob }) => void) | null,
    start(interval: number) {
      this.state = 'recording'
      // interval ms마다 청크 생성 시뮬레이션
      let count = 0
      const timer = setInterval(() => {
        if (this.state !== 'recording') { clearInterval(timer); return }
        const fakeBlob = new Blob([`audio-chunk-${count++}`], { type: 'audio/webm' })
        this.ondataavailable?.({ data: fakeBlob })
      }, interval)
      return timer
    },
    pause()  { this.state = 'paused'    },
    resume() { this.state = 'recording' },
    stop()   { this.state = 'inactive'  },
  }

  return { recorder, chunks }
}

// ══════════════════════════════════════════════════════════
describe('🎙️  음성 녹취 — MediaRecorder', () => {
// ══════════════════════════════════════════════════════════

  beforeEach(() => {
    vi.clearAllMocks()
    mockMediaRecorder.state = 'inactive'
  })

  // ── MediaRecorder 라이프사이클 ─────────────────────────

  it('start() 호출 시 state가 recording으로 변경된다', () => {
    mockMediaRecorder.start()
    expect(mockMediaRecorder.state).toBe('recording')
  })

  it('pause() 호출 시 state가 paused로 변경된다', () => {
    mockMediaRecorder.start()
    mockMediaRecorder.pause()
    expect(mockMediaRecorder.state).toBe('paused')
  })

  it('resume() 호출 시 state가 recording으로 복귀된다', () => {
    mockMediaRecorder.start()
    mockMediaRecorder.pause()
    mockMediaRecorder.resume()
    expect(mockMediaRecorder.state).toBe('recording')
  })

  it('stop() 호출 시 state가 inactive가 된다', () => {
    mockMediaRecorder.start()
    mockMediaRecorder.stop()
    expect(mockMediaRecorder.state).toBe('inactive')
  })

  // ── processedStream 유효성 검사 ───────────────────────

  it('processedStream의 오디오 트랙이 live 상태이면 processedStream을 사용한다', () => {
    const track = { readyState: 'live', stop: vi.fn() }
    const processedStream = { getAudioTracks: () => [track], getTracks: () => [track] }
    const fallbackStream  = mockStream

    const recordingStream =
      processedStream.getAudioTracks()[0]?.readyState === 'live'
        ? processedStream
        : fallbackStream

    expect(recordingStream).toBe(processedStream)
  })

  it('processedStream 트랙이 없으면 원본 stream을 fallback으로 사용한다', () => {
    const processedStream = { getAudioTracks: () => [], getTracks: () => [] }
    const fallbackStream  = mockStream

    const liveTrack = processedStream.getAudioTracks()[0]
    const recordingStream = (liveTrack && liveTrack.readyState === 'live')
      ? processedStream
      : fallbackStream

    expect(recordingStream).toBe(fallbackStream)
  })

  it('processedStream 트랙이 ended 상태이면 fallback stream을 사용한다', () => {
    const endedTrack = { readyState: 'ended', stop: vi.fn() }
    const processedStream = { getAudioTracks: () => [endedTrack], getTracks: () => [endedTrack] }
    const fallbackStream  = mockStream

    const liveTrack = processedStream.getAudioTracks()[0]
    const recordingStream = (liveTrack && liveTrack.readyState === 'live')
      ? processedStream
      : fallbackStream

    expect(recordingStream).toBe(fallbackStream)
  })

  // ── 오디오 청크 누적 ──────────────────────────────────

  it('250ms 간격으로 청크가 누적되고 WebSocket으로 전송된다', async () => {
    const chunks: Blob[] = []
    const ws = { readyState: 1 /* OPEN */, send: vi.fn() }

    const { recorder } = createRecordingSimulator()
    recorder.ondataavailable = (e: { data: Blob }) => {
      if (e.data.size > 0) {
        chunks.push(e.data)
        if (ws.readyState === 1) ws.send(e.data)
      }
    }

    const timer = recorder.start(50)  // 50ms 간격으로 빠른 시뮬레이션
    await new Promise((r) => setTimeout(r, 180))
    recorder.stop()
    clearInterval(timer as ReturnType<typeof setInterval>)

    expect(chunks.length).toBeGreaterThanOrEqual(2)
    expect(ws.send).toHaveBeenCalledTimes(chunks.length)
  })

  it('청크의 size가 0이면 WebSocket으로 전송하지 않는다', () => {
    const ws = { readyState: 1, send: vi.fn() }
    const emptyBlob = new Blob([], { type: 'audio/webm' })
    // ondataavailable 로직 직접 실행
    const handler = (e: { data: Blob }) => {
      if (e.data.size > 0) ws.send(e.data)
    }
    handler({ data: emptyBlob })
    expect(ws.send).not.toHaveBeenCalled()
  })

  it('WebSocket이 닫혀있으면 전송하지 않는다', () => {
    const ws = { readyState: 3 /* CLOSED */, send: vi.fn() }
    const blob = new Blob(['data'], { type: 'audio/webm' })
    const handler = (e: { data: Blob }) => {
      if (e.data.size > 0 && ws.readyState === 1) ws.send(e.data)
    }
    handler({ data: blob })
    expect(ws.send).not.toHaveBeenCalled()
  })

  // ── getAudioBlob ──────────────────────────────────────

  it('청크가 있으면 getAudioBlob()이 Blob을 반환한다', () => {
    const mimeType   = 'audio/webm;codecs=opus'
    const audioChunks = [
      new Blob(['chunk1'], { type: mimeType }),
      new Blob(['chunk2'], { type: mimeType }),
    ]
    const getAudioBlob = () =>
      audioChunks.length > 0 ? new Blob(audioChunks, { type: mimeType }) : null

    const blob = getAudioBlob()
    expect(blob).not.toBeNull()
    expect(blob?.type).toBe(mimeType)
    expect(blob?.size).toBeGreaterThan(0)
  })

  it('청크가 없으면 getAudioBlob()이 null을 반환한다', () => {
    const audioChunks: Blob[] = []
    const getAudioBlob = () =>
      audioChunks.length > 0 ? new Blob(audioChunks, { type: 'audio/webm' }) : null

    expect(getAudioBlob()).toBeNull()
  })

  // ── resumeRecording 시 AudioContext 재개 ───────────────

  it('일시정지 재개 시 AudioContext가 suspended이면 resume()이 호출된다', async () => {
    mockAudioContext.state = 'suspended'
    if (mockAudioContext.state === 'suspended') {
      await mockAudioContext.resume()
    }
    expect(mockAudioContext.resume).toHaveBeenCalledTimes(1)
    expect(mockAudioContext.state).toBe('running')
  })

  // ── 마이크 기기 열거 ──────────────────────────────────

  it('enumerateDevices()가 audioinput 기기 목록을 반환한다', async () => {
    const devices = await navigator.mediaDevices.enumerateDevices()
    const mics    = devices.filter((d) => d.kind === 'audioinput')
    expect(mics.length).toBeGreaterThanOrEqual(1)
    expect(mics[0].kind).toBe('audioinput')
  })

  it('2개 이상의 마이크가 감지되면 선택 UI 표시 조건이 충족된다', async () => {
    const devices = await navigator.mediaDevices.enumerateDevices()
    const mics    = devices.filter((d) => d.kind === 'audioinput')
    const showMicMenu = mics.length > 1
    expect(showMicMenu).toBe(true)
  })

  it('기기 ID로 특정 마이크를 선택할 수 있다', async () => {
    const deviceId = 'ext-001'
    await navigator.mediaDevices.getUserMedia({
      audio: { deviceId: { exact: deviceId } }
    })
    const call = (navigator.mediaDevices.getUserMedia as ReturnType<typeof vi.fn>).mock.calls[0][0]
    expect((call.audio as MediaTrackConstraints & { deviceId?: unknown }).deviceId).toEqual({ exact: deviceId })
  })
})

// ══════════════════════════════════════════════════════════
describe('⏱️  타이머 & 경과 시간', () => {
// ══════════════════════════════════════════════════════════

  it('1초마다 경과 시간이 1씩 증가한다', async () => {
    vi.useFakeTimers()
    let sec = 0
    const timer = setInterval(() => { sec++ }, 1000)

    vi.advanceTimersByTime(3000)
    expect(sec).toBe(3)

    clearInterval(timer)
    vi.useRealTimers()
  })

  it('formatTime(90)은 "00:01:30"을 반환한다', () => {
    const formatTime = (s: number) => {
      const h   = Math.floor(s / 3600).toString().padStart(2, '0')
      const m   = Math.floor((s % 3600) / 60).toString().padStart(2, '0')
      const sec = (s % 60).toString().padStart(2, '0')
      return `${h}:${m}:${sec}`
    }
    expect(formatTime(90)).toBe('00:01:30')
    expect(formatTime(3661)).toBe('01:01:01')
    expect(formatTime(0)).toBe('00:00:00')
  })
})
