'use client'
import { useState, useEffect } from 'react'
import { useMeetingStore } from '@/store/meetingStore'
import Topbar from '@/components/ui/Topbar'

const toStr = (v: unknown): string => {
  if (typeof v === 'string') return v
  if (Array.isArray(v)) return (v as string[]).join('\n')
  return String(v ?? '')
}

const FORMAT_DESC = {
  full: '자세한 내용, 핵심 결정, 키워드, 액션, 다음 스텝을 모두 포함해요.',
  brief: '핵심 결정사항과 액션 아이템만 간결하게 전달해요.',
  actions: '할 일 목록과 담당자, 기한만 전송해요.',
}

export default function SlackScreen() {
  const {
    title, minutes, slackChannel, setSlackChannel,
    slackFormat, setSlackFormat, slackOptions, toggleSlackOption,
    isSending, setSending, sent, setSent, setStep, elapsedSeconds, participants,
    meetingHistory, markSlackSent,
  } = useMeetingStore()

  const [slackConfigured, setSlackConfigured] = useState<boolean | null>(null)
  const [slackMethod, setSlackMethod] = useState<string | null>(null)
  const [oauthChannels, setOauthChannels] = useState<{ id: string; name: string }[]>([])
  const [webhookChannel, setWebhookChannel] = useState('')
  const [sendError, setSendError] = useState<string | null>(null)

  useEffect(() => {
    fetch('/api/slack/status')
      .then((r) => r.json())
      .then((d) => {
        setSlackConfigured(d.configured)
        setSlackMethod(d.method ?? null)
        if (d.channel) {
          setWebhookChannel(d.channel)
          setSlackChannel(d.channel)
        }
        if (d.configured && d.method === 'oauth') {
          fetch('/api/slack/channels')
            .then(r => r.json())
            .then(c => { if (c.channels) setOauthChannels(c.channels) })
        }
      })
      .catch(() => setSlackConfigured(false))
  }, [])

  const handleSend = async () => {
    if (!minutes || isSending) return
    setSending(true)
    setSendError(null)
    try {
      const res = await fetch('/api/slack', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          minutes,
          title,
          channel: slackChannel,
          format: slackFormat,
          options: slackOptions,
          meta: {
            date: new Date().toLocaleDateString('ko-KR'),
            duration: `${Math.floor(elapsedSeconds / 60)}분`,
            participants: participants.map((p) => p.name).join(', '),
          },
        }),
      })
      const data = await res.json()
      if (!data.ok) throw new Error(data.error ?? '전송 실패')
      setSent(true)
      if (meetingHistory.length > 0) markSlackSent(meetingHistory[0].id)
    } catch (e) {
      console.error(e)
      setSendError(e instanceof Error ? e.message : '전송에 실패했어요.')
    } finally {
      setSending(false)
    }
  }

  if (sent) return <SuccessScreen />

  return (
    <div style={{ minHeight: '100vh', background: '#121212' }}>
      <Topbar>
        <div style={{ display: 'flex', gap: 14 }}>
          {['⏱ 24분', '👥 3명', '📅 오늘'].map((m) => (
            <span key={m} style={{ fontSize: 12, color: '#b3b3b3' }}>{m}</span>
          ))}
        </div>
        <button className="btn-pill" onClick={() => setStep('review')}>← 편집으로</button>
      </Topbar>

      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', minHeight: 'calc(100vh - 96px)' }}>
        {/* Left: Controls */}
        <div style={{ padding: 24, borderRight: '1px solid #2a2a2a', display: 'flex', flexDirection: 'column', gap: 16 }}>

          {/* Channel */}
          <div className="sp-card">
            <span className="sp-label">전송 채널</span>

            {/* Webhook: 채널명 직접 입력 */}
            {slackMethod === 'webhook' && (
              <div style={{ marginBottom: 8 }}>
                <div style={{ fontSize: 11, color: '#b3b3b3', marginBottom: 8, lineHeight: 1.6 }}>
                  Webhook이 연결된 채널로 전송됩니다.<br />
                  아래에서 채널명을 확인·수정할 수 있어요 (표시 전용).
                </div>
                <div style={{
                  display: 'flex', alignItems: 'center', gap: 10,
                  padding: '10px 14px', borderRadius: 9999,
                  background: '#1a3a1a', border: '1px solid #1ed760',
                }}>
                  <span style={{ fontSize: 14, color: '#1ed760' }}>#</span>
                  <input
                    style={{ background: 'none', border: 'none', outline: 'none', flex: 1, fontSize: 13, fontWeight: 700, color: '#1ed760', fontFamily: 'inherit' }}
                    value={slackChannel.startsWith('#') ? slackChannel.slice(1) : slackChannel}
                    onChange={e => setSlackChannel('#' + e.target.value)}
                    placeholder="채널명"
                  />
                  <span style={{ fontSize: 14, color: '#1ed760' }}>✓</span>
                </div>
              </div>
            )}

            {/* OAuth: 채널 목록 선택 */}
            {slackMethod === 'oauth' && (
              <div style={{ display: 'flex', flexDirection: 'column', gap: 5, marginBottom: 12 }}>
                {(oauthChannels.length > 0
                  ? oauthChannels.map(c => c.name)
                  : [slackChannel]
                ).map((ch) => {
                  const chName = ch.startsWith('#') ? ch : `#${ch}`
                  return (
                    <div
                      key={ch}
                      onClick={() => setSlackChannel(chName)}
                      style={{
                        display: 'flex', alignItems: 'center', gap: 10,
                        padding: '8px 12px', borderRadius: 9999, cursor: 'pointer',
                        background: slackChannel === chName ? '#1a3a1a' : 'transparent',
                        border: `1px solid ${slackChannel === chName ? '#1ed760' : 'transparent'}`,
                        transition: 'all .15s',
                      }}
                    >
                      <span style={{ fontSize: 14, color: '#b3b3b3', width: 18, textAlign: 'center' }}>#</span>
                      <span style={{ fontSize: 13, fontWeight: 700, color: slackChannel === chName ? '#1ed760' : '#fff', flex: 1 }}>{chName.slice(1)}</span>
                      {slackChannel === chName && <span style={{ fontSize: 14, color: '#1ed760' }}>✓</span>}
                    </div>
                  )
                })}
              </div>
            )}

            {/* 미연결 */}
            {!slackMethod && (
              <div style={{ fontSize: 11, color: '#b3b3b3', padding: '8px 0' }}>
                설정 화면에서 Webhook URL을 등록해주세요.
              </div>
            )}
          </div>

          {/* Format */}
          <div className="sp-card">
            <span className="sp-label">포맷</span>
            <div style={{ display: 'flex', gap: 6, marginBottom: 12 }}>
              {(['full', 'brief', 'actions'] as const).map((f) => (
                <button
                  key={f}
                  onClick={() => setSlackFormat(f)}
                  style={{
                    padding: '6px 14px', borderRadius: 9999, fontSize: 12, fontWeight: 700,
                    cursor: 'pointer', textTransform: 'uppercase', letterSpacing: '1.4px',
                    border: `1px solid ${slackFormat === f ? '#1ed760' : '#4d4d4d'}`,
                    background: slackFormat === f ? '#1a3a1a' : 'transparent',
                    color: slackFormat === f ? '#1ed760' : '#b3b3b3',
                    transition: 'all .15s',
                  }}
                >{({ full: '전체', brief: '간단', actions: '액션만' })[f]}</button>
              ))}
            </div>
            <p style={{ fontSize: 12, color: '#b3b3b3' }}>{FORMAT_DESC[slackFormat]}</p>
          </div>

          {/* Options */}
          <div className="sp-card">
            <span className="sp-label">전송 옵션</span>
            {[
              { key: 'thread', name: '스레드로 전송', desc: '기존 메시지의 스레드에 달기' },
              { key: 'mention', name: '멘션 알림', desc: '액션 담당자에게 @멘션 보내기' },
              { key: 'transcript', name: '트랜스크립트 첨부', desc: '전체 자막 파일 함께 첨부' },
              { key: 'save', name: '히스토리 저장', desc: 'MeetNotes에 자동 보관' },
            ].map((opt) => (
              <div key={opt.key} style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '9px 0', borderBottom: '1px solid #2a2a2a' }}>
                <div>
                  <div style={{ fontSize: 13, fontWeight: 700, color: '#fff' }}>{opt.name}</div>
                  <div style={{ fontSize: 11, color: '#b3b3b3', marginTop: 2 }}>{opt.desc}</div>
                </div>
                <div
                  className={`sp-toggle ${slackOptions[opt.key as keyof typeof slackOptions] ? 'on' : ''}`}
                  onClick={() => toggleSlackOption(opt.key as keyof typeof slackOptions)}
                  role="switch"
                ><div className="sp-toggle-thumb" /></div>
              </div>
            ))}
          </div>
        </div>

        {/* Right: Preview */}
        <div style={{ padding: 24, display: 'flex', flexDirection: 'column', background: '#121212' }}>
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 14 }}>
            <span style={{ fontSize: 13, fontWeight: 700, textTransform: 'uppercase', letterSpacing: '1.4px' }}>Slack 미리보기</span>
            <span style={{ fontSize: 11, fontWeight: 700, background: '#1f1f1f', color: '#b3b3b3', padding: '3px 10px', borderRadius: 9999 }}>{slackChannel}</span>
          </div>

          {/* Slack dark UI */}
          <div style={{ background: '#1a1d21', borderRadius: 8, overflow: 'hidden', flex: 1, boxShadow: 'rgba(0,0,0,0.5) 0px 8px 24px' }}>
            <div style={{ background: '#1a1d21', padding: '10px 14px', borderBottom: '1px solid #222529', display: 'flex', alignItems: 'center', gap: 8 }}>
              <span style={{ fontSize: 14, color: '#8c8f93' }}>#</span>
              <span style={{ fontSize: 13, fontWeight: 700, color: '#d1d2d3' }}>{slackChannel.startsWith('#') ? slackChannel.slice(1) : slackChannel}</span>
              <span style={{ fontSize: 11, color: '#8c8f93', marginLeft: 4 }}></span>
            </div>
            <div style={{ padding: 16 }}>
              <div style={{ display: 'flex', gap: 10 }}>
                <div style={{ width: 34, height: 34, borderRadius: 6, background: '#1ed760', display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0 }}>
                  🎙
                </div>
                <div>
                  <div style={{ fontSize: 13, fontWeight: 700, color: '#d1d2d3', marginBottom: 3, display: 'flex', alignItems: 'center', gap: 6 }}>
                    MeetNotes
                    <span style={{ fontSize: 10, background: '#1264A3', color: '#fff', padding: '1px 5px', borderRadius: 3, fontWeight: 700 }}>APP</span>
                    <span style={{ fontSize: 11, color: '#8c8f93', fontWeight: 400 }}>방금 전</span>
                  </div>
                  <div style={{ fontSize: 13, color: '#d1d2d3', lineHeight: 1.6 }}>
                    <strong style={{ color: '#fff' }}>📋 [회의록] {title || 'Q3 기능 우선순위 조정'}</strong>
                    <div style={{ color: '#8c8f93', fontSize: 12, marginTop: 4 }}>
                      📅 오늘 · ⏱ {Math.floor(elapsedSeconds / 60)}분 · 👥 {participants.map(p => p.name).join(', ')}
                    </div>
                    {/* 전체 회의 내용 (full 포맷만) */}
                    {slackFormat === 'full' && minutes && toStr(minutes.detail).trim() && (
                      <div style={{ marginTop: 10, padding: '8px 12px', background: '#222529', borderRadius: 4, borderLeft: '3px solid #539df5' }}>
                        <div style={{ fontSize: 12, fontWeight: 700, color: '#d1d2d3', marginBottom: 5 }}>📝 전체 회의 내용</div>
                        {toStr(minutes.detail).split('\n').filter(Boolean).slice(0, 5).map((line, i) => (
                          <div key={i} style={{ fontSize: 12, color: '#8c8f93', lineHeight: 1.6 }}>{line}</div>
                        ))}
                        {toStr(minutes.detail).split('\n').filter(Boolean).length > 5 && (
                          <div style={{ fontSize: 11, color: '#555a61', marginTop: 4 }}>... 더 보기</div>
                        )}
                      </div>
                    )}
                    {/* 결정사항 */}
                    {(slackFormat === 'full' || slackFormat === 'brief') && minutes && toStr(minutes.core).trim() && (
                      <div style={{ marginTop: 8 }}>
                        <strong style={{ color: '#fff' }}>결정사항</strong><br />
                        {toStr(minutes.core).split('\n').filter(Boolean).slice(0, 3).map((line, i) => (
                          <div key={i}>• {line.replace(/^\d+\.\s*/, '')}</div>
                        ))}
                      </div>
                    )}
                    {/* 액션 아이템 */}
                    {minutes && minutes.actions.length > 0 && (
                      <div style={{ marginTop: 8 }}>
                        <strong style={{ color: '#fff' }}>액션 아이템</strong><br />
                        {minutes.actions.slice(0, 3).map((a) => (
                          <div key={a.id}>☐ {a.text} — <span style={{ color: '#539df5' }}>@{a.assignee}</span>{a.due ? ` · ${a.due}` : ''}</div>
                        ))}
                      </div>
                    )}
                    {/* 다음 스텝 */}
                    {slackFormat === 'full' && (minutes?.nextSteps?.length ?? 0) > 0 && (
                      <div style={{ marginTop: 10, borderLeft: '3px solid #1ed760', padding: '8px 12px', background: '#222529', borderRadius: '0 4px 4px 0' }}>
                        <div style={{ fontSize: 12, fontWeight: 700, color: '#d1d2d3', marginBottom: 5 }}>다음 스텝 (AI)</div>
                        {minutes?.nextSteps?.map((s, i) => (
                          <div key={i} style={{ fontSize: 12, color: '#8c8f93' }}>{i + 1}. {s.title}</div>
                        ))}
                      </div>
                    )}
                    <div style={{ display: 'flex', gap: 6, marginTop: 10 }}>
                      {['👍 2', '✅ 1'].map((r) => (
                        <span key={r} style={{ background: '#2a2d31', borderRadius: 4, padding: '3px 8px', fontSize: 11, color: '#d1d2d3', cursor: 'pointer' }}>{r}</span>
                      ))}
                    </div>
                  </div>
                </div>
              </div>
            </div>
          </div>

          <div style={{ marginTop: 16, display: 'flex', flexDirection: 'column', gap: 8 }}>
            {slackConfigured === false && (
              <div style={{
                background: '#2a1f0a', border: '1px solid #ffa42b',
                borderRadius: 8, padding: '10px 14px',
                display: 'flex', alignItems: 'flex-start', gap: 10,
              }}>
                <span style={{ fontSize: 16, flexShrink: 0 }}>⚠️</span>
                <div>
                  <div style={{ fontSize: 12, fontWeight: 700, color: '#ffa42b', marginBottom: 3 }}>Slack 미연결</div>
                  <div style={{ fontSize: 11, color: '#b3b3b3', lineHeight: 1.6 }}>
                    설정 화면(⚙️)에서 Incoming Webhook URL을 등록해주세요.<br />
                    회의록은 히스토리에 저장되어 있으니 나중에 전송할 수 있어요.
                  </div>
                </div>
              </div>
            )}
            {sendError && (
              <div style={{
                background: 'rgba(243,114,127,0.08)', border: '1px solid #f3727f',
                borderRadius: 8, padding: '10px 14px', fontSize: 12, color: '#f3727f',
              }}>
                ⚠️ {sendError}
              </div>
            )}
            <button
              className="btn-green"
              onClick={handleSend}
              disabled={isSending || slackConfigured === false}
              style={{ width: '100%', justifyContent: 'center', opacity: slackConfigured === false ? 0.4 : 1 }}
            >
              {isSending ? '전송 중...' : slackConfigured === false ? 'Slack 미연결' : `${slackChannel || '채널'} 에 전송하기`}
            </button>
            <p style={{ fontSize: 12, color: '#b3b3b3', textAlign: 'center' }}>
              {isSending ? 'Slack에 연결하는 중이에요...' : slackConfigured === false ? '회의록은 히스토리에 자동 저장됐어요' : '전송 전 미리보기를 꼭 확인해주세요'}
            </p>
          </div>
        </div>
      </div>
    </div>
  )
}

function SuccessScreen() {
  const { setStep, slackChannel, resetMeeting } = useMeetingStore()
  return (
    <div style={{ minHeight: '100vh', background: '#121212' }}>
      <Topbar />
      <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', minHeight: 'calc(100vh - 96px)', gap: 16, padding: 24, textAlign: 'center' }}>
        <div style={{ width: 60, height: 60, borderRadius: '50%', background: '#1a3a1a', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 28, animation: 'pop .4s ease' }}>✓</div>
        <h2 style={{ fontSize: 20, fontWeight: 700, color: '#fff', margin: 0 }}>전송 완료!</h2>
        <p style={{ fontSize: 13, color: '#b3b3b3', lineHeight: 1.6, margin: 0 }}>
          <strong style={{ color: '#1ed760' }}>{slackChannel}</strong> 채널에 회의록이 전달됐어요.<br />
          담당자들에게 @멘션 알림도 보냈어요.
        </p>
        <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', justifyContent: 'center', marginTop: 8 }}>
          {[
            { label: '히스토리', icon: '📋', action: () => setStep('history') },
            { label: '새 회의', icon: '＋', action: () => resetMeeting() },
          ].map((btn) => (
            <button
              key={btn.label}
              className="btn-pill"
              onClick={btn.action}
            >
              {btn.icon} {btn.label}
            </button>
          ))}
        </div>
        <style>{`@keyframes pop{0%{transform:scale(0)}70%{transform:scale(1.2)}100%{transform:scale(1)}}`}</style>
      </div>
    </div>
  )
}
