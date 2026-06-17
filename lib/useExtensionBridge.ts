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

function toName(a: RawAttendee): string {
  const email = typeof a === 'string' ? a : a.email
  return email.split('@')[0]
}

function buildExtraParticipants(attendees: RawAttendee[]): Participant[] {
  return attendees.map((a, i) => ({
    id: String(i + 2),
    name: toName(a),
    color: PALETTE[i % PALETTE.length].color,
    bgColor: PALETTE[i % PALETTE.length].bgColor,
  }))
}

function postToExtension(data: object) {
  window.postMessage({ source: 'meetnotes-app', ...data }, '*')
}

export function useExtensionBridge() {
  const {
    selectEventFromExt,
    startRecordingFromExt,
    step,
    isRecording,
    title,
  } = useMeetingStore()

  useEffect(() => {
    function applyExtEvent(data: { type: string; title?: string; attendees?: RawAttendee[] }) {
      const extra = buildExtraParticipants(
        Array.isArray(data.attendees) ? data.attendees : []
      )
      if (data.type === 'SELECT_EVENT') {
        selectEventFromExt(data.title ?? '', extra)
      } else if (data.type === 'START_RECORDING') {
        startRecordingFromExt(data.title ?? '', extra)
      } else if (data.type === 'STOP_RECORDING') {
        window.dispatchEvent(new CustomEvent('ext:stop-recording'))
      }
    }

    // 마운트 시 localStorage에 미처리 이벤트가 있으면 즉시 처리
    try {
      const raw = localStorage.getItem('meetnotes_pending_event')
      if (raw) {
        const data = JSON.parse(raw)
        if (data?.source === 'meetnotes-ext') applyExtEvent(data)
        localStorage.removeItem('meetnotes_pending_event')
      }
    } catch { /* ignore */ }

    function handleMessage(event: MessageEvent) {
      if (event.data?.source !== 'meetnotes-ext') return
      localStorage.removeItem('meetnotes_pending_event')
      applyExtEvent(event.data)
    }

    window.addEventListener('message', handleMessage)
    return () => window.removeEventListener('message', handleMessage)
  }, [selectEventFromExt, startRecordingFromExt])

  // 웹앱 상태 → 익스텐션 전달
  useEffect(() => {
    if (isRecording) postToExtension({ type: 'RECORDING_STARTED', title })
  }, [isRecording, title])

  useEffect(() => {
    if (step === 'review') postToExtension({ type: 'ANALYSIS_DONE', result: { title } })
    if (step === 'recording' && !isRecording) postToExtension({ type: 'RECORDING_STOPPED' })
  }, [step, isRecording, title])
}
