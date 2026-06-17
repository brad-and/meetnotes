'use client'
import { useEffect, useRef, useState, useCallback } from 'react'
import { useMeetingStore } from '@/store/meetingStore'
import { useDeepgram, mimeTypeToExt } from '@/lib/useDeepgram'
import Topbar from '@/components/ui/Topbar'

const SPEAKER_COLORS = ['#1ed760', '#539df5', '#ffa42b', '#c77dff', '#f3727f']
const SPEAKER_BG = ['#1a3a1a', '#1a2a3a', '#3a2a1a', '#2a1a3a', '#3a1a1a']

const GAIN_PRESETS = [0.5, 1.0, 1.5, 2.0, 3.0, 4.0]
const GAIN_LABELS: Record<number, string> = {
  0.5: '0.5x', 1.0: '1x', 1.5: '1.5x', 2.0: '2x', 3.0: '3x', 4.0: '4x',
}
const BAR_COUNT = 60

function formatTime(s: number) {
  const h = Math.floor(s / 3600).toString().padStart(2, '0')
  const m = Math.floor((s % 3600) / 60).toString().padStart(2, '0')
  const sec = (s % 60).toString().padStart(2, '0')
  return `${h}:${m}:${sec}`
}

function getSpeakerIdx(speaker: string) {
  const num = parseInt(speaker.replace(/\D/g, '') || '0')
  return num % SPEAKER_COLORS.length
}

function CircularVU({ bars, isPaused }: { bars: number[]; isPaused: boolean }) {
  const N       = bars.length
  const CX = 110, CY = 110
  const INNER_R = 60
  const MAX_BAR = 42

  const barColor = (ratio: number) => {
    if (ratio > 0.85) return '#f3727f'
    if (ratio > 0.65) return '#ffa42b'
    if (ratio > 0.28) return '#1ed760'
    return '#3d8fd4'
  }

  return (
    <svg width="220" height="220" viewBox="0 0 220 220">
      <defs>
        <filter id="vuGlow" x="-60%" y="-60%" width="220%" height="220%">
          <feGaussianBlur stdDeviation="3" result="blur" />
          <feMerge>
            <feMergeNode in="blur" />
            <feMergeNode in="SourceGraphic" />
          </feMerge>
        </filter>
        <radialGradient id="centerFill" cx="50%" cy="50%" r="50%">
          <stop offset="0%" stopColor="#1c1c1c" />
          <stop offset="100%" stopColor="#111" />
        </radialGradient>
      </defs>

      {/* Inner disc */}
      <circle cx={CX} cy={CY} r={INNER_R} fill="url(#centerFill)" />
      <circle cx={CX} cy={CY} r={INNER_R} fill="none" stroke="#1f1f1f" strokeWidth="1" />

      {/* Ambient pulse ring */}
      {!isPaused && (
        <circle cx={CX} cy={CY} r={INNER_R - 14} fill="none"
          stroke="#1ed760" strokeWidth="22" opacity="0.055"
          style={{ animation: 'pulseRing 2s ease-in-out infinite' }}
        />
      )}

      {/* Background tick marks */}
      {Array.from({ length: N }, (_, i) => {
        const angle = (i / N) * Math.PI * 2 - Math.PI / 2
        return (
          <line key={`bg-${i}`}
            x1={CX + INNER_R * Math.cos(angle)}
            y1={CY + INNER_R * Math.sin(angle)}
            x2={CX + (INNER_R + 4) * Math.cos(angle)}
            y2={CY + (INNER_R + 4) * Math.sin(angle)}
            stroke="#282828" strokeWidth="1.5" strokeLinecap="round"
          />
        )
      })}

      {/* Active bars */}
      {bars.map((h, i) => {
        const angle   = (i / N) * Math.PI * 2 - Math.PI / 2
        const ratio   = h / 26
        const barLen  = isPaused ? 2 : Math.max(2, ratio * MAX_BAR)
        const color   = isPaused ? '#252525' : barColor(ratio)
        const opacity = isPaused ? 0.15 : Math.max(0.4, ratio * 1.1)
        return (
          <line key={i}
            x1={CX + INNER_R * Math.cos(angle)}
            y1={CY + INNER_R * Math.sin(angle)}
            x2={CX + (INNER_R + barLen) * Math.cos(angle)}
            y2={CY + (INNER_R + barLen) * Math.sin(angle)}
            stroke={color} strokeWidth="2" strokeLinecap="round" opacity={opacity}
            style={{ transition: isPaused ? 'none' : 'all 55ms ease-out' }}
          />
        )
      })}

      {/* Glow layer for tall bars */}
      {!isPaused && bars.some((h) => h / 26 >= 0.5) && (
        <g filter="url(#vuGlow)">
          {bars.map((h, i) => {
            const ratio = h / 26
            if (ratio < 0.5) return null
            const angle  = (i / N) * Math.PI * 2 - Math.PI / 2
            const barLen = ratio * MAX_BAR
            return (
              <line key={`g-${i}`}
                x1={CX + INNER_R * Math.cos(angle)}
                y1={CY + INNER_R * Math.sin(angle)}
                x2={CX + (INNER_R + barLen) * Math.cos(angle)}
                y2={CY + (INNER_R + barLen) * Math.sin(angle)}
                stroke={barColor(ratio)} strokeWidth="2" strokeLinecap="round"
                opacity={ratio * 0.7}
              />
            )
          })}
        </g>
      )}

      {/* Mic icon */}
      <g transform={`translate(${CX},${CY - 2})`} opacity={isPaused ? 0.3 : 1}>
        <rect x="-8" y="-17" width="16" height="22" rx="8"
          fill="none" stroke={isPaused ? '#3a3a3a' : '#1ed760'} strokeWidth="2" />
        <path d="M -12,8 A 12,12 0 0,0 12,8"
          fill="none" stroke={isPaused ? '#3a3a3a' : '#1ed760'} strokeWidth="2" strokeLinecap="round" />
        <line x1="0" y1="20" x2="0" y2="15"
          stroke={isPaused ? '#3a3a3a' : '#1ed760'} strokeWidth="2" strokeLinecap="round" />
        <line x1="-5" y1="20" x2="5" y2="20"
          stroke={isPaused ? '#3a3a3a' : '#1ed760'} strokeWidth="2" strokeLinecap="round" />
      </g>
    </svg>
  )
}

export default function RecordingScreen() {
  const {
    isPaused, elapsedSeconds, utterances, participants,
    isRecording, setStep, setAnalyzing, setMinutes, title, addToHistory,
    meetingType, recordingMode, addUtterance, setElapsedSeconds, speakerMap, setSpeakerName,
    setAudioUrl, setAudioMimeType, setCurrentMeetingId, setAnalysisError,
    keywords,
  } = useMeetingStore()
  const { startRecording, pauseRecording, resumeRecording, stopRecording, getAudioBlob, getAudioMimeType, setGain, getVolumeLevel } = useDeepgram()
  const [activeTab, setActiveTab] = useState<'summary' | 'speakers' | 'actions'>('summary')

  // Online meeting file upload state
  const [uploadFile, setUploadFile] = useState<File | null>(null)
  const [isTranscribing, setIsTranscribing] = useState(false)
  const [uploadDone, setUploadDone] = useState(false)
  const fileInputRef = useRef<HTMLInputElement>(null)

  // ── 마이크 감도 & 기기 선택 ────────────────────────────────────────────
  const [gainLevel, setGainLevel]         = useState<number>(2.0)
  const [micDevices, setMicDevices]       = useState<MediaDeviceInfo[]>([])
  const [selectedMicId, setSelectedMicId] = useState<string>('')
  const [showMicMenu, setShowMicMenu]     = useState(false)
  // VU 미터 애니메이션
  const [volumeBars, setVolumeBars]       = useState<number[]>(Array(BAR_COUNT).fill(2))
  const animFrameRef                      = useRef<number | null>(null)

  // 마이크 목록 가져오기 (권한 허용 후에야 label 표시)
  useEffect(() => {
    const load = () =>
      navigator.mediaDevices.enumerateDevices()
        .then((devices) => setMicDevices(devices.filter((d) => d.kind === 'audioinput')))
        .catch(console.error)
    load()
    navigator.mediaDevices.addEventListener('devicechange', load)
    return () => navigator.mediaDevices.removeEventListener('devicechange', load)
  }, [])

  // VU 미터 — requestAnimationFrame 루프
  useEffect(() => {
    if (!isRecording || isPaused) {
      const frame = requestAnimationFrame(() => setVolumeBars(Array(BAR_COUNT).fill(2)))
      return () => cancelAnimationFrame(frame)
    }
    const animate = () => {
      const level = getVolumeLevel()  // 0-100
      const bars  = Array.from({ length: BAR_COUNT }, () => {
        const jitter = level > 4 ? (Math.random() - 0.5) * level * 0.65 : 0
        return Math.min(26, Math.max(2, level * 0.8 + jitter))
      })
      setVolumeBars(bars)
      animFrameRef.current = requestAnimationFrame(animate)
    }
    animFrameRef.current = requestAnimationFrame(animate)
    return () => {
      if (animFrameRef.current) cancelAnimationFrame(animFrameRef.current)
    }
  }, [isRecording, isPaused, getVolumeLevel])

  // 마이크 변경 — 녹음 중이면 재시작
  const handleMicChange = useCallback((deviceId: string) => {
    setSelectedMicId(deviceId)
    setShowMicMenu(false)
  }, [])

  // 게인 프리셋 순환
  const cycleGain = useCallback(() => {
    const idx     = GAIN_PRESETS.indexOf(gainLevel)
    const next    = GAIN_PRESETS[(idx + 1) % GAIN_PRESETS.length]
    setGainLevel(next)
    setGain(next)
  }, [gainLevel, setGain])

  useEffect(() => {
    if (meetingType === 'face') {
      startRecording(selectedMicId || undefined, {
        realtimeTranscript: recordingMode === 'realtime',
        realtimeKeywords: recordingMode === 'realtime',
      })
      return () => stopRecording()
    }
  }, [meetingType, recordingMode, selectedMicId, startRecording, stopRecording])

  const handleFileUpload = useCallback(async () => {
    if (!uploadFile) return
    setIsTranscribing(true)

    try {
      const form = new FormData()
      form.append('audio', uploadFile)
      const res = await fetch('/api/transcribe/file', { method: 'POST', body: form })
      const data = await res.json()

      if (data.utterances) {
        // Estimate duration from last utterance timestamp or file size
        const duration = Math.round(uploadFile.size / 16000)
        setElapsedSeconds(duration)
        for (const u of data.utterances) addUtterance(u)
        setUploadDone(true)
      }
    } catch (e) {
      console.error('Transcribe error:', e)
      alert('파일 전사에 실패했어요. 다시 시도해주세요.')
    } finally {
      setIsTranscribing(false)
    }
  }, [uploadFile, addUtterance, setElapsedSeconds])

  const handleStop = async () => {
    let audioBlob: Blob | null = null
    if (meetingType === 'face') {
      stopRecording()
      audioBlob = getAudioBlob()
      if (audioBlob) {
        setAudioUrl(URL.createObjectURL(audioBlob))
        setAudioMimeType(getAudioMimeType())
      }
    }
    setStep('review')
    setAnalyzing(true)
    setAnalysisError(null)

    const meetingId = Date.now().toString()

    try {
      let res: Response

      const realtimeTranscript = utterances
        .filter((u) => u.isFinal)
        .map((u) => `${u.speakerName}: ${u.text}`)
        .join('\n')

      if (meetingType === 'face' && recordingMode === 'realtime' && realtimeTranscript) {
        res = await fetch('/api/analyze', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            transcript: realtimeTranscript,
            participants: participants.map((p) => p.name),
            title,
          }),
        })
      } else if (meetingType === 'face' && audioBlob) {
        const mimeType = getAudioMimeType()
        const form = new FormData()
        form.append('audio', new File([audioBlob], `meeting.${mimeTypeToExt(mimeType)}`, { type: mimeType }))
        form.append('title', title)
        form.append('participants', JSON.stringify(participants.map((p) => p.name)))
        res = await fetch('/api/analyze', { method: 'POST', body: form })
      } else {
        // online meeting: use existing transcript from file upload
        const transcript = utterances
          .filter((u) => u.isFinal)
          .map((u) => `${u.speakerName}: ${u.text}`)
          .join('\n')
        res = await fetch('/api/analyze', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            transcript: transcript || '(트랜스크립트 없음)',
            participants: participants.map((p) => p.name),
            title,
          }),
        })
      }

      if (!res.ok) {
        const text = await res.text()
        throw new Error(`분석 API 오류 (${res.status}): ${text}`)
      }
      const data = await res.json()
      const finalUtterances = Array.isArray(data.utterances) && data.utterances.length > 0
        ? data.utterances
        : utterances.filter((u) => u.isFinal)
      if (data.minutes) {
        // audio 전사 결과가 있으면 store에 추가
        if (data.utterances && Array.isArray(data.utterances) && data.utterances.length > 0) {
          for (const u of data.utterances) {
            addUtterance({ ...u, id: `${Date.now()}-${Math.random()}` })
          }
        }
        setMinutes(data.minutes)
        setCurrentMeetingId(meetingId)
        await addToHistory({
          id: meetingId,
          title,
          date: new Date().toLocaleDateString('ko-KR'),
          duration: elapsedSeconds,
          participants: participants.map((p) => p.name),
          minutes: data.minutes,
          utterances: finalUtterances,
          slackSent: false,
          archived: false,
        })
      }
    } catch (e) {
      const errMsg = e instanceof Error ? e.message : String(e)
      console.error('Analysis error:', e)

      // AI 분석 실패해도 참여자 정보를 보존
      const fallbackMinutes = {
        detail: '(분석 실패)',
        core: '',
        keywords: [] as string[],
        actions: [] as { id: string; text: string; assignee: string; due: string; priority: 'high' | 'medium' | 'low' }[],
        nextSteps: [] as { title: string; reason: string }[],
      }
      setMinutes(fallbackMinutes)
      setAnalysisError(errMsg)
      setCurrentMeetingId(meetingId)
      await addToHistory({
        id: meetingId,
        title,
        date: new Date().toLocaleDateString('ko-KR'),
        duration: elapsedSeconds,
        participants: participants.map((p) => p.name),
        minutes: fallbackMinutes,
        utterances: utterances.filter((u) => u.isFinal),
        slackSent: false,
        archived: false,
      }).catch((saveErr) => console.error('Fallback save error:', saveErr))
    } finally {
      setAnalyzing(false)
    }
  }

  // Speaker stats (for online meeting uploaded transcript)
  const speakerStats = utterances.filter((u) => u.isFinal).reduce((acc, u) => {
    acc[u.speaker] = (acc[u.speaker] || 0) + u.text.split(' ').length
    return acc
  }, {} as Record<string, number>)
  const totalWords = Object.values(speakerStats).reduce((a, b) => a + b, 0) || 1

  // Online meeting: file upload UI
  if (meetingType === 'online' && !uploadDone) {
    return (
      <div style={{ minHeight: '100vh', background: '#121212' }}>
        <Topbar>
          <span style={{ fontSize: 14, fontWeight: 700, color: '#fff' }}>온라인 회의 — 파일 업로드</span>
          <button className="btn-pill" onClick={() => setStep('setup')}>← 돌아가기</button>
        </Topbar>

        <div style={{ maxWidth: 560, margin: '0 auto', padding: '60px 24px' }}>
          <h1 style={{ fontSize: 22, fontWeight: 700, color: '#fff', marginBottom: 6 }}>회의 녹음 파일 업로드</h1>
          <p style={{ fontSize: 14, color: '#b3b3b3', marginBottom: 32 }}>
            Zoom · Teams · Google Meet에서 저장한 오디오/영상 파일을 업로드해주세요.
          </p>

          {/* Drop zone */}
          <div
            onClick={() => fileInputRef.current?.click()}
            onDragOver={(e) => e.preventDefault()}
            onDrop={(e) => {
              e.preventDefault()
              const file = e.dataTransfer.files[0]
              if (file) setUploadFile(file)
            }}
            style={{
              border: `2px dashed ${uploadFile ? '#1ed760' : '#4d4d4d'}`,
              borderRadius: 12, padding: '48px 24px', textAlign: 'center', cursor: 'pointer',
              background: uploadFile ? '#0d1f0d' : '#181818',
              transition: 'all .2s', marginBottom: 20,
            }}
          >
            <div style={{ fontSize: 40, marginBottom: 12 }}>{uploadFile ? '🎵' : '📁'}</div>
            {uploadFile ? (
              <>
                <div style={{ fontSize: 15, fontWeight: 700, color: '#1ed760', marginBottom: 4 }}>{uploadFile.name}</div>
                <div style={{ fontSize: 12, color: '#b3b3b3' }}>{(uploadFile.size / 1024 / 1024).toFixed(1)} MB</div>
              </>
            ) : (
              <>
                <div style={{ fontSize: 15, fontWeight: 700, color: '#fff', marginBottom: 6 }}>클릭하거나 파일을 드래그하세요</div>
                <div style={{ fontSize: 12, color: '#b3b3b3' }}>MP3 · MP4 · WAV · M4A · OGG · WEBM 지원</div>
              </>
            )}
          </div>

          <input
            ref={fileInputRef}
            type="file"
            accept="audio/*,video/mp4,video/webm"
            style={{ display: 'none' }}
            onChange={(e) => { const f = e.target.files?.[0]; if (f) setUploadFile(f) }}
          />

          {uploadFile && (
            <div style={{ display: 'flex', gap: 8 }}>
              <button className="btn-pill" onClick={() => setUploadFile(null)} style={{ flex: 1, justifyContent: 'center' }}>다른 파일 선택</button>
              <button
                className="btn-green"
                onClick={handleFileUpload}
                disabled={isTranscribing}
                style={{ flex: 2, justifyContent: 'center' }}
              >
                {isTranscribing ? (
                  <>
                    <div style={{ width: 14, height: 14, border: '2px solid #000', borderTop: '2px solid transparent', borderRadius: '50%', animation: 'spin .8s linear infinite' }} />
                    전사 중...
                  </>
                ) : '전사 시작하기'}
              </button>
            </div>
          )}

          <div style={{ marginTop: 24, padding: 14, background: '#181818', borderRadius: 8, borderLeft: '3px solid #539df5' }}>
            <div style={{ fontSize: 12, fontWeight: 700, color: '#539df5', marginBottom: 4 }}>참고</div>
            <div style={{ fontSize: 12, color: '#b3b3b3', lineHeight: 1.7 }}>
              파일이 클수록 전사 시간이 오래 걸릴 수 있어요.<br />
              Deepgram Nova-2 모델로 한국어 다화자 분리를 지원해요.
            </div>
          </div>
        </div>
        <style>{`@keyframes spin{to{transform:rotate(360deg)}}`}</style>
      </div>
    )
  }

  return (
    <div style={{ height: '100vh', display: 'flex', flexDirection: 'column', background: '#121212' }}>
      <Topbar>
        <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
          {meetingType === 'face' ? (
            <>
              <div style={{
                display: 'flex', alignItems: 'center', gap: 6,
                background: '#3a1a1a', color: '#f3727f', fontSize: 12, fontWeight: 700,
                padding: '5px 14px', borderRadius: 9999, textTransform: 'uppercase', letterSpacing: '1.4px',
              }}>
                <div style={{
                  width: 7, height: 7, borderRadius: '50%', background: '#f3727f',
                  animation: isPaused ? 'none' : 'pulse 1.2s ease-in-out infinite',
                }} />
                {isPaused ? 'PAUSED' : 'REC'}
              </div>
              <span style={{ fontSize: 18, fontWeight: 700, fontVariantNumeric: 'tabular-nums' }}>
                {formatTime(elapsedSeconds)}
              </span>
            </>
          ) : (
            <div style={{
              display: 'flex', alignItems: 'center', gap: 6,
              background: '#1a3a1a', color: '#1ed760', fontSize: 12, fontWeight: 700,
              padding: '5px 14px', borderRadius: 9999, textTransform: 'uppercase', letterSpacing: '1.4px',
            }}>
              ✓ 전사 완료 · {utterances.length}개 발화
            </div>
          )}
        </div>
        <div style={{ display: 'flex', gap: 8 }}>
          {meetingType === 'face' && (
            <button
              className="btn-pill"
              onClick={isPaused ? resumeRecording : pauseRecording}
            >
              {isPaused ? '▶ 재개' : '⏸ 일시정지'}
            </button>
          )}
          <button
            className={meetingType === 'face' ? 'btn-danger' : 'btn-green'}
            onClick={handleStop}
          >
            {meetingType === 'face' ? '⏹ 종료' : '✨ AI 분석 시작'}
          </button>
        </div>
      </Topbar>

      <div style={{ flex: 1, display: 'flex', justifyContent: 'center', overflow: 'hidden', minHeight: 0 }}>
      <div style={{ width: '100%', maxWidth: 1280, display: 'grid', gridTemplateColumns: 'minmax(0, 1fr) minmax(280px, 340px)', overflow: 'hidden', minHeight: 0 }}>
        {/* Left: Recording status panel */}
        <div style={{ display: 'flex', flexDirection: 'column', borderRight: '1px solid #2a2a2a', minHeight: 0, overflow: 'hidden' }}>
          <div style={{
            padding: '12px 18px', borderBottom: '1px solid #2a2a2a',
            background: '#181818', display: 'flex', alignItems: 'center', justifyContent: 'space-between',
          }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
              <div style={{
                width: 8, height: 8, borderRadius: '50%', background: '#f3727f',
                animation: isPaused ? 'none' : 'pulse 1.2s ease-in-out infinite',
              }} />
              <span style={{ fontSize: 13, fontWeight: 700, textTransform: 'uppercase', letterSpacing: '1.4px' }}>
                {isPaused ? '일시정지' : recordingMode === 'realtime' ? '실시간 대사 녹음 중' : '표준 녹음 중'}
              </span>
            </div>
          </div>

          {/* Main recording area */}
          <div style={{ flex: 1, overflowY: 'auto', padding: '24px 18px', display: 'flex', flexDirection: 'column', gap: 24 }}>
            {/* Circular VU Visualizer */}
            <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 6 }}>
              <CircularVU bars={volumeBars} isPaused={isPaused} />
              <span style={{ fontSize: 11, color: '#4d4d4d', fontWeight: 700, textTransform: 'uppercase', letterSpacing: '1.4px' }}>
                {isPaused ? '일시정지됨' : '마이크 입력 중'}
              </span>
            </div>

            {recordingMode === 'realtime' ? (
              <>
                <div style={{ background: '#181818', borderRadius: 10, padding: '16px 18px', border: '1px solid #2a2a2a' }}>
                  <div style={{
                    fontSize: 10, fontWeight: 700, color: '#b3b3b3',
                    textTransform: 'uppercase', letterSpacing: '2px', marginBottom: 12,
                    display: 'flex', alignItems: 'center', gap: 5,
                  }}>
                    <div style={{ width: 5, height: 5, borderRadius: '50%', background: '#1ed760' }} />
                    실시간 대사
                  </div>
                  {utterances.length === 0 ? (
                    <div style={{ fontSize: 12, color: '#4d4d4d', lineHeight: 1.6 }}>
                      말소리가 감지되면 Deepgram 전사 결과가 여기에 표시됩니다.
                    </div>
                  ) : (
                    <div style={{ display: 'flex', flexDirection: 'column', gap: 10, maxHeight: 260, overflowY: 'auto' }}>
                      {utterances.slice(-8).map((u) => (
                        <div key={u.id} style={{ display: 'grid', gridTemplateColumns: '72px 1fr', gap: 10, alignItems: 'start' }}>
                          <div style={{ fontSize: 11, color: '#1ed760', fontWeight: 700, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                            {u.speakerName}
                          </div>
                          <div style={{ fontSize: 13, color: u.isFinal ? '#fff' : '#b3b3b3', lineHeight: 1.55 }}>
                            {u.text}
                            {!u.isFinal && <span style={{ color: '#539df5' }}> …</span>}
                          </div>
                        </div>
                      ))}
                    </div>
                  )}
                </div>

                <div style={{ background: '#181818', borderRadius: 10, padding: '16px 18px', border: '1px solid #2a2a2a' }}>
                  <div style={{
                    fontSize: 10, fontWeight: 700, color: '#b3b3b3',
                    textTransform: 'uppercase', letterSpacing: '2px', marginBottom: 12,
                    display: 'flex', alignItems: 'center', gap: 5,
                  }}>
                    <div style={{ width: 5, height: 5, borderRadius: '50%', background: '#539df5' }} />
                    실시간 키워드
                  </div>
                  {keywords.length === 0 ? (
                    <div style={{ fontSize: 12, color: '#4d4d4d', lineHeight: 1.6 }}>
                      20초마다 회의 키워드를 추출해요...
                    </div>
                  ) : (
                    <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8 }}>
                      {keywords.map((kw, idx) => (
                        <span
                          key={`${kw}-${idx}`}
                          style={{
                            fontSize: 12, fontWeight: 700,
                            padding: '4px 12px', borderRadius: 9999,
                            background: '#1a2a3a', color: '#539df5',
                            border: '1px solid #1a3a5a',
                          }}
                        >
                          {kw}
                        </span>
                      ))}
                    </div>
                  )}
                </div>
              </>
            ) : (
              <div style={{ background: '#181818', borderRadius: 10, padding: '16px 18px', border: '1px solid #2a2a2a' }}>
                <div style={{
                  fontSize: 10, fontWeight: 700, color: '#b3b3b3',
                  textTransform: 'uppercase', letterSpacing: '2px', marginBottom: 12,
                  display: 'flex', alignItems: 'center', gap: 5,
                }}>
                  <div style={{ width: 5, height: 5, borderRadius: '50%', background: '#1ed760' }} />
                  표준 녹음
                </div>
                <div style={{ fontSize: 12, color: '#b3b3b3', lineHeight: 1.7 }}>
                  실시간 전사 연결 없이 녹음 안정성을 우선합니다. 녹음 종료 후 전체 오디오를 AI가 전사하고 회의록으로 정리합니다.
                </div>
              </div>
            )}

            {/* Info text */}
            <div style={{
              padding: '14px 16px', borderRadius: 8,
              background: '#141414', border: '1px solid #2a2a2a',
              borderLeft: '3px solid #1ed760',
            }}>
              <div style={{ fontSize: 12, color: '#b3b3b3', lineHeight: 1.7 }}>
                {recordingMode === 'realtime'
                  ? '녹음 종료 후 실시간 대사 내용을 우선 사용해 회의록을 작성합니다.'
                  : '녹음 종료 후 AI가 전체 내용을 전사하고 회의록을 작성합니다.'}
              </div>
            </div>
          </div>

          {/* 마이크 선택 바 (2개 이상 마이크 감지 시 표시) */}
          {micDevices.length > 1 && (
            <div style={{
              padding: '6px 18px', borderTop: '1px solid #2a2a2a',
              background: '#141414', position: 'relative',
            }}>
              <button
                onClick={() => setShowMicMenu((v) => !v)}
                style={{
                  display: 'flex', alignItems: 'center', gap: 6, background: 'none',
                  border: '1px solid #2a2a2a', borderRadius: 6, padding: '4px 10px',
                  cursor: 'pointer', color: '#b3b3b3', fontSize: 11,
                }}
              >
                <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
                  <path d="M12 2a3 3 0 0 0-3 3v7a3 3 0 0 0 6 0V5a3 3 0 0 0-3-3z"/>
                  <path d="M19 10v2a7 7 0 0 1-14 0v-2M12 19v3"/>
                </svg>
                <span style={{ maxWidth: 200, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                  {micDevices.find((d) => d.deviceId === selectedMicId)?.label
                    || micDevices[0]?.label
                    || '기본 마이크'}
                </span>
                <span style={{ fontSize: 9, color: '#4d4d4d' }}>▾</span>
              </button>

              {showMicMenu && (
                <div style={{
                  position: 'absolute', bottom: '100%', left: 18, zIndex: 50,
                  background: '#252525', border: '1px solid #3a3a3a', borderRadius: 8,
                  padding: 4, minWidth: 260, boxShadow: '0 -4px 24px rgba(0,0,0,.5)',
                }}>
                  {micDevices.map((d) => (
                    <button
                      key={d.deviceId}
                      onClick={() => handleMicChange(d.deviceId)}
                      style={{
                        display: 'block', width: '100%', textAlign: 'left',
                        padding: '8px 12px', fontSize: 12, cursor: 'pointer',
                        background: d.deviceId === (selectedMicId || micDevices[0]?.deviceId)
                          ? '#1a3a1a' : 'transparent',
                        color: d.deviceId === (selectedMicId || micDevices[0]?.deviceId)
                          ? '#1ed760' : '#b3b3b3',
                        border: 'none', borderRadius: 6,
                        whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis',
                      }}
                    >
                      {d.label || `마이크 ${micDevices.indexOf(d) + 1}`}
                    </button>
                  ))}
                </div>
              )}
            </div>
          )}

          {/* VU 미터 + 게인 컨트롤 (하단 바) */}
          <div style={{
            padding: '8px 18px', borderTop: '1px solid #2a2a2a',
            background: '#181818', display: 'flex', alignItems: 'center', gap: 10,
          }}>
            {/* 마이크 아이콘 */}
            <svg width="15" height="15" viewBox="0 0 24 24" fill="none"
              stroke={isPaused ? '#4d4d4d' : '#1ed760'} strokeWidth="2.5" strokeLinecap="round">
              <path d="M12 2a3 3 0 0 0-3 3v7a3 3 0 0 0 6 0V5a3 3 0 0 0-3-3z"/>
              <path d="M19 10v2a7 7 0 0 1-14 0v-2M12 19v3"/>
            </svg>

            {/* 미니 VU 미터 */}
            <div style={{ flex: 1, height: 28, display: 'flex', alignItems: 'center', gap: 2 }}>
              {volumeBars.filter((_, i) => i % 2 === 0).map((h, i) => {
                const ratio = h / 26
                const color = isPaused ? '#2a2a2a'
                  : ratio > 0.85 ? '#f3727f'
                  : ratio > 0.65 ? '#ffa42b'
                  : ratio > 0.28 ? '#1ed760'
                  : '#3d8fd4'
                return (
                  <div
                    key={i}
                    style={{
                      width: 2, borderRadius: 1,
                      height: `${h}px`,
                      background: color,
                      opacity: isPaused ? 0.3 : Math.max(0.4, ratio),
                      transition: isPaused ? 'none' : 'height 55ms ease-out',
                    }}
                  />
                )
              })}
            </div>

            {/* 게인(감도) 조절 버튼 */}
            <button
              onClick={cycleGain}
              title="클릭하여 마이크 감도 변경"
              style={{
                display: 'flex', alignItems: 'center', gap: 4,
                background: gainLevel > 1.5 ? '#1a3a1a' : '#1f1f1f',
                border: `1px solid ${gainLevel > 1.5 ? '#1ed760' : '#2a2a2a'}`,
                borderRadius: 6, padding: '3px 8px', cursor: 'pointer',
                color: gainLevel > 1.5 ? '#1ed760' : '#b3b3b3',
                fontSize: 11, fontWeight: 700, whiteSpace: 'nowrap',
              }}
            >
              <svg width="11" height="11" viewBox="0 0 24 24" fill="none"
                stroke="currentColor" strokeWidth="2.5" strokeLinecap="round">
                <line x1="12" y1="20" x2="12" y2="10"/>
                <line x1="18" y1="20" x2="18" y2="4"/>
                <line x1="6" y1="20" x2="6" y2="16"/>
              </svg>
              {GAIN_LABELS[gainLevel] ?? `${gainLevel}x`}
            </button>

            <span style={{ fontSize: 10, fontWeight: 700, color: '#4d4d4d', textTransform: 'uppercase', letterSpacing: '1.2px', whiteSpace: 'nowrap' }}>
              {isPaused ? '일시정지' : '입력 중'}
            </span>
          </div>
        </div>

        {/* Right: AI Panel */}
        <div style={{ display: 'flex', flexDirection: 'column', background: '#181818', minHeight: 0, overflow: 'hidden' }}>
          <div style={{ display: 'flex', borderBottom: '1px solid #2a2a2a' }}>
            {(['summary', 'speakers', 'actions'] as const).map((tab, i) => (
              <button
                key={tab}
                onClick={() => setActiveTab(tab)}
                style={{
                  flex: 1, padding: '12px 0', textAlign: 'center',
                  fontSize: 12, fontWeight: 700,
                  color: activeTab === tab ? '#fff' : '#b3b3b3',
                  background: 'transparent', border: 'none', cursor: 'pointer',
                  borderBottom: `2px solid ${activeTab === tab ? '#1ed760' : 'transparent'}`,
                  textTransform: 'uppercase', letterSpacing: '1.4px',
                }}
              >{['요약', '발언자', '액션'][i]}</button>
            ))}
          </div>

          <div style={{ flex: 1, overflowY: 'auto', padding: 14 }}>
            {activeTab === 'summary' && (
              <>
                {[
                  {
                    label: recordingMode === 'realtime' ? 'Deepgram 대사' : 'AI 전사',
                    dot: true,
                    text: recordingMode === 'realtime'
                      ? `실시간 발화 ${utterances.filter((u) => u.isFinal).length}개가 회의록 입력으로 저장됩니다.`
                      : '녹음 종료 후 Gemini가 전체 내용을 전사하고 회의록을 작성합니다.',
                  },
                  { label: '발언 통계', dot: false, text: `경과 시간: ${formatTime(elapsedSeconds)}` },
                ].map((card) => (
                  <div key={card.label} style={{ background: '#1f1f1f', borderRadius: 6, padding: 12, marginBottom: 10 }}>
                    <div style={{ fontSize: 10, fontWeight: 700, color: '#b3b3b3', textTransform: 'uppercase', letterSpacing: '2px', marginBottom: 7, display: 'flex', alignItems: 'center', gap: 5 }}>
                      {card.dot && <div style={{ width: 5, height: 5, borderRadius: '50%', background: '#f3727f', animation: 'pulse 1.2s ease-in-out infinite' }} />}
                      {card.label}
                    </div>
                    <div style={{ fontSize: 12, color: '#cbcbcb', lineHeight: 1.6 }}>{card.text}</div>
                  </div>
                ))}
              </>
            )}

            {activeTab === 'speakers' && (
              Object.entries(speakerStats).length === 0 ? (
                <div style={{ fontSize: 12, color: '#b3b3b3', lineHeight: 1.6 }}>녹음 종료 후 발언자별 통계가 표시됩니다.</div>
              ) : (
                Object.entries(speakerStats).map(([speaker, words]) => {
                  const idx = getSpeakerIdx(speaker)
                  const pct = Math.round((words / totalWords) * 100)
                  const currentName = speakerMap[speaker] || speaker
                  return (
                    <SpeakerRow
                      key={speaker}
                      currentName={currentName}
                      words={words}
                      pct={pct}
                      idx={idx}
                      onRename={(name) => setSpeakerName(speaker, name)}
                    />
                  )
                })
              )
            )}

            {activeTab === 'actions' && (
              <div style={{ fontSize: 12, color: '#b3b3b3', lineHeight: 1.6 }}>
                <div style={{ fontSize: 10, fontWeight: 700, color: '#b3b3b3', textTransform: 'uppercase', letterSpacing: '2px', marginBottom: 10, display: 'flex', alignItems: 'center', gap: 5 }}>
                  <div style={{ width: 5, height: 5, borderRadius: '50%', background: '#f3727f', animation: 'pulse 1.2s ease-in-out infinite' }} />
                  AI 분석 대기
                </div>
                회의 종료 후 AI가 액션 아이템을 정리해드려요.
              </div>
            )}
          </div>
        </div>
      </div>
      </div>

      <style>{`
        @keyframes pulse { 0%,100%{opacity:1} 50%{opacity:.3} }
        @keyframes pulseRing { 0%,100%{opacity:.055} 50%{opacity:.02} }
        @keyframes wave { 0%{height:4px} 100%{height:var(--h,18px)} }
        @keyframes blink { 0%,100%{opacity:1} 50%{opacity:0} }
        @keyframes spin { to{transform:rotate(360deg)} }
      `}</style>
    </div>
  )
}

function SpeakerRow({ currentName, words, pct, idx, onRename }: {
  currentName: string; words: number; pct: number; idx: number
  onRename: (name: string) => void
}) {
  const [editing, setEditing] = useState(false)
  const [draft, setDraft] = useState(currentName)

  const commit = () => {
    if (draft.trim()) onRename(draft.trim())
    setEditing(false)
  }

  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '10px 0', borderBottom: '1px solid #2a2a2a' }}>
      <div style={{
        width: 36, height: 36, borderRadius: '50%', flexShrink: 0,
        background: SPEAKER_BG[idx], color: SPEAKER_COLORS[idx],
        display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 13, fontWeight: 700,
      }}>{currentName[0]}</div>
      <div style={{ flex: 1 }}>
        {editing ? (
          <input
            autoFocus
            value={draft}
            onChange={(e) => setDraft(e.target.value)}
            onBlur={commit}
            onKeyDown={(e) => { if (e.key === 'Enter') commit(); if (e.key === 'Escape') setEditing(false) }}
            style={{
              background: '#2a2a2a', border: `1px solid ${SPEAKER_COLORS[idx]}`,
              borderRadius: 4, padding: '3px 8px', fontSize: 13, fontWeight: 700,
              color: '#fff', outline: 'none', width: '100%', fontFamily: 'inherit',
            }}
          />
        ) : (
          <div
            onClick={() => { setDraft(currentName); setEditing(true) }}
            style={{ fontSize: 13, fontWeight: 700, color: '#fff', cursor: 'text', display: 'flex', alignItems: 'center', gap: 5 }}
          >
            {currentName}
            <span style={{ fontSize: 10, color: '#4d4d4d' }}>✎</span>
          </div>
        )}
        <div style={{ fontSize: 11, color: '#b3b3b3', marginTop: 2 }}>{pct}% · {words} 단어</div>
        <div style={{ height: 3, background: '#2a2a2a', borderRadius: 2, marginTop: 5 }}>
          <div style={{ height: 3, borderRadius: 2, width: `${pct}%`, background: SPEAKER_COLORS[idx] }} />
        </div>
      </div>
    </div>
  )
}
