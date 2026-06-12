import { create } from 'zustand'

export type MeetingType = 'face' | 'online'
export type AppStep = 'setup' | 'recording' | 'review' | 'slack' | 'history'

export interface Participant {
  id: string
  name: string
  color: string
  bgColor: string
}

export interface Utterance {
  id: string
  speaker: string
  speakerName: string
  text: string
  timestamp: string
  isFinal: boolean
}

export interface ActionItem {
  id: string
  text: string
  assignee: string
  due: string
  priority: 'high' | 'medium' | 'low'
}

export interface MeetingMinutes {
  detail: string
  core: string
  keywords: string[]
  actions: ActionItem[]
  nextSteps: { title: string; reason: string }[]
}

export interface MeetingRecord {
  id: string
  title: string
  date: string
  duration: number
  participants: string[]
  minutes: MeetingMinutes
  utterances: Utterance[]   // 대화 원문 포함
  slackSent: boolean
  archived: boolean
}

// DB row → MeetingRecord 변환 (snake_case → camelCase)
// eslint-disable-next-line @typescript-eslint/no-explicit-any
function mapRow(row: any): MeetingRecord {
  return {
    id: row.id,
    title: row.title,
    date: row.date,
    duration: row.duration,
    participants: row.participants ?? [],
    minutes: row.minutes,
    utterances: row.utterances ?? [],
    slackSent: row.slack_sent ?? false,
    archived: row.archived ?? false,
  }
}

interface MeetingStore {
  // Step
  step: AppStep
  setStep: (s: AppStep) => void

  // Setup
  title: string
  setTitle: (t: string) => void
  meetingType: MeetingType
  setMeetingType: (t: MeetingType) => void
  participants: Participant[]
  addParticipant: (p: Participant) => void
  removeParticipant: (id: string) => void
  updateParticipantName: (id: string, name: string) => void
  slackChannel: string
  setSlackChannel: (c: string) => void
  aiOptions: { diarization: boolean; nextSteps: boolean; captions: boolean; history: boolean }
  toggleAiOption: (key: keyof MeetingStore['aiOptions']) => void

  // Recording
  isRecording: boolean
  isPaused: boolean
  setRecording: (v: boolean) => void
  setPaused: (v: boolean) => void
  elapsedSeconds: number
  setElapsedSeconds: (s: number) => void
  utterances: Utterance[]
  addUtterance: (u: Utterance) => void
  updateLastUtterance: (text: string) => void
  finalizeLastUtterance: (text: string) => void
  speakerMap: Record<string, string>
  setSpeakerName: (speaker: string, name: string) => void
  keywords: string[]
  addKeywords: (kws: string[]) => void

  // Analysis
  isAnalyzing: boolean
  setAnalyzing: (v: boolean) => void
  minutes: MeetingMinutes | null
  setMinutes: (m: MeetingMinutes) => void
  analysisError: string | null
  setAnalysisError: (e: string | null) => void
  audioUrl: string | null
  setAudioUrl: (url: string | null) => void
  audioMimeType: string
  setAudioMimeType: (t: string) => void
  currentMeetingId: string | null
  setCurrentMeetingId: (id: string | null) => void

  // Reset
  resetMeeting: () => void

  // History (Supabase)
  meetingHistory: MeetingRecord[]
  isHistoryLoading: boolean
  loadHistory: () => Promise<void>
  addToHistory: (r: MeetingRecord) => Promise<void>
  removeFromHistory: (id: string) => Promise<void>
  markSlackSent: (id: string) => Promise<void>
  toggleArchive: (id: string) => Promise<void>
  clearHistory: () => Promise<void>

  // Slack
  slackFormat: 'full' | 'brief' | 'actions'
  setSlackFormat: (f: 'full' | 'brief' | 'actions') => void
  slackOptions: { thread: boolean; mention: boolean; transcript: boolean; save: boolean }
  toggleSlackOption: (key: keyof MeetingStore['slackOptions']) => void
  isSending: boolean
  setSending: (v: boolean) => void
  sent: boolean
  setSent: (v: boolean) => void
}

const COLORS = [
  { color: '#1ed760', bgColor: '#1a3a1a' },
  { color: '#539df5', bgColor: '#1a2a3a' },
  { color: '#ffa42b', bgColor: '#3a2a1a' },
  { color: '#c77dff', bgColor: '#2a1a3a' },
  { color: '#f3727f', bgColor: '#3a1a1a' },
]

export const useMeetingStore = create<MeetingStore>((set, get) => ({
  step: 'setup',
  setStep: (step) => set({ step }),

  title: '',
  setTitle: (title) => set({ title }),
  meetingType: 'face',
  setMeetingType: (meetingType) => set({ meetingType }),
  participants: [
    { id: '1', name: '나 (진행자)', color: '#1ed760', bgColor: '#1a3a1a' },
  ],
  addParticipant: (p) => set((s) => ({ participants: [...s.participants, p] })),
  removeParticipant: (id) =>
    set((s) => ({ participants: s.participants.filter((p) => p.id !== id) })),
  updateParticipantName: (id, name) =>
    set((s) => ({ participants: s.participants.map((p) => p.id === id ? { ...p, name } : p) })),
  slackChannel: '#product-team',
  setSlackChannel: (slackChannel) => set({ slackChannel }),
  aiOptions: { diarization: true, nextSteps: true, captions: true, history: true },
  toggleAiOption: (key) =>
    set((s) => ({ aiOptions: { ...s.aiOptions, [key]: !s.aiOptions[key] } })),

  isRecording: false,
  isPaused: false,
  setRecording: (isRecording) => set({ isRecording }),
  setPaused: (isPaused) => set({ isPaused }),
  elapsedSeconds: 0,
  setElapsedSeconds: (elapsedSeconds) => set({ elapsedSeconds }),
  utterances: [],
  addUtterance: (u) => set((s) => ({ utterances: [...s.utterances, u] })),
  updateLastUtterance: (text) =>
    set((s) => {
      const utts = [...s.utterances]
      for (let i = utts.length - 1; i >= 0; i--) {
        if (!utts[i].isFinal) { utts[i] = { ...utts[i], text }; break }
      }
      return { utterances: utts }
    }),
  finalizeLastUtterance: (text) =>
    set((s) => {
      const utts = [...s.utterances]
      for (let i = utts.length - 1; i >= 0; i--) {
        if (!utts[i].isFinal) { utts[i] = { ...utts[i], text, isFinal: true }; break }
      }
      return { utterances: utts }
    }),
  speakerMap: {},
  setSpeakerName: (speaker, name) =>
    set((s) => ({ speakerMap: { ...s.speakerMap, [speaker]: name } })),
  keywords: [],
  addKeywords: (kws) => set((s) => ({
    keywords: [...new Set([...s.keywords, ...kws])]  // deduplicate
  })),

  isAnalyzing: false,
  setAnalyzing: (isAnalyzing) => set({ isAnalyzing }),
  minutes: null,
  setMinutes: (minutes) => set({ minutes }),
  analysisError: null,
  setAnalysisError: (analysisError) => set({ analysisError }),
  audioUrl: null,
  setAudioUrl: (audioUrl) => set({ audioUrl }),
  audioMimeType: 'audio/webm',
  setAudioMimeType: (audioMimeType) => set({ audioMimeType }),
  currentMeetingId: null,
  setCurrentMeetingId: (currentMeetingId) => set({ currentMeetingId }),

  resetMeeting: () =>
    set({
      step: 'setup',
      title: '',
      meetingType: 'face',
      participants: [{ id: '1', name: '나 (진행자)', color: '#1ed760', bgColor: '#1a3a1a' }],
      isRecording: false,
      isPaused: false,
      elapsedSeconds: 0,
      utterances: [],
      speakerMap: {},
      keywords: [],
      isAnalyzing: false,
      minutes: null,
      analysisError: null,
      audioUrl: null,
      audioMimeType: 'audio/webm',
      currentMeetingId: null,
      slackFormat: 'full',
      slackOptions: { thread: false, mention: true, transcript: false, save: true },
      isSending: false,
      sent: false,
    }),

  // ── History (Supabase API) ──────────────────────────────────────
  meetingHistory: [],
  isHistoryLoading: false,

  loadHistory: async () => {
    set({ isHistoryLoading: true })
    try {
      const res = await fetch('/api/meetings')
      const data = await res.json()
      if (Array.isArray(data)) {
        set({ meetingHistory: data.map(mapRow) })
      }
    } catch (e) {
      console.error('loadHistory error:', e)
    } finally {
      set({ isHistoryLoading: false })
    }
  },

  addToHistory: async (record) => {
    // 낙관적 업데이트 먼저
    set((s) => ({ meetingHistory: [record, ...s.meetingHistory] }))
    try {
      await fetch('/api/meetings', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(record),
      })
    } catch (e) {
      console.error('addToHistory error:', e)
      // 실패 시 롤백
      set((s) => ({ meetingHistory: s.meetingHistory.filter((r) => r.id !== record.id) }))
    }
  },

  removeFromHistory: async (id) => {
    const prev = get().meetingHistory
    set((s) => ({ meetingHistory: s.meetingHistory.filter((r) => r.id !== id) }))
    try {
      await fetch(`/api/meetings/${id}`, { method: 'DELETE' })
    } catch (e) {
      console.error('removeFromHistory error:', e)
      set({ meetingHistory: prev })
    }
  },

  markSlackSent: async (id) => {
    set((s) => ({
      meetingHistory: s.meetingHistory.map((r) => r.id === id ? { ...r, slackSent: true } : r),
    }))
    try {
      await fetch(`/api/meetings/${id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ slackSent: true }),
      })
    } catch (e) {
      console.error('markSlackSent error:', e)
    }
  },

  toggleArchive: async (id) => {
    const record = get().meetingHistory.find((r) => r.id === id)
    if (!record) return
    const newArchived = !record.archived
    set((s) => ({
      meetingHistory: s.meetingHistory.map((r) => r.id === id ? { ...r, archived: newArchived } : r),
    }))
    try {
      await fetch(`/api/meetings/${id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ archived: newArchived }),
      })
    } catch (e) {
      console.error('toggleArchive error:', e)
    }
  },

  clearHistory: async () => {
    const prev = get().meetingHistory
    set({ meetingHistory: [] })
    try {
      await Promise.all(prev.map((r) => fetch(`/api/meetings/${r.id}`, { method: 'DELETE' })))
    } catch (e) {
      console.error('clearHistory error:', e)
      set({ meetingHistory: prev })
    }
  },

  // ── Slack ──────────────────────────────────────────────────────
  slackFormat: 'full',
  setSlackFormat: (slackFormat) => set({ slackFormat }),
  slackOptions: { thread: false, mention: true, transcript: false, save: true },
  toggleSlackOption: (key) =>
    set((s) => ({ slackOptions: { ...s.slackOptions, [key]: !s.slackOptions[key] } })),
  isSending: false,
  setSending: (isSending) => set({ isSending }),
  sent: false,
  setSent: (sent) => set({ sent }),
}))

export { COLORS }
