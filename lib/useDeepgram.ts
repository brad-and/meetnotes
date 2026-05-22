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
  const wsRef = useRef<WebSocket | null>(null)
  const mediaRecorderRef = useRef<MediaRecorder | null>(null)
  const streamRef = useRef<MediaStream | null>(null)
  const timerRef = useRef<NodeJS.Timeout | null>(null)
  const audioChunksRef = useRef<Blob[]>([])
  const mimeTypeRef = useRef<string>('audio/webm')   // 실제 사용된 포맷 추적

  // 현재 작성 중인 발화 ID를 추적 (null = 현재 펜딩 행 없음)
  const pendingIdRef = useRef<string | null>(null)
  // UtteranceEnd가 먼저 처리했는지 추적 → speech_final 중복 방지
  const utteranceEndedRef = useRef<boolean>(false)
  // StrictMode 이중 마운트 방어: 가장 최신 startRecording 호출만 유효
  const recordingGenRef = useRef(0)

  const { setRecording, setPaused, setElapsedSeconds } = useMeetingStore()

  const formatTime = (s: number) => {
    const h = Math.floor(s / 3600).toString().padStart(2, '0')
    const m = Math.floor((s % 3600) / 60).toString().padStart(2, '0')
    const sec = (s % 60).toString().padStart(2, '0')
    return `${h}:${m}:${sec}`
  }

  const startRecording = useCallback(async () => {
    const gen = ++recordingGenRef.current   // 이 호출의 세대 번호
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true })

      // 더 최신 호출이 생겼으면 이 호출은 폐기
      if (gen !== recordingGenRef.current) {
        stream.getTracks().forEach((t) => t.stop())
        return
      }
      streamRef.current = stream

      const tokenRes = await fetch('/api/transcribe/token')
      if (gen !== recordingGenRef.current) return   // 폐기 체크
      const { token } = await tokenRes.json()

      const ws = new WebSocket(
        `wss://api.deepgram.com/v1/listen?` +
        `language=ko&model=nova-2&diarize=true&` +
        `punctuate=true&interim_results=true&` +
        `utterance_end_ms=1000&vad_events=true`,
        ['token', token]
      )
      if (gen !== recordingGenRef.current) { ws.close(); return }  // 폐기 체크
      wsRef.current = ws

      ws.onopen = () => {
        if (gen !== recordingGenRef.current) { ws.close(); return }  // 폐기 체크
        audioChunksRef.current = []
        pendingIdRef.current = null
        utteranceEndedRef.current = false
        const mimeType = pickMimeType()
        mimeTypeRef.current = mimeType
        const mediaRecorder = new MediaRecorder(stream, { mimeType })
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

        // ── UtteranceEnd: 펜딩 행이 있으면 확정, ref 초기화 ──────────
        if (data.type === 'UtteranceEnd') {
          if (pendingIdRef.current !== null) {
            store.finalizeLastUtterance(
              store.utterances.find(u => !u.isFinal)?.text ?? ''
            )
            pendingIdRef.current = null
            utteranceEndedRef.current = true  // speech_final이 나중에 와도 중복 방지
          }
          return
        }

        if (!data.channel?.alternatives?.[0]) return
        const alt = data.channel.alternatives[0]
        const transcript = alt.transcript?.trim()
        if (!transcript) return

        // speaker/name은 최종 결과에서 가장 정확 — 항상 최신 store에서 읽음
        const speaker = `Speaker ${alt.words?.[0]?.speaker ?? 0}`
        const speakerName = store.speakerMap[speaker] || speaker
        const ts = formatTime(store.elapsedSeconds)
        const isSpeechFinal: boolean = data.speech_final === true

        if (isSpeechFinal) {
          // ── 발화 완료 ────────────────────────────────────────────────
          if (pendingIdRef.current !== null) {
            // 정상 케이스: speech_final이 UtteranceEnd보다 먼저 도착
            store.finalizeLastUtterance(transcript)
            pendingIdRef.current = null
            utteranceEndedRef.current = false
          } else if (utteranceEndedRef.current) {
            // UtteranceEnd가 이미 처리함 → 중복 생성 방지, 플래그만 초기화
            utteranceEndedRef.current = false
          } else {
            // 드문 케이스: 펜딩 없이 speech_final 도착 (is_final 없이 바로 확정)
            store.addUtterance({
              id: `sf-${Date.now()}`,
              speaker, speakerName, text: transcript, timestamp: ts, isFinal: true,
            })
          }
        } else if (data.is_final) {
          // ── 청크 확정 (발화 계속) ────────────────────────────────────
          utteranceEndedRef.current = false  // 새 청크 시작 → 플래그 초기화
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
          // ── 인터림 (임시) ──────────────────────────────────────────────
          utteranceEndedRef.current = false  // 새 발화 시작 → 플래그 초기화
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
    recordingGenRef.current++          // 진행 중인 startRecording 비동기 흐름 폐기
    mediaRecorderRef.current?.stop()
    wsRef.current?.close()
    streamRef.current?.getTracks().forEach((t) => t.stop())
    if (timerRef.current) clearInterval(timerRef.current)
    pendingIdRef.current = null
    utteranceEndedRef.current = false
    setRecording(false)
    setPaused(false)
  }, [setRecording, setPaused])

  const getAudioBlob = useCallback((): Blob | null => {
    if (audioChunksRef.current.length === 0) return null
    return new Blob(audioChunksRef.current, { type: mimeTypeRef.current })
  }, [])

  const getAudioMimeType = useCallback(() => mimeTypeRef.current, [])

  return { startRecording, pauseRecording, resumeRecording, stopRecording, getAudioBlob, getAudioMimeType }
}
