import { useEffect } from 'react'
import { useMeetingStore, type Participant } from '@/store/meetingStore'

const PALETTE = [
  { color: '#539df5', bgColor: '#1a2a3a' },
  { color: '#f3727f', bgColor: '#3a1a1a' },
  { color: '#f5a623', bgColor: '#3a2a1a' },
  { color: '#b08df5', bgColor: '#2a1a3a' },
  { color: '#b3b3b3', bgColor: '#2a2a2a' },
]

type RawAttendee = { email: string; status?: string } | string

function buildExtraParticipants(attendees: RawAttendee[]): Participant[] {
  return attendees.map((a, i) => {
    const name = typeof a === 'string' ? a : a.email.split('@')[0]
    const { color, bgColor } = PALETTE[i % PALETTE.length]
    return { id: String(i + 2), name, color, bgColor }
  })
}

function postToExtension(data: object) {
  window.postMessage({ source: 'meetnotes-app', ...data }, '*')
}

export function useExtensionBridge() {
  const { resetMeeting, setTitle, setStep, addParticipant, step, isRecording, title } =
    useMeetingStore()

  useEffect(() => {
    function handleMessage(event: MessageEvent) {
      if (event.data?.source !== 'meetnotes-ext') return
      const { type, title: evtTitle, attendees: evtAttendees } = event.data

      // ── 1단계: 일정 선택 → SetupScreen에 제목 + 참여자 자동 입력 ──────
      if (type === 'SELECT_EVENT') {
        resetMeeting()
        if (evtTitle) setTitle(evtTitle)
        if (Array.isArray(evtAttendees) && evtAttendees.length > 0) {
          buildExtraParticipants(evtAttendees).forEach((p) => addParticipant(p))
        }
      }

      // ── 2단계: 녹음 시작 버튼 → RecordingScreen으로 이동 ───────────────
      if (type === 'START_RECORDING') {
        if (evtTitle) {
          resetMeeting()
          setTitle(evtTitle)
          if (Array.isArray(evtAttendees) && evtAttendees.length > 0) {
            buildExtraParticipants(evtAttendees).forEach((p) => addParticipant(p))
          }
        }
        setStep('recording')
      }

      // ── 종료 트리거 ─────────────────────────────────────────────────────
      if (type === 'STOP_RECORDING') {
        window.dispatchEvent(new CustomEvent('ext:stop-recording'))
      }
    }

    window.addEventListener('message', handleMessage)
    return () => window.removeEventListener('message', handleMessage)
  }, [resetMeeting, setTitle, setStep, addParticipant])

  // 웹앱 상태 → 익스텐션 전달
  useEffect(() => {
    if (isRecording) postToExtension({ type: 'RECORDING_STARTED', title })
  }, [isRecording, title])

  useEffect(() => {
    if (step === 'review') postToExtension({ type: 'ANALYSIS_DONE', result: { title } })
    if (step === 'recording' && !isRecording) postToExtension({ type: 'RECORDING_STOPPED' })
  }, [step, isRecording, title])
}
