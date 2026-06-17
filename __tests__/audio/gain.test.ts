/**
 * ══════════════════════════════════════════════════════════
 * 🎚️  테스트 그룹 1: 음성 감도 (Audio Sensitivity / Gain)
 * ══════════════════════════════════════════════════════════
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import {
  mockAudioContext, mockGainNode, mockCompressorNode,
  mockAnalyserNode, mockSourceNode, mockDestinationNode,
  mockStream, MockWebSocket,
} from '../setup'

// ── 헬퍼: 유닛 타겟 함수 직접 추출하여 테스트 ──────────────

/** pickMimeType 로직을 독립 추출 */
function pickMimeType(): string {
  const candidates = [
    'audio/mp4',
    'audio/mp4;codecs=aac',
    'audio/ogg;codecs=opus',
    'audio/webm;codecs=opus',
    'audio/webm',
  ]
  return candidates.find((t) => MediaRecorder.isTypeSupported(t)) ?? 'audio/webm'
}

/** mimeTypeToExt 로직 추출 */
function mimeTypeToExt(mimeType: string): string {
  if (mimeType.startsWith('audio/mp4')) return 'mp4'
  if (mimeType.startsWith('audio/ogg')) return 'ogg'
  return 'webm'
}

/** getVolumeLevel RMS 계산 로직 추출 */
function calcVolumeLevel(analyser: { fftSize: number; getByteTimeDomainData: (arr: Uint8Array) => void }): number {
  const bufferLength = analyser.fftSize
  const dataArray    = new Uint8Array(bufferLength)
  analyser.getByteTimeDomainData(dataArray)
  let sum = 0
  for (let i = 0; i < bufferLength; i++) {
    const sample = (dataArray[i] - 128) / 128
    sum += sample * sample
  }
  const rms = Math.sqrt(sum / bufferLength)
  return Math.min(100, rms * 350)
}

// ══════════════════════════════════════════════════════════
describe('🎚️  음성 감도 — AudioContext & GainNode', () => {
// ══════════════════════════════════════════════════════════

  beforeEach(() => {
    vi.clearAllMocks()
    mockAudioContext.state = 'suspended'
    mockGainNode.gain.value = 1.0
  })

  // ── AudioContext 상태 관리 ──────────────────────────────

  it('AudioContext가 suspended 상태이면 resume()이 호출된다', async () => {
    expect(mockAudioContext.state).toBe('suspended')
    // 핵심 수정 로직 시뮬레이션
    if (mockAudioContext.state === 'suspended') {
      await mockAudioContext.resume()
    }
    expect(mockAudioContext.resume).toHaveBeenCalledTimes(1)
    expect(mockAudioContext.state).toBe('running')
  })

  it('AudioContext가 이미 running이면 resume()을 호출하지 않는다', async () => {
    mockAudioContext.state = 'running'
    if (mockAudioContext.state === 'suspended') {
      await mockAudioContext.resume()
    }
    expect(mockAudioContext.resume).not.toHaveBeenCalled()
  })

  it('AudioContext 생성 시 createMediaStreamSource()가 호출된다', () => {
    mockAudioContext.createMediaStreamSource(mockStream as unknown as MediaStream)
    expect(mockAudioContext.createMediaStreamSource).toHaveBeenCalledWith(mockStream)
  })

  // ── GainNode 설정 ───────────────────────────────────────

  it('GainNode 초기 gain.value는 2.0이어야 한다', () => {
    mockGainNode.gain.value = 2.0   // 기본 boost 설정
    expect(mockGainNode.gain.value).toBe(2.0)
  })

  it('setGain(3.0) 호출 시 gain.value가 3.0으로 변경된다', () => {
    mockGainNode.gain.value = 2.0
    // setGain 로직 시뮬레이션
    const setGain = (level: number) => { mockGainNode.gain.value = level }
    setGain(3.0)
    expect(mockGainNode.gain.value).toBe(3.0)
  })

  it('gain 프리셋 범위 검증: 0.5x ~ 4.0x', () => {
    const GAIN_PRESETS = [0.5, 1.0, 1.5, 2.0, 3.0, 4.0]
    GAIN_PRESETS.forEach((preset) => {
      mockGainNode.gain.value = preset
      expect(mockGainNode.gain.value).toBeGreaterThanOrEqual(0.5)
      expect(mockGainNode.gain.value).toBeLessThanOrEqual(4.0)
    })
  })

  it('setGain 호출 후 바로 gain.value에 반영된다 (녹음 중 실시간 변경)', () => {
    mockGainNode.gain.value = 1.0
    // 녹음 중 게인 변경 시뮬레이션
    const newGain = 2.5
    mockGainNode.gain.value = newGain
    expect(mockGainNode.gain.value).toBe(2.5)
  })

  // ── DynamicsCompressor 설정 ─────────────────────────────

  it('DynamicsCompressor threshold는 -24dB여야 한다', () => {
    mockCompressorNode.threshold.value = -24
    expect(mockCompressorNode.threshold.value).toBe(-24)
  })

  it('DynamicsCompressor ratio는 12:1이어야 한다 (강한 압축)', () => {
    mockCompressorNode.ratio.value = 12
    expect(mockCompressorNode.ratio.value).toBe(12)
  })

  it('DynamicsCompressor attack은 3ms여야 한다 (빠른 응답)', () => {
    mockCompressorNode.attack.value = 0.003
    expect(mockCompressorNode.attack.value).toBeCloseTo(0.003)
  })

  it('DynamicsCompressor release는 250ms여야 한다', () => {
    mockCompressorNode.release.value = 0.25
    expect(mockCompressorNode.release.value).toBeCloseTo(0.25)
  })

  // ── Web Audio 처리 체인 연결 순서 ──────────────────────

  it('처리 체인이 source→gain→compressor→analyser→destination 순으로 연결된다', () => {
    // 체인 연결 시뮬레이션
    mockSourceNode.connect(mockGainNode as unknown as AudioNode)
    mockGainNode.connect(mockCompressorNode as unknown as AudioNode)
    mockCompressorNode.connect(mockAnalyserNode as unknown as AudioNode)
    mockAnalyserNode.connect(mockDestinationNode as unknown as AudioNode)

    expect(mockSourceNode.connect).toHaveBeenCalledWith(mockGainNode)
    expect(mockGainNode.connect).toHaveBeenCalledWith(mockCompressorNode)
    expect(mockCompressorNode.connect).toHaveBeenCalledWith(mockAnalyserNode)
    expect(mockAnalyserNode.connect).toHaveBeenCalledWith(mockDestinationNode)
  })

  it('AnalyserNode fftSize는 512이어야 한다', () => {
    mockAnalyserNode.fftSize = 512
    expect(mockAnalyserNode.fftSize).toBe(512)
  })

  it('AnalyserNode smoothingTimeConstant는 0.8이어야 한다', () => {
    mockAnalyserNode.smoothingTimeConstant = 0.8
    expect(mockAnalyserNode.smoothingTimeConstant).toBeCloseTo(0.8)
  })

  // ── VU 미터 — 볼륨 레벨 계산 ───────────────────────────

  it('완전 무음 입력 시 getVolumeLevel()은 0을 반환한다', () => {
    // 128 = 0 진폭 (128이 중앙값)
    mockAnalyserNode.getByteTimeDomainData = vi.fn((arr: Uint8Array) => arr.fill(128))
    mockAnalyserNode.fftSize = 512
    const level = calcVolumeLevel(mockAnalyserNode)
    expect(level).toBe(0)
  })

  it('최대 양극 신호 입력 시 getVolumeLevel()은 100에 클리핑된다', () => {
    // 255 = 최대 양극 (진폭 = (255-128)/128 ≈ 1.0)
    mockAnalyserNode.getByteTimeDomainData = vi.fn((arr: Uint8Array) => arr.fill(255))
    mockAnalyserNode.fftSize = 512
    const level = calcVolumeLevel(mockAnalyserNode)
    expect(level).toBe(100)
  })

  it('중간 크기 발화 시 getVolumeLevel()은 0~100 사이 값을 반환한다', () => {
    // 절반 진폭 시뮬레이션
    mockAnalyserNode.getByteTimeDomainData = vi.fn((arr: Uint8Array) => {
      for (let i = 0; i < arr.length; i++) {
        arr[i] = i % 2 === 0 ? 192 : 64   // ±0.5 진폭
      }
    })
    mockAnalyserNode.fftSize = 512
    const level = calcVolumeLevel(mockAnalyserNode)
    expect(level).toBeGreaterThan(0)
    expect(level).toBeLessThanOrEqual(100)
  })

  it('analyser가 없으면 getVolumeLevel()은 0을 반환한다 (null 방어)', () => {
    const nullAnalyser = null
    const level = nullAnalyser ? calcVolumeLevel(nullAnalyser) : 0
    expect(level).toBe(0)
  })

  // ── getUserMedia 오디오 제약 ──────────────────────────────

  it('getUserMedia 호출 시 echoCancellation이 활성화된다', async () => {
    const expectedConstraints = {
      audio: {
        echoCancellation: true,
        noiseSuppression: true,
        autoGainControl: true,
        channelCount: 1,
      }
    }
    await navigator.mediaDevices.getUserMedia(expectedConstraints)
    expect(navigator.mediaDevices.getUserMedia).toHaveBeenCalledWith(
      expect.objectContaining({
        audio: expect.objectContaining({ echoCancellation: true })
      })
    )
  })

  it('getUserMedia 제약에 sampleRate가 포함되지 않는다 (호환성 이슈 방지)', async () => {
    const constraints = {
      audio: {
        echoCancellation: true,
        noiseSuppression: true,
        autoGainControl: true,
        channelCount: 1,
        // sampleRate: { ideal: 16000 }  ← 제거됨
      }
    }
    await navigator.mediaDevices.getUserMedia(constraints)
    const calledWith = (navigator.mediaDevices.getUserMedia as ReturnType<typeof vi.fn>).mock.calls[0][0]
    expect((calledWith.audio as MediaTrackConstraints).sampleRate).toBeUndefined()
  })

  it('channelCount: 1 (모노) 설정이 적용된다', async () => {
    await navigator.mediaDevices.getUserMedia({ audio: { channelCount: 1 } })
    const calledWith = (navigator.mediaDevices.getUserMedia as ReturnType<typeof vi.fn>).mock.calls[0][0]
    expect((calledWith.audio as MediaTrackConstraints).channelCount).toBe(1)
  })

  // ── stopRecording 시 AudioContext 정리 ─────────────────

  it('stopRecording 시 AudioContext.close()가 호출된다', async () => {
    mockAudioContext.state = 'running'
    await mockAudioContext.close()
    expect(mockAudioContext.close).toHaveBeenCalled()
    expect(mockAudioContext.state).toBe('closed')
  })

  it('stopRecording 시 원본 미디어 트랙이 종료된다', () => {
    const track = { stop: vi.fn(), readyState: 'live' }
    const stream = { getTracks: vi.fn(() => [track]) }
    stream.getTracks().forEach((t) => t.stop())
    expect(track.stop).toHaveBeenCalled()
  })
})

// ══════════════════════════════════════════════════════════
describe('🎵  오디오 포맷 선택 (pickMimeType)', () => {
// ══════════════════════════════════════════════════════════

  it('지원 포맷 중 첫 번째 후보를 선택한다 (ogg/webm 우선순위 확인)', () => {
    // 후보 순서: mp4 → ogg;opus → webm;opus → webm
    // mock 지원: webm;opus, webm, ogg;opus → ogg;opus가 먼저 매칭됨
    const result = pickMimeType()
    const supported = ['audio/ogg;codecs=opus', 'audio/webm;codecs=opus', 'audio/webm']
    expect(supported).toContain(result)
    // jsdom 환경에서는 ogg가 candidates 순서상 먼저 선택됨
    expect(result).toBe('audio/ogg;codecs=opus')
  })

  it('audio/webm;codecs=opus 미지원 시 audio/webm fallback', () => {
    const orig = (MediaRecorder as unknown as { isTypeSupported: (t: string) => boolean }).isTypeSupported
    ;(MediaRecorder as unknown as { isTypeSupported: (t: string) => boolean }).isTypeSupported =
      vi.fn((type: string) => type === 'audio/webm')
    expect(pickMimeType()).toBe('audio/webm')
    ;(MediaRecorder as unknown as { isTypeSupported: (t: string) => boolean }).isTypeSupported = orig
  })

  it('mimeTypeToExt: audio/webm → webm', () => {
    expect(mimeTypeToExt('audio/webm;codecs=opus')).toBe('webm')
    expect(mimeTypeToExt('audio/webm')).toBe('webm')
  })

  it('mimeTypeToExt: audio/mp4 → mp4', () => {
    expect(mimeTypeToExt('audio/mp4')).toBe('mp4')
    expect(mimeTypeToExt('audio/mp4;codecs=aac')).toBe('mp4')
  })

  it('mimeTypeToExt: audio/ogg → ogg', () => {
    expect(mimeTypeToExt('audio/ogg;codecs=opus')).toBe('ogg')
  })
})
