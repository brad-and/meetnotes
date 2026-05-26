'use client'
import { useState, useEffect, useRef, useCallback } from 'react'
import { useMeetingStore, ActionItem } from '@/store/meetingStore'
import Topbar from '@/components/ui/Topbar'
import { buildTxtContent, downloadTxt } from '@/lib/exportTxt'
import { mimeTypeToExt } from '@/lib/useDeepgram'

type CopyStatus = 'idle' | 'copied'

// 배열 또는 문자열을 항상 string으로 변환
function toStr(v: unknown): string {
  if (typeof v === 'string') return v
  if (Array.isArray(v)) return v.join('\n')
  return String(v ?? '')
}

// Slack 붙여넣기용 텍스트 포맷 생성
function buildSlackText(title: string, date: string, duration: string, participantNames: string, m: import('@/store/meetingStore').MeetingMinutes): string {
  const lines: string[] = []

  // 헤더
  lines.push(`📋 *[회의록] ${title}*`)
  lines.push(`📅 ${date}  ⏱ ${duration}  👥 ${participantNames}`)
  lines.push('')

  // 전체 내용 요약 (detail)
  const detail = toStr(m.detail)
  if (detail.trim()) {
    lines.push('*회의 내용 요약*')
    detail.split('\n').filter(Boolean).forEach((l) => lines.push(l))
    lines.push('')
  }

  // 결정사항 (core)
  const core = toStr(m.core)
  if (core.trim()) {
    lines.push('*결정사항*')
    core.split('\n').filter(Boolean).forEach((l) => lines.push(`• ${l.replace(/^\d+\.\s*/, '')}`))
    lines.push('')
  }

  // 키워드
  if (m.keywords?.length > 0) {
    lines.push(`*키워드*  ${m.keywords.map(k => `\`${k}\``).join('  ')}`)
    lines.push('')
  }

  // 액션 아이템
  if (m.actions?.length > 0) {
    lines.push('*액션 아이템*')
    m.actions.forEach((a) => {
      const due = a.due ? ` · ${a.due}` : ''
      lines.push(`☐ ${a.text}  _${a.assignee}${due}_`)
    })
    lines.push('')
  }

  // 다음 스텝
  if (m.nextSteps?.length > 0) {
    lines.push('*다음 스텝 (AI 제안)*')
    m.nextSteps.forEach((s, i) => lines.push(`${i + 1}. ${s.title}`))
    lines.push('')
  }

  lines.push('_MeetNotes AI로 자동 작성됨_')
  return lines.join('\n')
}

const BADGE_STYLES: Record<string, { bg: string; color: string }> = {
  detail:  { bg: '#1a2a3a', color: '#539df5' },
  core:    { bg: '#1a3a1a', color: '#1ed760' },
  keywords:{ bg: '#1a3a2a', color: '#52d68a' },
  actions: { bg: '#3a2a1a', color: '#ffa42b' },
  next:    { bg: '#3a1a1a', color: '#f3727f' },
}

export default function ReviewScreen() {
  const {
    minutes, setMinutes, isAnalyzing, title, setTitle,
    utterances, elapsedSeconds, participants, audioUrl, audioMimeType,
    currentMeetingId, markSlackSent, resetMeeting, setStep,
  } = useMeetingStore()
  const [localMinutes, setLocalMinutes] = useState(minutes)
  const [showTranscript, setShowTranscript] = useState(false)
  const [showExportMenu, setShowExportMenu] = useState(false)
  const [copyStatus, setCopyStatus] = useState<CopyStatus>('idle')
  const [saveStatus, setSaveStatus] = useState<'idle' | 'saving' | 'done'>('idle')
  const detailRef = useRef<HTMLTextAreaElement>(null)

  // detail textarea 높이 자동 조절
  const autoResizeDetail = useCallback(() => {
    const el = detailRef.current
    if (!el) return
    el.style.height = 'auto'
    el.style.height = `${el.scrollHeight}px`
  }, [])

  useEffect(() => { autoResizeDetail() }, [localMinutes?.detail, autoResizeDetail])

  const handleCopySlack = async () => {
    if (!localMinutes) return
    const date = new Date().toLocaleDateString('ko-KR')
    const duration = elapsedSeconds >= 60
      ? `${Math.floor(elapsedSeconds / 60)}분 ${elapsedSeconds % 60}초`
      : `${elapsedSeconds}초`
    const participantNames = participants.map((p) => p.name).join(', ')
    const text = buildSlackText(title, date, duration, participantNames, localMinutes)
    try {
      await navigator.clipboard.writeText(text)
      setCopyStatus('copied')
      if (currentMeetingId) markSlackSent(currentMeetingId)
      setTimeout(() => setCopyStatus('idle'), 2500)
    } catch {
      // fallback: textarea 방식
      const el = document.createElement('textarea')
      el.value = text
      document.body.appendChild(el)
      el.select()
      document.execCommand('copy')
      document.body.removeChild(el)
      setCopyStatus('copied')
      setTimeout(() => setCopyStatus('idle'), 2500)
    }
  }

  // DB에 최신 내용 저장
  const saveToDb = async () => {
    if (currentMeetingId && localMinutes) {
      await fetch(`/api/meetings/${currentMeetingId}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ minutes: localMinutes, title }),
      })
    }
  }

  // Slack 전송 스텝으로 이동 (저장 후)
  const handleGoToSlack = async () => {
    setSaveStatus('saving')
    try {
      await saveToDb()
      setSaveStatus('idle')
      setStep('slack')
    } catch {
      setSaveStatus('idle')
      setStep('slack')
    }
  }

  // 저장 후 홈으로 (Slack 없이 완료)
  const handleSaveAndFinish = async () => {
    setSaveStatus('saving')
    try {
      await saveToDb()
      setSaveStatus('done')
      setTimeout(() => resetMeeting(), 800)
    } catch {
      setSaveStatus('idle')
      resetMeeting()
    }
  }

  const handleExportTxt = () => {
    if (!localMinutes) return
    const content = buildTxtContent(
      title,
      new Date().toLocaleDateString('ko-KR'),
      elapsedSeconds,
      participants.map((p) => p.name),
      localMinutes,
      utterances
    )
    const safeName = title.replace(/[^가-힣a-zA-Z0-9]/g, '_').slice(0, 40)
    downloadTxt(`회의록_${safeName || '미제목'}.txt`, content)
  }

  useEffect(() => {
    if (!minutes) { setLocalMinutes(null); return }
    // store에 저장된 값도 배열일 수 있으므로 정규화
    const toStr = (v: unknown): string => {
      if (typeof v === 'string') return v
      if (Array.isArray(v)) return (v as string[]).join('\n')
      return String(v ?? '')
    }
    setLocalMinutes({ ...minutes, detail: toStr(minutes.detail), core: toStr(minutes.core) })
  }, [minutes])

  const updateMinutes = (updates: Partial<typeof minutes>) => {
    if (!localMinutes) return
    const updated = { ...localMinutes, ...updates }
    setLocalMinutes(updated)
    setMinutes(updated)
  }

  const updateAction = (id: string, updates: Partial<ActionItem>) => {
    if (!localMinutes) return
    const actions = localMinutes.actions.map((a) => a.id === id ? { ...a, ...updates } : a)
    updateMinutes({ actions })
  }

  const removeAction = (id: string) => {
    if (!localMinutes) return
    updateMinutes({ actions: localMinutes.actions.filter((a) => a.id !== id) })
  }

  const addAction = () => {
    if (!localMinutes) return
    const newAction: ActionItem = { id: Date.now().toString(), text: '', assignee: '담당자', due: '기한', priority: 'medium' }
    updateMinutes({ actions: [...localMinutes.actions, newAction] })
  }

  const removeKeyword = (kw: string) => {
    if (!localMinutes) return
    updateMinutes({ keywords: localMinutes.keywords.filter((k) => k !== kw) })
  }

  if (isAnalyzing) return (
    <div style={{ minHeight: '100vh', background: '#121212' }}>
      <Topbar />
      <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', height: 'calc(100vh - 96px)', gap: 20 }}>
        <div style={{ width: 56, height: 56, borderRadius: '50%', background: '#1a3a1a', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
          <div style={{ width: 24, height: 24, border: '3px solid #1a3a1a', borderTop: '3px solid #1ed760', borderRadius: '50%', animation: 'spin .8s linear infinite' }} />
        </div>
        <div style={{ fontSize: 18, fontWeight: 700, color: '#fff' }}>AI 분석 중...</div>
        <div style={{ fontSize: 14, color: '#b3b3b3' }}>회의 내용을 분석하고 회의록을 작성하고 있어요</div>
        <style>{`@keyframes spin{to{transform:rotate(360deg)}}`}</style>
      </div>
    </div>
  )

  if (!localMinutes) return (
    <div style={{ minHeight: '100vh', background: '#121212' }}>
      <Topbar />
      <div style={{ textAlign: 'center', padding: 60, color: '#b3b3b3' }}>회의록 데이터가 없어요.</div>
    </div>
  )

  const slackPreview = buildSlackText(
    title,
    new Date().toLocaleDateString('ko-KR'),
    elapsedSeconds >= 60 ? `${Math.floor(elapsedSeconds / 60)}분` : `${elapsedSeconds}초`,
    participants.map((p) => p.name).join(', '),
    localMinutes
  ).split('\n').slice(0, 10).join('\n') + '\n...'

  return (
    <>
    <div style={{ minHeight: '100vh', background: '#121212' }}>
      <Topbar>
        <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
          <div style={{ display: 'flex', gap: 14 }}>
            {['clock', 'users', 'calendar'].map((icon, i) => (
              <span key={icon} style={{ display: 'flex', alignItems: 'center', gap: 5, fontSize: 12, color: '#b3b3b3' }}>
                {['⏱', '👥', '📅'][i]} {['24분', '3명', '오늘'][i]}
              </span>
            ))}
          </div>
        </div>
        <div style={{ display: 'flex', gap: 8 }}>
          <button className="btn-pill" onClick={() => setShowTranscript(true)}>원본 보기</button>

          {/* 내보내기 드롭다운 */}
          <div style={{ position: 'relative' }}>
            <button className="btn-pill" onClick={() => setShowExportMenu((v) => !v)}>↓ 내보내기</button>
            {showExportMenu && (
              <>
                <div onClick={() => setShowExportMenu(false)} style={{ position: 'fixed', inset: 0, zIndex: 99 }} />
                <div style={{
                  position: 'absolute', top: 'calc(100% + 6px)', right: 0,
                  background: '#1f1f1f', border: '1px solid #4d4d4d',
                  borderRadius: 8, overflow: 'hidden', zIndex: 100,
                  minWidth: 140, boxShadow: 'rgba(0,0,0,0.4) 0px 8px 16px',
                }}>
                  <button
                    onClick={() => { handleExportTxt(); setShowExportMenu(false) }}
                    style={{ display: 'flex', alignItems: 'center', gap: 8, width: '100%', padding: '10px 14px', background: 'none', border: 'none', fontSize: 13, fontWeight: 700, color: '#fff', cursor: 'pointer', textAlign: 'left' }}
                    onMouseEnter={(e) => (e.currentTarget.style.background = '#2a2a2a')}
                    onMouseLeave={(e) => (e.currentTarget.style.background = 'none')}
                  >📄 TXT 파일</button>
                  {audioUrl && (
                    <a
                      href={audioUrl}
                      download={`녹음_${title.replace(/[^가-힣a-zA-Z0-9]/g, '_').slice(0, 30) || '미제목'}.${mimeTypeToExt(audioMimeType)}`}
                      onClick={() => setShowExportMenu(false)}
                      style={{ display: 'flex', alignItems: 'center', gap: 8, width: '100%', padding: '10px 14px', background: 'none', fontSize: 13, fontWeight: 700, color: '#fff', cursor: 'pointer', textDecoration: 'none' }}
                      onMouseEnter={(e) => (e.currentTarget.style.background = '#2a2a2a')}
                      onMouseLeave={(e) => (e.currentTarget.style.background = 'none')}
                    >🎵 음성 파일</a>
                  )}
                </div>
              </>
            )}
          </div>

          {/* Slack 전송 스텝으로 */}
          <button
            className="btn-green"
            onClick={handleGoToSlack}
            disabled={saveStatus === 'saving'}
            style={{ display: 'flex', alignItems: 'center', gap: 6 }}
          >
            {saveStatus === 'saving' && (
              <div style={{ width: 12, height: 12, border: '2px solid rgba(0,0,0,0.3)', borderTop: '2px solid #000', borderRadius: '50%', animation: 'spin .6s linear infinite' }} />
            )}
            💬 Slack 전송 →
          </button>

          {/* Slack 없이 완료 */}
          <button
            className="btn-pill"
            onClick={handleSaveAndFinish}
            disabled={saveStatus !== 'idle'}
            style={{ display: 'flex', alignItems: 'center', gap: 6 }}
          >
            {saveStatus === 'done' ? '✓ 완료!' : saveStatus === 'saving' ? '저장 중...' : '완료'}
          </button>
        </div>
      </Topbar>

      <div style={{ maxWidth: 960, margin: '0 auto', display: 'grid', gridTemplateColumns: '1fr 252px', minHeight: 'calc(100vh - 96px)' }}>
        {/* Main editor */}
        <div style={{ overflowY: 'auto', padding: 24, borderRight: '1px solid #2a2a2a' }}>
          {/* AI Banner */}
          <div style={{
            display: 'flex', alignItems: 'center', gap: 10,
            background: '#1a3a1a', borderRadius: 6, padding: '10px 14px', marginBottom: 20,
          }}>
            <span style={{ fontSize: 16 }}>✨</span>
            <div style={{ flex: 1 }}>
              <div style={{ fontSize: 13, fontWeight: 700, color: '#1ed760' }}>AI 분석 완료 — 내용을 확인하고 수정해주세요.</div>
              <div style={{ fontSize: 11, color: '#52d68a', marginTop: 1 }}>모든 섹션을 클릭해서 바로 편집할 수 있어요.</div>
            </div>
          </div>

          {/* Title */}
          <input
            style={{ width: '100%', background: 'transparent', border: 'none', borderBottom: '1px solid #2a2a2a', padding: '4px 0', fontSize: 20, fontWeight: 700, color: '#fff', outline: 'none', marginBottom: 16, fontFamily: 'inherit' }}
            value={title}
            onChange={(e) => setTitle(e.target.value)}
          />

          {/* Section: Detail */}
          <Section badge="자세한 내용" badgeStyle={BADGE_STYLES.detail} title="전체 회의 내용">
            <textarea
              ref={detailRef}
              style={{
                width: '100%', background: 'transparent', border: 'none',
                fontSize: 13, color: '#cbcbcb', lineHeight: 1.9,
                resize: 'none', outline: 'none', fontFamily: 'inherit',
                minHeight: 180, overflow: 'hidden',
              }}
              value={localMinutes.detail}
              onChange={(e) => { updateMinutes({ detail: e.target.value }); autoResizeDetail() }}
            />
          </Section>

          {/* Section: Core */}
          <Section badge="핵심 내용" badgeStyle={BADGE_STYLES.core} title="결정사항 요약">
            <textarea
              style={{ width: '100%', background: 'transparent', border: 'none', fontSize: 13, color: '#cbcbcb', lineHeight: 1.7, resize: 'none', outline: 'none', fontFamily: 'inherit' }}
              rows={3}
              value={localMinutes.core}
              onChange={(e) => updateMinutes({ core: e.target.value })}
            />
          </Section>

          {/* Section: Keywords */}
          <Section badge="키워드" badgeStyle={BADGE_STYLES.keywords} title="주요 키워드">
            <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6 }}>
              {localMinutes.keywords.map((kw) => (
                <span key={kw} style={{
                  fontSize: 11, fontWeight: 700, background: '#1f1f1f', border: '1px solid #4d4d4d',
                  color: '#b3b3b3', padding: '4px 10px', borderRadius: 9999,
                  display: 'flex', alignItems: 'center', gap: 4, cursor: 'pointer',
                }}>
                  {kw}
                  <span onClick={() => removeKeyword(kw)} style={{ opacity: .6, fontSize: 10 }}>✕</span>
                </span>
              ))}
            </div>
          </Section>

          {/* Section: Actions */}
          <Section badge="액션 아이템" badgeStyle={BADGE_STYLES.actions} title="할 일 목록">
            <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
              {localMinutes.actions.map((a) => (
                <div key={a.id} style={{
                  display: 'flex', alignItems: 'flex-start', gap: 10,
                  padding: '10px 12px', background: '#1f1f1f', borderRadius: 6,
                  border: '1px solid #2a2a2a',
                }}>
                  <div style={{ width: 16, height: 16, borderRadius: 3, border: '1px solid #4d4d4d', flexShrink: 0, marginTop: 1, background: '#181818' }} />
                  <div style={{ flex: 1 }}>
                    <input
                      style={{ width: '100%', background: 'transparent', border: 'none', fontSize: 13, color: '#fff', outline: 'none', fontFamily: 'inherit' }}
                      value={a.text}
                      onChange={(e) => updateAction(a.id, { text: e.target.value })}
                    />
                    <div style={{ display: 'flex', gap: 4, marginTop: 4, flexWrap: 'wrap' }}>
                      <span style={{ fontSize: 10, fontWeight: 700, padding: '2px 7px', borderRadius: 9999, background: '#1a3a1a', color: '#1ed760' }}>{a.assignee}</span>
                      <span style={{ fontSize: 10, fontWeight: 700, padding: '2px 7px', borderRadius: 9999, background: '#3a2a1a', color: '#ffa42b' }}>{a.due}</span>
                      <span style={{ fontSize: 10, fontWeight: 700, padding: '2px 7px', borderRadius: 9999, background: a.priority === 'high' ? '#3a1a1a' : a.priority === 'medium' ? '#1a2a3a' : '#2a2a2a', color: a.priority === 'high' ? '#f3727f' : a.priority === 'medium' ? '#539df5' : '#b3b3b3' }}>
                        {a.priority === 'high' ? '높음' : a.priority === 'medium' ? '중간' : '낮음'}
                      </span>
                    </div>
                  </div>
                  <span onClick={() => removeAction(a.id)} style={{ fontSize: 14, color: '#4d4d4d', cursor: 'pointer' }}>✕</span>
                </div>
              ))}
            </div>
            <button onClick={addAction} style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 12, fontWeight: 700, color: '#1ed760', background: 'none', border: 'none', cursor: 'pointer', textTransform: 'uppercase', letterSpacing: '1.4px', padding: '8px 0' }}>
              + 액션 추가
            </button>
          </Section>

          {/* Section: Next Steps */}
          <Section badge="다음 스텝" badgeStyle={BADGE_STYLES.next} title="AI 추천 후속 액션">
            <div style={{ display: 'flex', flexDirection: 'column' }}>
              {localMinutes.nextSteps.map((ns, i) => (
                <div key={i} style={{ display: 'flex', gap: 10, padding: '10px 0', borderBottom: i < localMinutes.nextSteps.length - 1 ? '1px solid #2a2a2a' : 'none' }}>
                  <div style={{ width: 22, height: 22, borderRadius: '50%', background: '#1f1f1f', border: '1px solid #1ed760', color: '#1ed760', fontSize: 11, fontWeight: 700, display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0, marginTop: 1 }}>{i + 1}</div>
                  <div>
                    <div style={{ fontSize: 13, fontWeight: 700, color: '#fff', marginBottom: 3 }}>{ns.title}</div>
                    <div style={{ fontSize: 11, color: '#b3b3b3', lineHeight: 1.5 }}>{ns.reason}</div>
                  </div>
                </div>
              ))}
            </div>
          </Section>
        </div>

        {/* Sidebar */}
        <div style={{ background: '#181818', display: 'flex', flexDirection: 'column' }}>
          <div style={{ padding: 16, borderBottom: '1px solid #2a2a2a' }}>
            <span className="sp-label">Slack 복사 미리보기</span>
            <div style={{ background: '#121212', borderRadius: 6, padding: 12, fontSize: 11, color: '#b3b3b3', lineHeight: 1.8, fontFamily: 'monospace', whiteSpace: 'pre-wrap' }}>
              {slackPreview}
            </div>
            <button
              className="btn-green"
              onClick={handleCopySlack}
              disabled={copyStatus === 'copied'}
              style={{ width: '100%', justifyContent: 'center', marginTop: 10 }}
            >
              {copyStatus === 'copied' ? '✓ 복사됨!' : '💬 Slack 복사'}
            </button>
          </div>
          <div style={{ padding: 16, flex: 1 }}>
            <span className="sp-label">수정 내역</span>
            {[
              { color: '#1ed760', text: 'AI 분석 완료', time: '1분 전' },
              { color: '#539df5', text: '녹음 종료', time: '3분 전' },
              { color: '#4d4d4d', text: '회의 설정 완료', time: '28분 전' },
            ].map((item, i) => (
              <div key={i} style={{ display: 'flex', alignItems: 'flex-start', gap: 8, marginBottom: 10 }}>
                <div style={{ width: 6, height: 6, borderRadius: '50%', background: item.color, marginTop: 4, flexShrink: 0 }} />
                <div>
                  <div style={{ fontSize: 12, color: '#b3b3b3' }}>{item.text}</div>
                  <div style={{ fontSize: 10, color: '#4d4d4d', marginTop: 1 }}>{item.time}</div>
                </div>
              </div>
            ))}
          </div>
        </div>
      </div>
    </div>
    {showTranscript && (
      <TranscriptModal utterances={utterances} onClose={() => setShowTranscript(false)} />
    )}
    </>
  )
}

const SPEAKER_COLORS = ['#1ed760', '#539df5', '#ffa42b', '#c77dff', '#f3727f']
const SPEAKER_BG    = ['#1a3a1a', '#1a2a3a', '#3a2a1a', '#2a1a3a', '#3a1a1a']

function getSpeakerIdx(speaker: string) {
  return parseInt(speaker.replace(/\D/g, '') || '0') % SPEAKER_COLORS.length
}

function TranscriptModal({ utterances, onClose }: {
  utterances: import('@/store/meetingStore').Utterance[]
  onClose: () => void
}) {
  const finals = utterances.filter((u) => u.isFinal)
  return (
    <div
      onClick={onClose}
      style={{
        position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.75)',
        display: 'flex', alignItems: 'center', justifyContent: 'center',
        zIndex: 1000, padding: 24,
      }}
    >
      <div
        onClick={(e) => e.stopPropagation()}
        style={{
          background: '#181818', borderRadius: 12, width: '100%', maxWidth: 640,
          maxHeight: '80vh', display: 'flex', flexDirection: 'column',
          boxShadow: 'rgba(0,0,0,0.5) 0px 8px 24px',
        }}
      >
        {/* Header */}
        <div style={{
          padding: '16px 20px', borderBottom: '1px solid #2a2a2a',
          display: 'flex', alignItems: 'center', justifyContent: 'space-between',
          flexShrink: 0,
        }}>
          <div>
            <div style={{ fontSize: 14, fontWeight: 700, color: '#fff' }}>원본 트랜스크립트</div>
            <div style={{ fontSize: 11, color: '#b3b3b3', marginTop: 2 }}>{finals.length}개 발화</div>
          </div>
          <button
            onClick={onClose}
            style={{ background: 'none', border: 'none', color: '#b3b3b3', fontSize: 20, cursor: 'pointer', padding: '0 4px' }}
          >✕</button>
        </div>

        {/* Body */}
        <div style={{ overflowY: 'auto', padding: '16px 20px', display: 'flex', flexDirection: 'column', gap: 14 }}>
          {finals.length === 0 ? (
            <div style={{ color: '#4d4d4d', fontSize: 13, textAlign: 'center', padding: '40px 0' }}>
              저장된 트랜스크립트가 없어요.
            </div>
          ) : (
            finals.map((u) => {
              const idx = getSpeakerIdx(u.speaker)
              return (
                <div key={u.id} style={{ display: 'flex', flexDirection: 'column', gap: 5 }}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                    <div style={{
                      width: 24, height: 24, borderRadius: '50%', flexShrink: 0,
                      background: SPEAKER_BG[idx], color: SPEAKER_COLORS[idx],
                      display: 'flex', alignItems: 'center', justifyContent: 'center',
                      fontSize: 10, fontWeight: 700,
                    }}>{u.speakerName[0]}</div>
                    <span style={{ fontSize: 12, fontWeight: 700, color: '#b3b3b3' }}>{u.speakerName}</span>
                    <span style={{ fontSize: 10, color: '#4d4d4d', marginLeft: 'auto' }}>{u.timestamp}</span>
                  </div>
                  <div style={{
                    marginLeft: 32, fontSize: 13, color: '#cbcbcb', lineHeight: 1.6,
                    background: '#1f1f1f', borderRadius: '0 6px 6px 6px', padding: '8px 12px',
                  }}>
                    {u.text}
                  </div>
                </div>
              )
            })
          )}
        </div>
      </div>
    </div>
  )
}


function Section({ badge, badgeStyle, title, children }: {
  badge: string; badgeStyle: { bg: string; color: string }; title: string; children: React.ReactNode
}) {
  const [editing, setEditing] = useState(false)
  return (
    <div
      onClick={() => setEditing(true)}
      onBlur={() => setEditing(false)}
      style={{
        background: '#181818', borderRadius: 8, marginBottom: 10,
        border: `1px solid ${editing ? '#1ed760' : 'transparent'}`,
        boxShadow: 'rgba(0,0,0,0.3) 0px 8px 8px', transition: 'border-color .15s', cursor: 'pointer',
      }}
    >
      <div style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '12px 16px', borderBottom: '1px solid #2a2a2a' }}>
        <span style={{ fontSize: 10, fontWeight: 700, padding: '3px 10px', borderRadius: 9999, textTransform: 'uppercase', letterSpacing: '1.4px', background: badgeStyle.bg, color: badgeStyle.color }}>{badge}</span>
        <span style={{ fontSize: 13, fontWeight: 700, color: '#fff' }}>{title}</span>
        <div style={{ marginLeft: 'auto', display: 'flex', gap: 5, opacity: editing ? 1 : 0, transition: 'opacity .15s' }}>
          {['↻', '⎘'].map((icon) => (
            <div key={icon} onClick={(e) => e.stopPropagation()} style={{
              width: 26, height: 26, borderRadius: '50%', background: '#1f1f1f',
              border: '1px solid #4d4d4d', display: 'flex', alignItems: 'center', justifyContent: 'center',
              cursor: 'pointer', fontSize: 13, color: '#b3b3b3',
            }}>{icon}</div>
          ))}
        </div>
      </div>
      <div style={{ padding: '14px 16px' }}>{children}</div>
    </div>
  )
}
