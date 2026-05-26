'use client'
import { useEffect, useRef, useState, useCallback } from 'react'
import { useMeetingStore } from '@/store/meetingStore'
import { useDeepgram } from '@/lib/useDeepgram'
import Topbar from '@/components/ui/Topbar'

const SPEAKER_COLORS = ['#1ed760', '#539df5', '#ffa42b', '#c77dff', '#f3727f']
const SPEAKER_BG = ['#1a3a1a', '#1a2a3a', '#3a2a1a', '#2a1a3a', '#3a1a1a']

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

export default function RecordingScreen() {
  const {
    isPaused, elapsedSeconds, utterances, participants,
    isRecording, setStep, setAnalyzing, setMinutes, title, addToHistory,
    meetingType, addUtterance, setElapsedSeconds, speakerMap, setSpeakerName, setAudioUrl, setAudioMimeType,
    setCurrentMeetingId, setAnalysisError,
  } = useMeetingStore()
  const { startRecording, pauseRecording, resumeRecording, stopRecording, getAudioBlob, getAudioMimeType } = useDeepgram()
  const [activeTab, setActiveTab] = useState<'summary' | 'speakers' | 'actions'>('summary')
  const transcriptRef = useRef<HTMLDivElement>(null)

  // Online meeting file upload state
  const [uploadFile, setUploadFile] = useState<File | null>(null)
  const [isTranscribing, setIsTranscribing] = useState(false)
  const [uploadDone, setUploadDone] = useState(false)
  const fileInputRef = useRef<HTMLInputElement>(null)

  useEffect(() => {
    if (meetingType === 'face') {
      startRecording()
      return () => stopRecording()
    }
  }, [meetingType])

  useEffect(() => {
    if (transcriptRef.current) {
      transcriptRef.current.scrollTop = transcriptRef.current.scrollHeight
    }
  }, [utterances])

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
    if (meetingType === 'face') {
      stopRecording()
      const blob = getAudioBlob()
      if (blob) {
        setAudioUrl(URL.createObjectURL(blob))
        setAudioMimeType(getAudioMimeType())
      }
    }
    setStep('review')
    setAnalyzing(true)
    setAnalysisError(null)

    // Build transcript string
    const transcript = utterances
      .filter((u) => u.isFinal)
      .map((u) => `${u.speakerName}: ${u.text}`)
      .join('\n')

    const meetingId = Date.now().toString()
    const finalUtterances = utterances.filter((u) => u.isFinal)

    try {
      const res = await fetch('/api/analyze', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          transcript: transcript || '(트랜스크립트 없음)',
          participants: participants.map((p) => p.name),
          title,
        }),
      })
      if (!res.ok) {
        const text = await res.text()
        throw new Error(`분석 API 오류 (${res.status}): ${text}`)
      }
      const data = await res.json()
      if (data.minutes) {
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

      // AI 분석 실패해도 트랜스크립트·참여자 정보를 보존
      const fallbackMinutes = {
        detail: transcript || '(트랜스크립트 없음)',
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
        utterances: finalUtterances,
        slackSent: false,
        archived: false,
      }).catch((saveErr) => console.error('Fallback save error:', saveErr))
    } finally {
      setAnalyzing(false)
    }
  }

  // Speaker stats
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
      <div style={{ width: '100%', maxWidth: 960, display: 'grid', gridTemplateColumns: '1fr 280px', overflow: 'hidden', minHeight: 0 }}>
        {/* Left: Transcript */}
        <div style={{ display: 'flex', flexDirection: 'column', borderRight: '1px solid #2a2a2a', minHeight: 0, overflow: 'hidden' }}>
          <div style={{
            padding: '12px 18px', borderBottom: '1px solid #2a2a2a',
            background: '#181818', display: 'flex', alignItems: 'center', justifyContent: 'space-between',
          }}>
            <span style={{ fontSize: 13, fontWeight: 700, textTransform: 'uppercase', letterSpacing: '1.4px' }}>실시간 자막</span>
            <div style={{ display: 'flex', gap: 6 }}>
              {participants.slice(0, 4).map((p, i) => (
                <div key={p.id} style={{
                  display: 'flex', alignItems: 'center', gap: 4, fontSize: 11, fontWeight: 700,
                  padding: '3px 10px', borderRadius: 9999,
                  background: SPEAKER_BG[i % SPEAKER_BG.length],
                  color: SPEAKER_COLORS[i % SPEAKER_COLORS.length],
                }}>
                  <div style={{ width: 5, height: 5, borderRadius: '50%', background: SPEAKER_COLORS[i % SPEAKER_COLORS.length] }} />
                  {p.name}
                </div>
              ))}
            </div>
          </div>

          <div ref={transcriptRef} style={{ flex: 1, overflowY: 'auto', padding: '16px 18px', display: 'flex', flexDirection: 'column', gap: 14 }}>
            {utterances.length === 0 && (
              <div style={{ color: '#4d4d4d', fontSize: 14, textAlign: 'center', marginTop: 40 }}>
                마이크 입력을 기다리는 중...
              </div>
            )}
            {utterances.map((u) => {
              const idx = getSpeakerIdx(u.speaker)
              return (
                <div key={u.id} style={{ display: 'flex', flexDirection: 'column', gap: 5 }}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                    <div style={{
                      width: 26, height: 26, borderRadius: '50%', flexShrink: 0,
                      background: SPEAKER_BG[idx], color: SPEAKER_COLORS[idx],
                      display: 'flex', alignItems: 'center', justifyContent: 'center',
                      fontSize: 10, fontWeight: 700,
                    }}>{u.speakerName[0]}</div>
                    <span style={{ fontSize: 12, fontWeight: 700, color: '#b3b3b3' }}>{u.speakerName}</span>
                    <span style={{ fontSize: 10, color: '#4d4d4d', marginLeft: 'auto' }}>{u.timestamp}</span>
                  </div>
                  <div style={{
                    marginLeft: 34, fontSize: 13, color: u.isFinal ? '#cbcbcb' : '#888',
                    lineHeight: 1.6, background: '#181818',
                    borderRadius: '0 6px 6px 6px',
                    padding: '10px 14px',
                    borderLeft: !u.isFinal ? '2px solid #1ed760' : 'none',
                  }}>
                    {u.text}
                    {!u.isFinal && <span style={{
                      display: 'inline-block', width: 2, height: 12,
                      background: '#1ed760', borderRadius: 1,
                      verticalAlign: 'middle', marginLeft: 2,
                      animation: 'blink .65s step-end infinite',
                    }} />}
                  </div>
                </div>
              )
            })}
          </div>

          {/* Waveform */}
          <div style={{
            padding: '10px 18px', borderTop: '1px solid #2a2a2a',
            background: '#181818', display: 'flex', alignItems: 'center', gap: 12,
          }}>
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="#1ed760" strokeWidth="2.5" strokeLinecap="round">
              <path d="M12 2a3 3 0 0 0-3 3v7a3 3 0 0 0 6 0V5a3 3 0 0 0-3-3z"/>
              <path d="M19 10v2a7 7 0 0 1-14 0v-2M12 19v3"/>
            </svg>
            <div style={{ flex: 1, height: 28, display: 'flex', alignItems: 'center', gap: 2 }}>
              {Array.from({ length: 20 }, (_, i) => (
                <div key={i} style={{
                  width: 3, borderRadius: 2,
                  background: isPaused ? '#4d4d4d' : '#1ed760',
                  opacity: isPaused ? .4 : .8,
                  height: `${8 + Math.sin(i * 0.8) * 8 + 4}px`,
                  animation: isPaused ? 'none' : `wave ${(0.4 + i * 0.05).toFixed(2)}s ease-in-out infinite alternate`,
                }} />
              ))}
            </div>
            <span style={{ fontSize: 11, fontWeight: 700, color: '#b3b3b3', textTransform: 'uppercase', letterSpacing: '1.4px' }}>
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
                  { label: '실시간 분석', dot: true, text: utterances.length > 0 ? '회의 내용을 분석하고 있어요...' : '발언이 감지되면 실시간으로 요약해드려요.' },
                  { label: '발언 통계', dot: false, text: `총 ${utterances.filter(u => u.isFinal).length}개 문장 · ${totalWords} 단어` },
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
                <div style={{ fontSize: 12, color: '#b3b3b3', lineHeight: 1.6 }}>발언이 감지되면 발언자별 통계가 표시돼요.</div>
              ) : (
                Object.entries(speakerStats).map(([speaker, words]) => {
                  const idx = getSpeakerIdx(speaker)
                  const pct = Math.round((words / totalWords) * 100)
                  const currentName = speakerMap[speaker] || speaker
                  return (
                    <SpeakerRow
                      key={speaker}
                      speaker={speaker}
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
                  실시간 감지
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
        @keyframes wave { 0%{height:4px} 100%{height:var(--h,18px)} }
        @keyframes blink { 0%,100%{opacity:1} 50%{opacity:0} }
        @keyframes spin { to{transform:rotate(360deg)} }
      `}</style>
    </div>
  )
}

function SpeakerRow({ speaker, currentName, words, pct, idx, onRename }: {
  speaker: string; currentName: string; words: number; pct: number; idx: number
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
