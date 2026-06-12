'use client'
import { useRef, useCallback } from 'react'
import { useMeetingStore } from '@/store/meetingStore'

/** 브라우저가 지원하는 가장 호환성 높은 오디오 포맷 선택 */
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

/** mimeType → 파일 확장자 */
export function mimeTypeToExt(mimeType: string): string {
  if (mimeType.startsWith('audio/mp4')) return 'mp4'
  if (mimeType.startsWith('audio/ogg')) return 'ogg'
  return 'webm'
}

const SPEECH_THRESHOLD   = 15   // 발화 판단 임계값 (0-100)
const SPEECH_CONFIRM     = 3    // 연속 3번(600ms) 이상 감지돼야 발화 확정
const MIN_SPEECH_FRAMES  = 2    // 키워드 전송 시 최소 발화 프레임(×200ms = 400ms)
const KEYWORD_INTERVAL_MS = 20000 // 20초마다 키워드 추출

export function useDeepgram() {
  const mediaRecorderRef    = useRef<MediaRecorder | null>(null)
  const streamRef           = useRef<MediaStream | null>(null)
  const timerRef            = useRef<NodeJS.Timeout | null>(null)
  const audioChunksRef      = useRef<Blob[]>([])
  const batchChunksRef      = useRef<Blob[]>([])
  const initChunkRef        = useRef<Blob | null>(null)
  const mimeTypeRef         = useRef<string>('audio/webm')

  // 발화 감지 상태
  const volSamplerRef       = useRef<NodeJS.Timeout | null>(null)
  const isSpeakingRef       = useRef<boolean>(false)
  const speechCountRef      = useRef<number>(0)   // 연속 발화 카운터
  const speechFramesRef     = useRef<number>(0)   // 배치 내 누적 발화 프레임 수

  // 키워드 추출 인터벌
  const keywordIntervalRef  = useRef<NodeJS.Timeout | null>(null)

  // Web Audio API 처리 체인
  const audioCtxRef         = useRef<AudioContext | null>(null)
  const gainNodeRef         = useRef<GainNode | null>(null)
  const analyserRef         = useRef<AnalyserNode | null>(null)
  const gainLevelRef        = useRef<number>(2.0)
  const deviceIdRef         = useRef<string>('')

  const recordingGenRef     = useRef(0)

  const { setRecording, setPaused, setElapsedSeconds } = useMeetingStore()

  /** 현재 마이크 볼륨 레벨 반환 (0-100) */
  const getVolumeLevel = useCallback((): number => {
    if (!analyserRef.current) return 0
    const bufferLength = analyserRef.current.fftSize
    const dataArray    = new Uint8Array(bufferLength)
    analyserRef.current.getByteTimeDomainData(dataArray)
    let sum = 0
    for (let i = 0; i < bufferLength; i++) {
      const sample = (dataArray[i] - 128) / 128
      sum += sample * sample
    }
    return Math.min(100, Math.sqrt(sum / bufferLength) * 350)
  }, [])

  /** 실시간으로 게인(감도) 조절 */
  const setGain = useCallback((level: number) => {
    gainLevelRef.current = level
    if (gainNodeRef.current) gainNodeRef.current.gain.value = level
  }, [])

  /** 누적된 배치 청크를 /api/keywords로 전송하여 키워드 추출 */
  const sendKeywords = useCallback(async () => {
    const batch = [...batchChunksRef.current]
    batchChunksRef.current = []

    const frames = speechFramesRef.current
    speechFramesRef.current = 0

    console.log('[Keywords] called — frames:', frames, 'chunks:', batch.length, 'minFrames:', MIN_SPEECH_FRAMES)

    if (frames < MIN_SPEECH_FRAMES) {
      console.log('[Keywords] skip — 발화 프레임 부족:', frames, '<', MIN_SPEECH_FRAMES)
      return
    }
    if (batch.length === 0) {
      console.log('[Keywords] skip — 오디오 청크 없음')
      return
    }

    const initChunk = initChunkRef.current
    const fullBatch = (initChunk && batch[0] !== initChunk)
      ? [initChunk, ...batch]
      : batch

    const blob = new Blob(fullBatch, { type: mimeTypeRef.current })
    console.log('[Keywords] blob size:', blob.size, 'type:', mimeTypeRef.current)
    if (blob.size < 2000) {
      console.log('[Keywords] skip — blob 너무 작음:', blob.size)
      return
    }

    const ext = mimeTypeToExt(mimeTypeRef.current)
    const form = new FormData()
    form.append('audio', new File([blob], `chunk.${ext}`, { type: mimeTypeRef.current }))

    try {
      console.log('[Keywords] POST /api/keywords ...')
      const res = await fetch('/api/keywords', { method: 'POST', body: form })
      const json = await res.json()
      console.log('[Keywords] 응답:', res.status, json)
      if (res.ok && Array.isArray(json.keywords) && json.keywords.length > 0) {
        useMeetingStore.getState().addKeywords(json.keywords)
        console.log('[Keywords] 추가됨:', json.keywords)
      }
    } catch (err) {
      console.error('[Keywords chunk]', err)
    }
  }, [])

  /** 발화 감지 샘플러 시작 — VU 시각화 및 speechFrames 추적만 담당 */
  const startVolSampler = useCallback(() => {
    isSpeakingRef.current   = false
    speechCountRef.current  = 0
    speechFramesRef.current = 0

    volSamplerRef.current = setInterval(() => {
      const level = getVolumeLevel()

      if (level > SPEECH_THRESHOLD) {
        speechCountRef.current++

        // 임계값 이상인 모든 샘플에서 프레임 누적 (연속 여부 무관)
        speechFramesRef.current++

        // 연속 SPEECH_CONFIRM번 이상이면 발화 시작 확정
        if (speechCountRef.current >= SPEECH_CONFIRM) {
          if (!isSpeakingRef.current) {
            isSpeakingRef.current = true
          }
        }
      } else {
        speechCountRef.current = 0
        if (isSpeakingRef.current) {
          isSpeakingRef.current = false
        }
      }
    }, 200)
  }, [getVolumeLevel])

  const startRecording = useCallback(async (deviceId?: string) => {
    const gen = ++recordingGenRef.current
    if (deviceId !== undefined) deviceIdRef.current = deviceId

    try {
      // ── 1. 향상된 오디오 제약 ─────────────────────────────────────────────
      const audioConstraints: MediaTrackConstraints = {
        echoCancellation: true,
        noiseSuppression: true,
        autoGainControl: true,
        channelCount: 1,
      }
      if (deviceIdRef.current) {
        audioConstraints.deviceId = { exact: deviceIdRef.current }
      }

      const stream = await navigator.mediaDevices.getUserMedia({ audio: audioConstraints })

      if (gen !== recordingGenRef.current) {
        stream.getTracks().forEach((t) => t.stop())
        return
      }
      streamRef.current = stream

      // ── 2. Web Audio API 처리 체인 ────────────────────────────────────────
      const audioCtx = new AudioContext()
      audioCtxRef.current = audioCtx

      // AudioContext가 suspended 상태로 시작될 수 있음 (Chrome 정책)
      if (audioCtx.state === 'suspended') {
        await audioCtx.resume()
      }

      const source = audioCtx.createMediaStreamSource(stream)

      const gainNode = audioCtx.createGain()
      gainNode.gain.value = gainLevelRef.current
      gainNodeRef.current = gainNode

      const compressor = audioCtx.createDynamicsCompressor()
      compressor.threshold.value = -24
      compressor.knee.value       = 30
      compressor.ratio.value      = 12
      compressor.attack.value     = 0.003
      compressor.release.value    = 0.25

      const analyser = audioCtx.createAnalyser()
      analyser.fftSize               = 512
      analyser.smoothingTimeConstant = 0.8
      analyserRef.current            = analyser

      const destination = audioCtx.createMediaStreamDestination()
      source.connect(gainNode)
      gainNode.connect(compressor)
      compressor.connect(analyser)
      analyser.connect(destination)

      const processedStream = destination.stream
      const processedTrack  = processedStream.getAudioTracks()[0]
      const recordingStream = (processedTrack && processedTrack.readyState === 'live')
        ? processedStream
        : stream
      if (recordingStream === stream) {
        console.warn('[useDeepgram] processedStream 트랙 없음 — 원본 stream fallback 사용')
      }

      if (gen !== recordingGenRef.current) return

      // ── 3. MediaRecorder 설정 ─────────────────────────────────────────────
      audioChunksRef.current   = []
      batchChunksRef.current   = []
      initChunkRef.current     = null

      const mimeType = pickMimeType()
      mimeTypeRef.current = mimeType

      const mediaRecorder = new MediaRecorder(recordingStream, { mimeType })
      mediaRecorderRef.current = mediaRecorder

      mediaRecorder.onerror = (e) => console.error('[MediaRecorder] error:', e)
      mediaRecorder.ondataavailable = (e) => {
        if (e.data.size > 0) {
          audioChunksRef.current.push(e.data)
          batchChunksRef.current.push(e.data)
          if (!initChunkRef.current) initChunkRef.current = e.data
        }
      }

      mediaRecorder.start(250)

      // ── 4. 발화 감지 (VU 시각화용) ───────────────────────────────────────
      startVolSampler()

      // ── 5. 45초 키워드 추출 인터벌 ────────────────────────────────────────
      keywordIntervalRef.current = setInterval(() => {
        sendKeywords()
      }, KEYWORD_INTERVAL_MS)

      // 타이머
      let sec = 0
      timerRef.current = setInterval(() => {
        sec++
        setElapsedSeconds(sec)
      }, 1000)

      setRecording(true)
    } catch (err) {
      console.error('Recording error:', err)
      alert('마이크 권한이 필요해요. 브라우저 설정에서 허용해주세요.')
    }
  }, [setRecording, setElapsedSeconds, sendKeywords, startVolSampler])

  const pauseRecording = useCallback(() => {
    if (mediaRecorderRef.current?.state === 'recording') {
      if (volSamplerRef.current) clearInterval(volSamplerRef.current)
      if (keywordIntervalRef.current) clearInterval(keywordIntervalRef.current)
      mediaRecorderRef.current.pause()
      if (timerRef.current) clearInterval(timerRef.current)
      setPaused(true)
    }
  }, [setPaused])

  const resumeRecording = useCallback(async () => {
    if (mediaRecorderRef.current?.state === 'paused') {
      if (audioCtxRef.current?.state === 'suspended') {
        await audioCtxRef.current.resume()
      }
      batchChunksRef.current   = []
      mediaRecorderRef.current.resume()

      const currentSec = useMeetingStore.getState().elapsedSeconds
      let sec = currentSec
      timerRef.current = setInterval(() => {
        sec++
        setElapsedSeconds(sec)
      }, 1000)

      startVolSampler()

      // 재개 시 키워드 인터벌 재시작
      keywordIntervalRef.current = setInterval(() => {
        sendKeywords()
      }, KEYWORD_INTERVAL_MS)

      setPaused(false)
    }
  }, [setPaused, setElapsedSeconds, startVolSampler, sendKeywords])

  const stopRecording = useCallback(() => {
    recordingGenRef.current++
    if (volSamplerRef.current) clearInterval(volSamplerRef.current)
    if (keywordIntervalRef.current) clearInterval(keywordIntervalRef.current)
    mediaRecorderRef.current?.stop()
    streamRef.current?.getTracks().forEach((t) => t.stop())
    audioCtxRef.current?.close().catch(() => {})
    audioCtxRef.current  = null
    gainNodeRef.current  = null
    analyserRef.current  = null
    if (timerRef.current) clearInterval(timerRef.current)
    setRecording(false)
    setPaused(false)
  }, [setRecording, setPaused])

  const getAudioBlob = useCallback((): Blob | null => {
    if (audioChunksRef.current.length === 0) return null
    return new Blob(audioChunksRef.current, { type: mimeTypeRef.current })
  }, [])

  const getAudioMimeType = useCallback(() => mimeTypeRef.current, [])

  return {
    startRecording,
    pauseRecording,
    resumeRecording,
    stopRecording,
    getAudioBlob,
    getAudioMimeType,
    /** 게인 레벨 실시간 변경 (0.5 ~ 4.0) */
    setGain,
    /** 현재 마이크 볼륨 레벨 (0-100), requestAnimationFrame에서 호출 */
    getVolumeLevel,
    /** 현재 게인 초기값 (UI 슬라이더 초기화용) */
    gainLevelRef,
  }
}
