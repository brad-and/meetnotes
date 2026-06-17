'use client'
import { useState, useEffect } from 'react'
import { useMeetingStore, COLORS } from '@/store/meetingStore'
import Topbar from '@/components/ui/Topbar'
import type { CalendarEvent } from '@/app/api/calendar/events/route'

export default function SetupScreen() {
  const {
    title, setTitle, meetingType, setMeetingType, recordingMode, setRecordingMode,
    participants, addParticipant, removeParticipant, updateParticipantName,
    slackChannel, setSlackChannel, aiOptions, toggleAiOption, setStep, meetingHistory, resetMeeting,
    setSpeakerName,
  } = useMeetingStore()

  const [newName, setNewName] = useState('')
  const [mounted, setMounted] = useState(false)
  const [slackInfo, setSlackInfo] = useState<{ configured: boolean; method?: string; workspace?: string; channel?: string } | null>(null)
  const [channels, setChannels] = useState<{ id: string; name: string }[]>([])
  const [showSlackSettings, setShowSlackSettings] = useState(false)
  const [webhookUrl, setWebhookUrl] = useState('')
  const [webhookChannel, setWebhookChannel] = useState('')
  const [webhookSaved, setWebhookSaved] = useState(false)
  const [webhookError, setWebhookError] = useState<string | null>(null)

  // 캘린더
  const [calEvents, setCalEvents] = useState<CalendarEvent[] | null>(null)
  const [calLoading, setCalLoading] = useState(false)
  const [calConfigured, setCalConfigured] = useState<boolean | null>(null)
  const [showCalPicker, setShowCalPicker] = useState(false)
  const [calUpdatedAt, setCalUpdatedAt] = useState<string | null>(null)
  const [calRefreshing, setCalRefreshing] = useState(false)
  const [calRefreshError, setCalRefreshError] = useState<string | null>(null)
  const [showCalSettings, setShowCalSettings] = useState(false)
  const [gscriptUrl, setGscriptUrl] = useState('')
  const [gscriptSaved, setGscriptSaved] = useState(false)
  const [hostEmail, setHostEmail] = useState('')

  useEffect(() => {
    const frame = requestAnimationFrame(() => setMounted(true))
    return () => cancelAnimationFrame(frame)
  }, [])

  // 서버 설정 파일에서 Apps Script URL 로드 (localStorage는 fallback)
  useEffect(() => {
    fetch('/api/calendar/settings')
      .then(r => r.json())
      .then(d => {
        const url = d.gscriptUrl || localStorage.getItem('calGScriptUrl') || ''
        if (url) {
          setGscriptUrl(url)
          localStorage.setItem('calGScriptUrl', url)
        }
        if (d.hostEmail) {
          setHostEmail(d.hostEmail)
          // 이메일 로컬파트를 그대로 사용 (점 포함): brad.and@... → "brad.and"
          const hostName = d.hostEmail.split('@')[0]
          setSpeakerName('Speaker 0', hostName)   // 실시간 녹음 시 Speaker 0 → brad.and
          updateParticipantName('1', hostName)    // 참여자 칩 이름 업데이트
        }
      })
      .catch(() => {
        const saved = localStorage.getItem('calGScriptUrl')
        if (saved) setGscriptUrl(saved)
      })
  }, [setSpeakerName, updateParticipantName])

  // 캘린더 설정 여부 확인 + 이벤트 자동 로드
  useEffect(() => {
    fetch('/api/calendar/events')
      .then((r) => r.json())
      .then((d) => {
        if (d.error === 'not_configured') {
          setCalConfigured(false)
        } else {
          setCalConfigured(true)
          if (d.events) setCalEvents(d.events)
          if (d.updatedAt) setCalUpdatedAt(d.updatedAt)
        }
      })
      .catch(() => setCalConfigured(false))
  }, [])

  const handleLoadCalendar = async () => {
    setCalLoading(true)
    setShowCalPicker(true)
    try {
      const res = await fetch('/api/calendar/events')
      const data = await res.json()
      if (data.events) setCalEvents(data.events)
      if (data.updatedAt) setCalUpdatedAt(data.updatedAt)
    } catch { /* ignore */ }
    finally { setCalLoading(false) }
  }

  // 🔄 클릭: 서버에서 직접 Apps Script 호출 → 캘린더 자동 갱신
  const handleRefreshCalendar = async () => {
    setCalRefreshing(true)
    setCalRefreshError(null)
    try {
      const res = await fetch('/api/calendar/refresh', { method: 'POST' })
      const data = await res.json()
      if (data.error) throw new Error(data.error)
      if (data.events) setCalEvents(data.events)
      if (data.updatedAt) setCalUpdatedAt(data.updatedAt)
      setCalConfigured(true)
      setShowCalPicker(true)
    } catch (err) {
      setCalRefreshError(err instanceof Error ? err.message : String(err))
    } finally {
      setCalRefreshing(false)
    }
  }

  const handleSaveGscriptUrl = () => {
    if (!gscriptUrl.trim()) return
    const url = gscriptUrl.trim()
    localStorage.setItem('calGScriptUrl', url)
    // 서버 설정 파일에도 저장
    fetch('/api/calendar/settings', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ gscriptUrl: url, hostEmail: hostEmail.trim() }),
    }).catch(() => {})
    setGscriptSaved(true)
    setTimeout(() => setGscriptSaved(false), 2000)
    setShowCalSettings(false)
    setCalRefreshError(null)
    handleRefreshCalendar()
  }

  const formatUpdatedAt = (iso: string) => {
    const d = new Date(iso)
    return d.toLocaleString('ko-KR', { month: 'numeric', day: 'numeric', hour: '2-digit', minute: '2-digit', hour12: false })
  }

  const handlePickEvent = (ev: CalendarEvent) => {
    setTitle(ev.title)
    // 기존 캘린더에서 추가된 참석자 먼저 제거
    participants
      .filter((p) => p.id.startsWith('cal-'))
      .forEach((p) => removeParticipant(p.id))

    // 구형(string) / 신형({email,status}) 두 포맷 모두 정규화
    const normalized = ev.attendees.map((a) =>
      typeof a === 'string'
        ? { email: a, status: 'accepted' as const }  // 구형 캐시는 수락으로 간주
        : a
    )

    // resource.calendar(회의실) 제외 + 거절/미응답 제외 → 수락·미정만
    const responded = normalized.filter(
      (a) => !a.email.includes('resource.calendar')
            && a.status !== 'declined'
            && a.status !== 'needsAction'
    )

    // hostEmail이 있으면 본인을 맨 앞으로 정렬
    const myEmail = hostEmail.trim().toLowerCase()
    const sorted  = myEmail
      ? [...responded.filter((a) => a.email.toLowerCase() === myEmail),
         ...responded.filter((a) => a.email.toLowerCase() !== myEmail)]
      : responded

    // 인원 제한 없이 전원 추가 (host는 id='1'로 이미 존재하므로 제외)
    sorted
      .filter((a) => !myEmail || a.email.toLowerCase() !== myEmail)
      .forEach((attendee, i) => {
        const name     = attendee.email.split('@')[0]  // brad.and (점 포함)
        const colorIdx = (i + 1) % COLORS.length
        addParticipant({ id: `cal-${ev.id}-${i}`, name, ...COLORS[colorIdx] })
      })
    setShowCalPicker(false)
  }

  const formatEventTime = (iso: string) => {
    const d = new Date(iso)
    return d.toLocaleString('ko-KR', { month: 'numeric', day: 'numeric', hour: '2-digit', minute: '2-digit', hour12: false })
  }

  // Slack 상태 + 설정 파일 로드
  useEffect(() => {
    fetch('/api/slack/status')
      .then((r) => r.json())
      .then((d) => {
        setSlackInfo(d)
        if (d.configured && d.method === 'oauth') {
          fetch('/api/slack/channels')
            .then((r) => r.json())
            .then((c) => { if (c.channels) setChannels(c.channels) })
        }
      })
      .catch(() => {})
    // 저장된 Webhook URL·채널 로드
    fetch('/api/slack/settings')
      .then((r) => r.json())
      .then((d) => {
        if (d.webhookUrl) setWebhookUrl(d.webhookUrl)
        if (d.channel)    setWebhookChannel(d.channel)
      })
      .catch(() => {})
  }, [])

  const handleSaveWebhook = async () => {
    if (!webhookUrl.trim()) return
    setWebhookError(null)
    try {
      await fetch('/api/slack/settings', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ webhookUrl: webhookUrl.trim(), channel: webhookChannel.trim() }),
      })
      setWebhookSaved(true)
      setTimeout(() => setWebhookSaved(false), 2000)
      setShowSlackSettings(false)
      // 상태 갱신
      const d = await fetch('/api/slack/status').then(r => r.json())
      setSlackInfo(d)
    } catch (e) {
      setWebhookError(e instanceof Error ? e.message : '저장 실패')
    }
  }

  const handleDisconnectSlack = async () => {
    // OAuth 쿠키 제거
    await fetch('/api/slack/disconnect', { method: 'POST' })
    // 파일 설정도 초기화
    await fetch('/api/slack/settings', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ webhookUrl: '', channel: '' }),
    })
    setSlackInfo({ configured: false })
    setChannels([])
    setWebhookUrl('')
    setWebhookChannel('')
  }

  const handleAddParticipant = () => {
    if (!newName.trim()) return
    const colorIdx = participants.length % COLORS.length
    addParticipant({
      id: Date.now().toString(),
      name: newName.trim(),
      ...COLORS[colorIdx],
    })
    setNewName('')
  }

  const canProceed = title.trim().length > 0

  return (
    <div style={{ minHeight: '100vh', background: '#121212' }}>
      <Topbar>
        <div style={{ display: 'flex', gap: 20 }}>
          <span style={{ fontSize: 14, fontWeight: 700, color: '#fff', cursor: 'pointer' }}>새 회의</span>
          <span
            onClick={() => setStep('history')}
            style={{ fontSize: 14, fontWeight: 400, color: '#b3b3b3', cursor: 'pointer', display: 'flex', alignItems: 'center', gap: 5 }}
          >
            히스토리
            {mounted && meetingHistory.length > 0 && (
              <span style={{ fontSize: 10, fontWeight: 700, background: '#1a3a1a', color: '#1ed760', padding: '1px 6px', borderRadius: 9999 }}>
                {meetingHistory.length}
              </span>
            )}
          </span>
        </div>
      </Topbar>

      <div style={{ maxWidth: 1280, margin: '0 auto', padding: '32px 24px 60px' }}>
        <h1 style={{ fontSize: 24, fontWeight: 700, color: '#fff', marginBottom: 4 }}>새 회의 시작</h1>
        <p style={{ fontSize: 14, color: '#b3b3b3', marginBottom: 28 }}>
          회의 정보를 입력하면 AI가 자동으로 회의록을 작성해드려요.
        </p>

        {/* 캘린더 카드 — 캐시가 있거나 미설정 상태 모두 표시 */}
        {calConfigured !== false && (
          <div className="sp-card" style={{ marginBottom: 12 }}>
            {/* 헤더 */}
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: (showCalPicker || showCalSettings) ? 12 : 0 }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                <span style={{ fontSize: 16 }}>📅</span>
                <div>
                  <div style={{ fontSize: 13, fontWeight: 700, color: '#fff' }}>Google 캘린더</div>
                  <div style={{ fontSize: 11, color: '#b3b3b3' }}>
                    {calUpdatedAt ? `업데이트: ${formatUpdatedAt(calUpdatedAt)}` : '이번 주 미팅을 선택해서 자동으로 입력'}
                  </div>
                </div>
              </div>
              <div style={{ display: 'flex', gap: 6, alignItems: 'center', flexShrink: 0 }}>
                {/* Apps Script URL 설정 */}
                <button
                  onClick={() => { setShowCalSettings(s => !s); setCalRefreshError(null) }}
                  title="Google Apps Script URL 설정"
                  style={{
                    background: showCalSettings ? '#1a3a1a' : '#1f1f1f',
                    border: `1px solid ${showCalSettings ? '#1ed760' : '#333'}`,
                    borderRadius: 9999, color: showCalSettings ? '#1ed760' : '#b3b3b3',
                    cursor: 'pointer', padding: '5px 10px', fontSize: 13, lineHeight: 1,
                  }}
                >⚙️</button>
                {/* 새로고침 버튼 */}
                <button
                  onClick={handleRefreshCalendar}
                  disabled={calRefreshing}
                  title="Google Apps Script로 최신 일정 가져오기"
                  style={{
                    background: '#1f1f1f', border: '1px solid #333', borderRadius: 9999,
                    color: calRefreshing ? '#666' : '#b3b3b3', cursor: calRefreshing ? 'not-allowed' : 'pointer',
                    padding: '5px 10px', fontSize: 13, lineHeight: 1, transition: 'all .15s',
                  }}
                >
                  {calRefreshing ? '⏳' : '🔄'}
                </button>
                {/* 일정 목록 토글 */}
                {calConfigured && (
                  <button
                    className="btn-pill"
                    onClick={showCalPicker ? () => setShowCalPicker(false) : handleLoadCalendar}
                    disabled={calLoading}
                    style={{ fontSize: 12, padding: '6px 14px' }}
                  >
                    {calLoading ? '로딩 중...' : showCalPicker ? '닫기' : '📋 선택'}
                  </button>
                )}
              </div>
            </div>

            {/* Apps Script URL 설정 패널 */}
            {showCalSettings && (
              <div style={{ background: '#1a1a1a', borderRadius: 8, padding: 14, marginBottom: 10 }}>
                <div style={{ fontSize: 12, fontWeight: 700, color: '#fff', marginBottom: 6 }}>
                  Google Apps Script URL
                </div>
                <div style={{ fontSize: 11, color: '#b3b3b3', lineHeight: 1.6, marginBottom: 10 }}>
                  <a href="https://script.google.com" target="_blank" rel="noreferrer" style={{ color: '#1ed760' }}>script.google.com</a>에서
                  아래 코드로 웹앱을 만들면 iCal 없이도 캘린더를 가져올 수 있어요.<br />
                  배포 시 <strong style={{ color: '#fff' }}>실행: 나 / 액세스: 모든 사용자 (익명 포함)</strong>으로 설정해주세요.
                </div>
                <div style={{ background: '#0d0d0d', borderRadius: 6, padding: '8px 12px', fontFamily: 'monospace', fontSize: 10, color: '#b3b3b3', lineHeight: 1.6, marginBottom: 10, overflow: 'auto', whiteSpace: 'pre' }}>
{`function doGet(e) {
  var action = e && e.parameter && e.parameter.action;
  var cal = CalendarApp.getDefaultCalendar();
  var now = new Date();
  var end = new Date(now.getTime() + 7*24*60*60*1000);
  var evs = cal.getEvents(now, end);
  var re = /https:\\/\\/meet\\.google\\.com\\/[a-z0-9-]+/;
  var result = evs.map(function(ev) {
    var loc = ev.getLocation() || '';
    var desc = ev.getDescription() || '';
    return {
      id: ev.getId(), title: ev.getTitle(),
      start: ev.getStartTime().toISOString(),
      end: ev.getEndTime().toISOString(),
      attendees: ev.getGuestList(true).map(
        function(g){return g.getEmail();}),
      location: (loc&&!loc.match(/^https/))?loc:null,
      meetUrl:(desc.match(re)||loc.match(re)||[])[0]||null
    };
  });
  var data = {type:'calendar-data', events:result,
               updatedAt:new Date().toISOString()};
  if (action === 'meetnotes') {
    var json = JSON.stringify(data);
    var html = '<script>window.opener&&window.opener'
      + '.postMessage(' + json + ',"*");'
      + 'window.close();<\\/script>'
      + '<p style="font-family:sans-serif;padding:20px">'
      + '✅ 캘린더 동기화 완료</p>';
    return HtmlService.createHtmlOutput(html);
  }
  return ContentService
    .createTextOutput(JSON.stringify(data))
    .setMimeType(ContentService.MimeType.JSON);
}`}
                </div>
                <div style={{ display: 'flex', gap: 8, marginBottom: 10 }}>
                  <input
                    className="sp-input"
                    style={{ flex: 1, fontSize: 12 }}
                    placeholder="https://script.google.com/macros/s/.../exec"
                    value={gscriptUrl}
                    onChange={(e) => setGscriptUrl(e.target.value)}
                    onKeyDown={(e) => { if (e.key === 'Enter') handleSaveGscriptUrl() }}
                  />
                </div>
                <div style={{ fontSize: 11, fontWeight: 700, color: '#b3b3b3', textTransform: 'uppercase', letterSpacing: '1.4px', marginBottom: 6 }}>
                  내 구글 계정 (나 · 진행자 자동 설정)
                </div>
                <div style={{ display: 'flex', gap: 8 }}>
                  <input
                    className="sp-input"
                    style={{ flex: 1, fontSize: 12 }}
                    placeholder="brad.and@kakaomobility.com"
                    value={hostEmail}
                    onChange={(e) => setHostEmail(e.target.value)}
                    onKeyDown={(e) => { if (e.key === 'Enter') handleSaveGscriptUrl() }}
                  />
                  <button
                    className="btn-green"
                    onClick={handleSaveGscriptUrl}
                    disabled={!gscriptUrl.trim()}
                    style={{ fontSize: 12, padding: '0 16px', flexShrink: 0 }}
                  >
                    {gscriptSaved ? '✓ 저장됨' : '저장 & 갱신'}
                  </button>
                </div>
              </div>
            )}

            {/* 오류 메시지 */}
            {calRefreshError && (
              <div style={{ fontSize: 12, color: '#f3727f', background: '#2a1a1a', borderRadius: 6, padding: '8px 12px', marginBottom: 8, lineHeight: 1.5 }}>
                ⚠️ {calRefreshError}
              </div>
            )}

            {/* 일정 선택 목록 */}
            {showCalPicker && (
              <div>
                {calLoading && (
                  <div style={{ textAlign: 'center', padding: '16px 0', color: '#b3b3b3', fontSize: 13 }}>일정을 가져오는 중...</div>
                )}
                {!calLoading && calEvents && calEvents.length === 0 && (
                  <div style={{ textAlign: 'center', padding: '16px 0', color: '#b3b3b3', fontSize: 13 }}>이번 주 예정된 미팅이 없어요.</div>
                )}
                {!calLoading && calEvents && calEvents.length > 0 && (
                  <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
                    {calEvents.map((ev) => (
                      <div
                        key={`${ev.id}-${ev.start}`}
                        onClick={() => handlePickEvent(ev)}
                        style={{
                          padding: '10px 14px', background: '#1f1f1f', borderRadius: 8,
                          cursor: 'pointer', border: '1px solid transparent', transition: 'all .15s',
                        }}
                        onMouseEnter={(e) => { e.currentTarget.style.border = '1px solid #1ed760'; e.currentTarget.style.background = '#1a3a1a' }}
                        onMouseLeave={(e) => { e.currentTarget.style.border = '1px solid transparent'; e.currentTarget.style.background = '#1f1f1f' }}
                      >
                        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', gap: 8 }}>
                          <div style={{ fontSize: 13, fontWeight: 700, color: '#fff', flex: 1 }}>{ev.title}</div>
                          {ev.meetUrl && <span style={{ fontSize: 10, color: '#1ed760', background: '#1a3a1a', padding: '2px 6px', borderRadius: 4, flexShrink: 0 }}>Meet</span>}
                        </div>
                        <div style={{ fontSize: 11, color: '#b3b3b3', marginTop: 3 }}>
                          {formatEventTime(ev.start)} · 참석자 {ev.attendees.length}명
                          {ev.location && ` · ${ev.location.length > 20 ? ev.location.slice(0, 20) + '…' : ev.location}`}
                        </div>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            )}
          </div>
        )}

        {/* Basic Info */}
        <div className="sp-card" style={{ marginBottom: 12 }}>
          <div style={{ marginBottom: 20 }}>
            <label className="sp-label">회의 제목 <span style={{ color: '#f3727f' }}>*</span></label>
            <input
              className="sp-input"
              type="text"
              placeholder="예: Q3 기능 우선순위 조정 회의"
              value={title}
              onChange={(e) => setTitle(e.target.value)}
            />
            <p style={{ fontSize: 12, color: '#b3b3b3', marginTop: 5 }}>
              회의록 상단과 Slack 메시지 제목으로 사용됩니다.
            </p>
          </div>

          <div>
            <label className="sp-label">회의 유형 <span style={{ color: '#f3727f' }}>*</span></label>
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10 }}>
              {[
                { key: 'face', icon: '👥', title: '대면 회의', desc: '마이크로 실시간 녹음\n발언자 자동 구분' },
                { key: 'online', icon: '🎥', title: '온라인 회의', desc: '오디오 파일 업로드\nZoom · Teams · Meet' },
              ].map((t) => (
                <div
                  key={t.key}
                  onClick={() => setMeetingType(t.key as 'face' | 'online')}
                  style={{
                    background: meetingType === t.key ? '#1a3a1a' : '#1f1f1f',
                    border: `1px solid ${meetingType === t.key ? '#1ed760' : 'transparent'}`,
                    borderRadius: 8, padding: 16, cursor: 'pointer', transition: 'all .15s',
                  }}
                >
                  <div style={{
                    width: 40, height: 40, borderRadius: '50%',
                    background: meetingType === t.key ? '#0d2a0d' : '#2a2a2a',
                    display: 'flex', alignItems: 'center', justifyContent: 'center',
                    fontSize: 18, marginBottom: 10,
                  }}>{t.icon}</div>
                  <div style={{ fontSize: 14, fontWeight: 700, color: meetingType === t.key ? '#1ed760' : '#fff', marginBottom: 4 }}>{t.title}</div>
                  <div style={{ fontSize: 12, color: '#b3b3b3', lineHeight: 1.5, whiteSpace: 'pre-line' }}>{t.desc}</div>
                </div>
              ))}
            </div>
          </div>

          {meetingType === 'face' && (
            <div style={{ marginTop: 20 }}>
              <label className="sp-label">녹음 방식</label>
              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10 }}>
                {[
                  {
                    key: 'standard',
                    icon: '●',
                    title: '표준 녹음',
                    desc: '녹음 안정성 우선\n종료 후 AI 전사·회의록 작성',
                  },
                  {
                    key: 'realtime',
                    icon: '▣',
                    title: '실시간 대사',
                    desc: 'Deepgram으로 발화 표시\n종료 후 대사 기반 회의록 작성',
                  },
                ].map((m) => (
                  <div
                    key={m.key}
                    onClick={() => setRecordingMode(m.key as 'standard' | 'realtime')}
                    style={{
                      background: recordingMode === m.key ? '#1a3a1a' : '#1f1f1f',
                      border: `1px solid ${recordingMode === m.key ? '#1ed760' : 'transparent'}`,
                      borderRadius: 8, padding: 16, cursor: 'pointer', transition: 'all .15s',
                    }}
                  >
                    <div style={{
                      width: 32, height: 32, borderRadius: 8,
                      background: recordingMode === m.key ? '#0d2a0d' : '#2a2a2a',
                      color: recordingMode === m.key ? '#1ed760' : '#b3b3b3',
                      display: 'flex', alignItems: 'center', justifyContent: 'center',
                      fontSize: 14, marginBottom: 10, fontWeight: 700,
                    }}>{m.icon}</div>
                    <div style={{ fontSize: 14, fontWeight: 700, color: recordingMode === m.key ? '#1ed760' : '#fff', marginBottom: 4 }}>{m.title}</div>
                    <div style={{ fontSize: 12, color: '#b3b3b3', lineHeight: 1.5, whiteSpace: 'pre-line' }}>{m.desc}</div>
                  </div>
                ))}
              </div>
              <p style={{ fontSize: 12, color: '#b3b3b3', marginTop: 6 }}>
                중요한 회의는 실시간 대사, 네트워크가 불안정한 환경은 표준 녹음을 권장합니다.
              </p>
            </div>
          )}
        </div>

        {/* Participants */}
        <div className="sp-card" style={{ marginBottom: 12 }}>
          <span className="sp-label">참여자</span>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 6, marginBottom: 10 }}>
            {participants.map((p, i) => (
              <div key={p.id} style={{
                display: 'flex', alignItems: 'center', gap: 10,
                padding: '8px 12px', background: '#1f1f1f', borderRadius: 9999,
              }}>
                <div style={{
                  width: 28, height: 28, borderRadius: '50%', flexShrink: 0,
                  background: p.bgColor, color: p.color,
                  display: 'flex', alignItems: 'center', justifyContent: 'center',
                  fontSize: 11, fontWeight: 700,
                }}>{p.name[0]}</div>
                <span style={{ fontSize: 13, fontWeight: 700, color: '#fff', flex: 1 }}>{p.name}</span>
                <span style={{ fontSize: 12, color: '#b3b3b3' }}>{i === 0 ? '나 (진행자)' : '팀원'}</span>
                {i > 0 && (
                  <span onClick={() => removeParticipant(p.id)} style={{ fontSize: 14, color: '#b3b3b3', cursor: 'pointer', opacity: .6 }}>✕</span>
                )}
              </div>
            ))}
          </div>
          <div style={{ display: 'flex', gap: 8 }}>
            <input
              className="sp-input"
              type="text"
              placeholder="이름 입력 후 Enter"
              value={newName}
              onChange={(e) => setNewName(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter' && !e.nativeEvent.isComposing) {
                  e.preventDefault()
                  handleAddParticipant()
                }
              }}
              style={{ flex: 1 }}
            />
            <button className="btn-pill" onClick={handleAddParticipant} style={{ flexShrink: 0, padding: '0 16px' }}>+ 추가</button>
          </div>
          <p style={{ fontSize: 12, color: '#b3b3b3', marginTop: 6 }}>이름을 미리 등록하면 AI가 발언자를 더 정확하게 구분해요.</p>
        </div>

        {/* Slack & Options */}
        <div className="sp-card" style={{ marginBottom: 32 }}>
          <div style={{ marginBottom: 20 }}>
            {/* 헤더 */}
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: showSlackSettings ? 12 : slackInfo?.configured ? 10 : 0 }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                <span style={{ fontSize: 16 }}>💬</span>
                <div>
                  <span className="sp-label" style={{ margin: 0 }}>Slack 연동</span>
                  <div style={{ fontSize: 11, color: '#b3b3b3', marginTop: 2 }}>
                    {slackInfo?.configured
                      ? slackInfo.method === 'webhook'
                        ? `Webhook 연결됨${slackInfo.channel ? ` · ${slackInfo.channel}` : ''}`
                        : `OAuth 연결됨 · ${slackInfo.workspace ?? ''}`
                      : '회의록을 Slack 채널로 바로 전송'}
                  </div>
                </div>
              </div>
              <div style={{ display: 'flex', gap: 6, alignItems: 'center' }}>
                <button
                  onClick={() => { setShowSlackSettings(s => !s); setWebhookError(null) }}
                  title="Webhook URL 설정"
                  style={{
                    background: showSlackSettings ? '#1a3a1a' : '#1f1f1f',
                    border: `1px solid ${showSlackSettings ? '#1ed760' : '#333'}`,
                    borderRadius: 9999, color: showSlackSettings ? '#1ed760' : '#b3b3b3',
                    cursor: 'pointer', padding: '5px 10px', fontSize: 13, lineHeight: 1,
                  }}
                >⚙️</button>
                {slackInfo?.configured && (
                  <button
                    onClick={handleDisconnectSlack}
                    style={{ fontSize: 11, color: '#b3b3b3', background: 'none', border: 'none', cursor: 'pointer', textDecoration: 'underline' }}
                  >해제</button>
                )}
              </div>
            </div>

            {/* 연결 상태 배지 */}
            {slackInfo?.configured && !showSlackSettings && (
              <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 10 }}>
                <div style={{ fontSize: 12, fontWeight: 700, color: '#1ed760', background: '#1a3a1a', padding: '4px 10px', borderRadius: 9999 }}>
                  ✓ {slackInfo.method === 'webhook' ? 'Webhook' : slackInfo.workspace ?? '연결됨'}
                </div>
                {slackInfo.method === 'oauth' && (
                  <select
                    className="sp-input"
                    style={{ borderRadius: 9999, height: 32, fontSize: 12 }}
                    value={slackChannel}
                    onChange={(e) => setSlackChannel(e.target.value)}
                  >
                    {channels.length > 0
                      ? channels.map((c) => <option key={c.id} value={c.name}>{c.name}</option>)
                      : <option value={slackChannel}>{slackChannel}</option>
                    }
                  </select>
                )}
              </div>
            )}

            {/* Webhook 설정 패널 */}
            {showSlackSettings && (
              <div style={{ background: '#1a1a1a', borderRadius: 8, padding: 14, marginBottom: 10 }}>
                <div style={{ fontSize: 12, fontWeight: 700, color: '#fff', marginBottom: 6 }}>
                  Incoming Webhook URL
                </div>
                <div style={{ fontSize: 11, color: '#b3b3b3', lineHeight: 1.7, marginBottom: 10 }}>
                  Slack 앱 관리자가 제공한 Webhook URL을 붙여넣어 주세요.<br />
                  <strong style={{ color: '#fff' }}>api.slack.com/apps</strong> → 앱 선택 → Incoming Webhooks → Webhook URL 복사
                </div>
                <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
                  <input
                    className="sp-input"
                    style={{ fontSize: 12 }}
                    placeholder="https://hooks.slack.com/services/T.../B.../..."
                    value={webhookUrl}
                    onChange={(e) => setWebhookUrl(e.target.value)}
                  />
                  <input
                    className="sp-input"
                    style={{ fontSize: 12 }}
                    placeholder="채널명 (표시용, 예: #general)"
                    value={webhookChannel}
                    onChange={(e) => setWebhookChannel(e.target.value)}
                  />
                  <button
                    className="btn-green"
                    onClick={handleSaveWebhook}
                    disabled={!webhookUrl.trim()}
                    style={{ fontSize: 12, padding: '8px 20px', alignSelf: 'flex-start' }}
                  >
                    {webhookSaved ? '✓ 저장됨' : '저장'}
                  </button>
                </div>
                {webhookError && (
                  <div style={{ fontSize: 11, color: '#f3727f', marginTop: 8 }}>⚠️ {webhookError}</div>
                )}
              </div>
            )}

            {/* 미연결 안내 */}
            {!slackInfo?.configured && !showSlackSettings && (
              <div style={{ fontSize: 11, color: '#b3b3b3', padding: '8px 0' }}>
                ⚙️ 버튼을 눌러 Webhook URL을 등록하면 회의 종료 후 바로 전송할 수 있어요.
              </div>
            )}
          </div>

          <span className="sp-label">AI 분석 옵션</span>
          {[
            { key: 'diarization', name: '발언자 구분', desc: 'Speaker Diarization 자동 적용' },
            { key: 'nextSteps', name: '다음 스텝 AI 제안', desc: '회의 맥락 기반 후속 액션 추천' },
            { key: 'captions', name: '실시간 자막 표시', desc: '녹음 중 화면에 자막 실시간 표시' },
            { key: 'history', name: '히스토리 저장', desc: '완료된 회의록 자동 보관' },
          ].map((opt) => (
            <div key={opt.key} style={{
              display: 'flex', alignItems: 'center', justifyContent: 'space-between',
              padding: '10px 0', borderBottom: '1px solid #2a2a2a',
            }}>
              <div>
                <div style={{ fontSize: 13, fontWeight: 700, color: '#fff' }}>{opt.name}</div>
                <div style={{ fontSize: 11, color: '#b3b3b3', marginTop: 2 }}>{opt.desc}</div>
              </div>
              <div
                className={`sp-toggle ${aiOptions[opt.key as keyof typeof aiOptions] ? 'on' : ''}`}
                onClick={() => toggleAiOption(opt.key as keyof typeof aiOptions)}
                role="switch"
                aria-checked={aiOptions[opt.key as keyof typeof aiOptions]}
              >
                <div className="sp-toggle-thumb" />
              </div>
            </div>
          ))}
        </div>

        <div style={{ display: 'flex', justifyContent: 'space-between' }}>
          <button className="btn-pill" onClick={resetMeeting}>취소</button>
          <button
            className="btn-green"
            disabled={!canProceed}
            onClick={() => setStep('recording')}
          >
            다음 단계로 →
          </button>
        </div>
      </div>
    </div>
  )
}
