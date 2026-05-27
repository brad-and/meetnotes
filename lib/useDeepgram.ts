'use client'
import { useRef, useCallback } from 'react'
import { useMeetingStore } from '@/store/meetingStore'

/** 브라우저가 지원하는 가장 호환성 높은 오디오 포맷 선택 */
function pickMimeType(): string {
  const candidates = [
    'audio/mp4',              // Safari / iOS / macOS QuickTime ✅
    'audio/mp4;codecs=aac',
    'audio/ogg;codecs=opus',  // Firefox ✅
    'audio/webm;codecs=opus', // Chrome / Edge ✅
    'audio/webm',             // 최후 fallback
  ]
  return candidates.find((t) => MediaRecorder.isTypeSupported(t)) ?? 'audio/webm'
}

/** mimeType → 파일 확장자 */
export function mimeTypeToExt(mimeType: string): string {
  if (mimeType.startsWith('audio/mp4')) return 'mp4'
  if (mimeType.startsWith('audio/ogg')) return 'ogg'
  return 'webm'
}

export function useDeepgram() {
  const wsRef               = useRef<WebSocket | null>(null)
  const mediaRecorderRef    = useRef<MediaRecorder | null>(null)
  const streamRef           = useRef<MediaStream | null>(null)
  const timerRef            = useRef<NodeJS.Timeout | null>(null)
  const audioChunksRef      = useRef<Blob[]>([])
  const mimeTypeRef         = useRef<string>('audio/webm')

  // Web Audio API 처리 체인
  const audioCtxRef         = useRef<AudioContext | null>(null)
  const gainNodeRef         = useRef<GainNode | null>(null)
  const analyserRef         = useRef<AnalyserNode | null>(null)
  const gainLevelRef        = useRef<number>(2.0)   // 기본 2x 부스트
  const deviceIdRef         = useRef<string>('')    // '' = 기본 마이크

  // 발화 추적
  const pendingIdRef        = useRef<string | null>(null)
  const utteranceEndedRef   = useRef<boolean>(false)
  const recordingGenRef     = useRef(0)

  const { setRecording, setPaused, setElapsedSeconds } = useMeetingStore()

  const formatTime = (s: number) => {
    const h = Math.floor(s / 3600).toString().padStart(2, '0')
    const m = Math.floor((s % 3600) / 60).toString().padStart(2, '0')
    const sec = (s % 60).toString().padStart(2, '0')
    return `${h}:${m}:${sec}`
  }

  /** 현재 마이크 볼륨 레벨 반환 (0-100) */
  const getVolumeLevel = useCallback((): number => {
    if (!analyserRef.current) return 0
    const bufferLength = analyserRef.current.fftSize
    const dataArray    = new Uint8Array(bufferLength)
    analyserRef.current.getByteTimeDomainData(dataArray)
    // RMS (Root Mean Square) 계산
    let sum = 0
    for (let i = 0; i < bufferLength; i++) {
      const sample = (dataArray[i] - 128) / 128  // -1 ~ 1 정규화
      sum += sample * sample
    }
    const rms = Math.sqrt(sum / bufferLength)
    return Math.min(100, rms * 350)  // 0-100 스케일
  }, [])

  /** 실시간으로 게인(감도) 조절 — 녹음 중에도 즉시 반영 */
  const setGain = useCallback((level: number) => {
    gainLevelRef.current = level
    if (gainNodeRef.current) gainNodeRef.current.gain.value = level
  }, [])

  const startRecording = useCallback(async (deviceId?: string) => {
    const gen = ++recordingGenRef.current
    // deviceId가 전달되면 ref 업데이트
    if (deviceId !== undefined) deviceIdRef.current = deviceId

    try {
      // ── 1. 향상된 오디오 제약 ───────────────────────────────────────────
      const audioConstraints: MediaTrackConstraints = {
        echoCancellation: true,    // 에코 제거 (스피커 → 마이크 피드백 방지)
        noiseSuppression: true,    // 배경 소음 억제 (키보드, 에어컨 등)
        autoGainControl: true,     // 브라우저 내장 자동 게인 (조용한 환경 보정)
        channelCount: 1,           // 모노 (파일 크기 절반, Deepgram 권장)
        sampleRate: { ideal: 16000 },  // Deepgram 최적 샘플레이트
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

      // ── 2. Web Audio API 처리 체인 ────────────────────────────────────
      // source → gainNode → compressor → analyser → destination
      const audioCtx = new AudioContext()
      audioCtxRef.current = audioCtx

      const source = audioCtx.createMediaStreamSource(stream)

      // GainNode: 조용한 목소리 증폭 (gainLevelRef 값으로 실시간 조절 가능)
      const gainNode = audioCtx.createGain()
      gainNode.gain.value = gainLevelRef.current
      gainNodeRef.current = gainNode

      // DynamicsCompressor: 큰 소리 클리핑 방지 + 전체 다이나믹 레인지 압축
      //   → 작은 목소리와 큰 목소리가 비슷한 레벨로 맞춰짐
      const compressor = audioCtx.createDynamicsCompressor()
      compressor.threshold.value = -24  // -24dB 이상 압축 시작
      compressor.knee.value       = 30  // 소프트 니 (자연스러운 전환)
      compressor.ratio.value      = 12  // 12:1 강압축
      compressor.attack.value     = 0.003
      compressor.release.value    = 0.25

      // AnalyserNode: 볼륨 레벨 모니터링 (VU 미터용)
      const analyser = audioCtx.createAnalyser()
      analyser.fftSize              = 512
      analyser.smoothingTimeConstant = 0.8  // 부드러운 시각화
      analyserRef.current           = analyser

      // 처리 체인 연결
      const destination = audioCtx.createMediaStreamDestination()
      source.connect(gainNode)
      gainNode.connect(compressor)
      compressor.connect(analyser)
      analyser.connect(destination)

      // 처리된 스트림을 WebSocket 전송과 녹음에 사용
      const processedStream = destination.stream

      // ── 3. Deepgram 토큰 발급 ────────────────────────────────────────
      const tokenRes = await fetch('/api/transcribe/token')
      if (gen !== recordingGenRef.current) return
      const { token } = await tokenRes.json()

      // ── 4. Deepgram WebSocket — 향상된 파라미터 ───────────────────────
      const ws = new WebSocket(
        `wss://api.deepgram.com/v1/listen?` +
        `language=ko` +
        `&model=nova-2` +
        `&diarize=true` +
        `&punctuate=true` +
        `&smart_format=true` +          // 숫자, 날짜, 통화 자동 포맷
        `&interim_results=true` +
        `&utterance_end_ms=1500` +      // 1000 → 1500: 자연스러운 발화 경계
        `&endpointing=380` +            // 발화 종료 민감도 최적화
        `&vad_events=true`,
        ['token', token]
      )
      if (gen !== recordingGenRef.current) { ws.close(); return }
      wsRef.current = ws

      ws.onopen = () => {
        if (gen !== recordingGenRef.current) { ws.close(); return }
        audioChunksRef.current  = []
        pendingIdRef.current    = null
        utteranceEndedRef.current = false
        const mimeType = pickMimeType()
        mimeTypeRef.current = mimeType
        // 처리된 스트림(gain+compressor)으로 MediaRecorder 생성
        const mediaRecorder = new MediaRecorder(processedStream, { mimeType })
        mediaRecorderRef.current = mediaRecorder
        mediaRecorder.ondataavailable = (e) => {
          if (e.data.size > 0) audioChunksRef.current.push(e.data)
          if (ws.readyState === WebSocket.OPEN) ws.send(e.data)
        }
        mediaRecorder.start(250)
      }

      ws.onmessage = (event) => {
        if (!event.data) return
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        let data: any
        try { data = JSON.parse(event.data) } catch { return }

        const store = useMeetingStore.getState()

        // ── UtteranceEnd ────────────────────────────────────────────────
        if (data.type === 'UtteranceEnd') {
          if (pendingIdRef.current !== null) {
            store.finalizeLastUtterance(
              store.utterances.find(u => !u.isFinal)?.text ?? ''
            )
            pendingIdRef.current    = null
            utteranceEndedRef.current = true
          }
          return
        }

        if (!data.channel?.alternatives?.[0]) return
        const alt        = data.channel.alternatives[0]
        const transcript = alt.transcript?.trim()
        if (!transcript) return

        const speaker     = `Speaker ${alt.words?.[0]?.speaker ?? 0}`
        const speakerName = store.speakerMap[speaker] || speaker
        const ts          = formatTime(store.elapsedSeconds)
        const isSpeechFinal: boolean = data.speech_final === true

        if (isSpeechFinal) {
          if (pendingIdRef.current !== null) {
            store.finalizeLastUtterance(transcript)
            pendingIdRef.current    = null
            utteranceEndedRef.current = false
          } else if (utteranceEndedRef.current) {
            utteranceEndedRef.current = false
          } else {
            store.addUtterance({
              id: `sf-${Date.now()}`,
              speaker, speakerName, text: transcript, timestamp: ts, isFinal: true,
            })
          }
        } else if (data.is_final) {
          utteranceEndedRef.current = false
          if (pendingIdRef.current !== null) {
            store.updateLastUtterance(transcript)
          } else {
            const id = `${Date.now()}`
            pendingIdRef.current = id
            store.addUtterance({
              id, speaker, speakerName, text: transcript, timestamp: ts, isFinal: false,
            })
          }
        } else {
          utteranceEndedRef.current = false
          if (pendingIdRef.current !== null) {
            store.updateLastUtterance(transcript)
          } else {
            const id = `interim-${Date.now()}`
            pendingIdRef.current = id
            store.addUtterance({
              id, speaker, speakerName, text: transcript, timestamp: ts, isFinal: false,
            })
          }
        }
      }

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
  }, [setRecording, setElapsedSeconds])

  const pauseRecording = useCallback(() => {
    if (mediaRecorderRef.current?.state === 'recording') {
      mediaRecorderRef.current.pause()
      if (timerRef.current) clearInterval(timerRef.current)
      setPaused(true)
    }
  }, [setPaused])

  const resumeRecording = useCallback(() => {
    if (mediaRecorderRef.current?.state === 'paused') {
      mediaRecorderRef.current.resume()
      const currentSec = useMeetingStore.getState().elapsedSeconds
      let sec = currentSec
      timerRef.current = setInterval(() => {
        sec++
        setElapsedSeconds(sec)
      }, 1000)
      setPaused(false)
    }
  }, [setPaused, setElapsedSeconds])

  const stopRecording = useCallback(() => {
    recordingGenRef.current++
    mediaRecorderRef.current?.stop()
    wsRef.current?.close()
    streamRef.current?.getTracks().forEach((t) => t.stop())
    // Web Audio 정리
    audioCtxRef.current?.close().catch(() => {})
    audioCtxRef.current  = null
    gainNodeRef.current  = null
    analyserRef.current  = null
    if (timerRef.current) clearInterval(timerRef.current)
    pendingIdRef.current      = null
    utteranceEndedRef.current = false
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
