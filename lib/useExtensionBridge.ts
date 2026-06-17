import { useEffect } from 'react'
import { useMeetingStore, type Participant } from '@/store/meetingStore'

// 참석자 색상 팔레트 (나(진행자) 녹색 제외)
const PALETTE = [
  { color: '#539df5', bgColor: '#1a2a3a' },
  { color: '#f3727f', bgColor: '#3a1a1a' },
  { color: '#f5a623', bgColor: '#3a2a1a' },
  { color: '#b08df5', bgColor: '#2a1a3a' },
  { color: '#b3b3b3', bgColor: '#2a2a2a' },
]

type RawAttendee = { email: string; status?: string } | string

function buildParticipants(attendees: RawAttendee[]): Participant[] {
  const base: Participant = { id: '1', name: '나 (진행자)', color: '#1ed760', bgColor: '#1a3a1a' }
  const extras = attendees
    .map((a, i): Participant => {
      const name = typeof a === 'string' ? a : a.email.split('@')[0]
      const { color, bgColor } = PALETTE[i % PALETTE.length]
      return { id: String(i + 2), name, color, bgColor }
    })
    .filter((p) => p.name !== '나 (진행자)')
  return [base, ...extras]
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
      const { type, payload } = event.data

      if (type === 'START_RECORDING') {
        // 1단계: 깨끗하게 초기화
        resetMeeting()

        // 2단계: 제목 + 참석자 세팅
        if (payload?.title) setTitle(payload.title)

        if (Array.isArray(payload?.attendees) && payload.attendees.length > 0) {
          const participants = buildParticipants(payload.attendees)
          // resetMeeting이 기본 참석자(나)를 이미 넣으므로, 추가 참석자만 addParticipant
          participants.slice(1).forEach((p) => addParticipant(p))
        }

        // 3단계: 2단계(녹음)로 이동 — RecordingScreen이 자동으로 startRecording() 호출
        setStep('recording')
      }

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
