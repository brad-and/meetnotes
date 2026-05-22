'use client'
import { useState, useEffect } from 'react'
import { useMeetingStore, MeetingRecord, MeetingMinutes } from '@/store/meetingStore'
import Topbar from '@/components/ui/Topbar'
import { exportMeetingTxt } from '@/lib/exportTxt'

function formatDuration(s: number) {
  const m = Math.floor(s / 60)
  return m > 0 ? `${m}분` : `${s}초`
}

function priorityStyle(p: string) {
  if (p === 'high') return { bg: '#3a1a1a', color: '#f3727f' }
  if (p === 'medium') return { bg: '#1a2a3a', color: '#539df5' }
  return { bg: '#2a2a2a', color: '#b3b3b3' }
}

function priorityLabel(p: string) {
  if (p === 'high') return '높음'
  if (p === 'medium') return '중간'
  return '낮음'
}

function DetailModal({ record, onClose, onDelete }: { record: MeetingRecord; onClose: () => void; onDelete: (id: string) => void }) {
  const m: MeetingMinutes = record.minutes
  return (
    <div
      onClick={onClose}
      style={{
        position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.7)',
        display: 'flex', alignItems: 'center', justifyContent: 'center',
        zIndex: 1000, padding: 24,
      }}
    >
      <div
        onClick={(e) => e.stopPropagation()}
        style={{
          background: '#181818', borderRadius: 12, width: '100%', maxWidth: 680,
          maxHeight: '85vh', overflowY: 'auto',
          boxShadow: 'rgba(0,0,0,0.5) 0px 8px 24px',
        }}
      >
        {/* Header */}
        <div style={{
          padding: '18px 24px', borderBottom: '1px solid #2a2a2a',
          display: 'flex', alignItems: 'center', justifyContent: 'space-between', position: 'sticky', top: 0, background: '#181818', zIndex: 1,
        }}>
          <div>
            <div style={{ fontSize: 16, fontWeight: 700, color: '#fff' }}>{record.title}</div>
            <div style={{ fontSize: 12, color: '#b3b3b3', marginTop: 3 }}>
              {record.date} · {formatDuration(record.duration)} · {record.participants.join(', ')}
            </div>
          </div>
          <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
            <button
              onClick={() => exportMeetingTxt(record)}
              className="btn-pill"
              style={{ fontSize: 11, padding: '5px 12px' }}
            >↓ TXT</button>
            <button
              className="btn-danger"
              style={{ fontSize: 11, padding: '5px 12px', display: 'flex', alignItems: 'center', gap: 4 }}
              onClick={() => { onDelete(record.id); onClose() }}
            >🗑 삭제</button>
            <button
              onClick={onClose}
              style={{ background: 'none', border: 'none', color: '#b3b3b3', fontSize: 20, cursor: 'pointer', padding: '0 4px' }}
            >✕</button>
          </div>
        </div>

        <div style={{ padding: 24, display: 'flex', flexDirection: 'column', gap: 16 }}>
          {/* Detail */}
          <Section label="전체 내용 요약" badge="자세한 내용" badgeBg="#1a2a3a" badgeColor="#539df5">
            <p style={{ fontSize: 13, color: '#cbcbcb', lineHeight: 1.7, margin: 0 }}>{m.detail}</p>
          </Section>

          {/* Core */}
          <Section label="결정사항 요약" badge="핵심 내용" badgeBg="#1a3a1a" badgeColor="#1ed760">
            <p style={{ fontSize: 13, color: '#cbcbcb', lineHeight: 1.7, margin: 0, whiteSpace: 'pre-line' }}>{m.core}</p>
          </Section>

          {/* Keywords */}
          <Section label="주요 키워드" badge="키워드" badgeBg="#1a3a2a" badgeColor="#52d68a">
            <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6 }}>
              {m.keywords.map((kw) => (
                <span key={kw} style={{
                  fontSize: 11, fontWeight: 700, background: '#1f1f1f', border: '1px solid #4d4d4d',
                  color: '#b3b3b3', padding: '4px 10px', borderRadius: 9999,
                }}>{kw}</span>
              ))}
            </div>
          </Section>

          {/* Actions */}
          <Section label="할 일 목록" badge="액션 아이템" badgeBg="#3a2a1a" badgeColor="#ffa42b">
            <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
              {m.actions.map((a) => {
                const ps = priorityStyle(a.priority)
                return (
                  <div key={a.id} style={{
                    display: 'flex', alignItems: 'flex-start', gap: 10,
                    padding: '10px 12px', background: '#1f1f1f', borderRadius: 6,
                  }}>
                    <div style={{ width: 16, height: 16, borderRadius: 3, border: '1px solid #4d4d4d', flexShrink: 0, marginTop: 1, background: '#181818' }} />
                    <div style={{ flex: 1 }}>
                      <div style={{ fontSize: 13, color: '#fff' }}>{a.text}</div>
                      <div style={{ display: 'flex', gap: 4, marginTop: 4, flexWrap: 'wrap' }}>
                        <span style={{ fontSize: 10, fontWeight: 700, padding: '2px 7px', borderRadius: 9999, background: '#1a3a1a', color: '#1ed760' }}>{a.assignee}</span>
                        <span style={{ fontSize: 10, fontWeight: 700, padding: '2px 7px', borderRadius: 9999, background: '#3a2a1a', color: '#ffa42b' }}>{a.due}</span>
                        <span style={{ fontSize: 10, fontWeight: 700, padding: '2px 7px', borderRadius: 9999, background: ps.bg, color: ps.color }}>{priorityLabel(a.priority)}</span>
                      </div>
                    </div>
                  </div>
                )
              })}
            </div>
          </Section>

          {/* Next Steps */}
          {m.nextSteps?.length > 0 && (
            <Section label="AI 추천 후속 액션" badge="다음 스텝" badgeBg="#3a1a1a" badgeColor="#f3727f">
              <div style={{ display: 'flex', flexDirection: 'column' }}>
                {m.nextSteps.map((ns, i) => (
                  <div key={i} style={{ display: 'flex', gap: 10, padding: '10px 0', borderBottom: i < m.nextSteps.length - 1 ? '1px solid #2a2a2a' : 'none' }}>
                    <div style={{ width: 22, height: 22, borderRadius: '50%', background: '#1f1f1f', border: '1px solid #1ed760', color: '#1ed760', fontSize: 11, fontWeight: 700, display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0, marginTop: 1 }}>{i + 1}</div>
                    <div>
                      <div style={{ fontSize: 13, fontWeight: 700, color: '#fff', marginBottom: 3 }}>{ns.title}</div>
                      <div style={{ fontSize: 11, color: '#b3b3b3', lineHeight: 1.5 }}>{ns.reason}</div>
                    </div>
                  </div>
                ))}
              </div>
            </Section>
          )}
        </div>
      </div>
    </div>
  )
}

function Section({ label, badge, badgeBg, badgeColor, children }: {
  label: string; badge: string; badgeBg: string; badgeColor: string; children: React.ReactNode
}) {
  return (
    <div style={{ background: '#1f1f1f', borderRadius: 8, overflow: 'hidden' }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '12px 16px', borderBottom: '1px solid #2a2a2a' }}>
        <span style={{ fontSize: 10, fontWeight: 700, padding: '3px 10px', borderRadius: 9999, textTransform: 'uppercase', letterSpacing: '1.4px', background: badgeBg, color: badgeColor }}>{badge}</span>
        <span style={{ fontSize: 13, fontWeight: 700, color: '#fff' }}>{label}</span>
      </div>
      <div style={{ padding: '14px 16px' }}>{children}</div>
    </div>
  )
}

export default function HistoryScreen() {
  const { meetingHistory, isHistoryLoading, loadHistory, removeFromHistory, clearHistory, toggleArchive, setStep } = useMeetingStore()
  const [selected, setSelected] = useState<MeetingRecord | null>(null)
  const [confirmClear, setConfirmClear] = useState(false)
  const [confirmDeleteId, setConfirmDeleteId] = useState<string | null>(null)
  const [tab, setTab] = useState<'all' | 'archived'>('all')

  const handleDelete = (id: string) => setConfirmDeleteId(id)
  const confirmDelete = () => {
    if (confirmDeleteId) {
      removeFromHistory(confirmDeleteId)
      if (selected?.id === confirmDeleteId) setSelected(null)
      setConfirmDeleteId(null)
    }
  }

  // 화면 진입 시 DB에서 최신 데이터 로드
  useEffect(() => {
    loadHistory()
  }, [])

  const active   = meetingHistory.filter((r) => !r.archived)
  const archived = meetingHistory.filter((r) => r.archived)
  const list     = tab === 'all' ? active : archived

  return (
    <div style={{ minHeight: '100vh', background: '#121212' }}>
      <Topbar>
        <div style={{ display: 'flex', gap: 20 }}>
          <span onClick={() => setStep('setup')} style={{ fontSize: 14, fontWeight: 400, color: '#b3b3b3', cursor: 'pointer' }}>새 회의</span>
          <span style={{ fontSize: 14, fontWeight: 700, color: '#fff', cursor: 'pointer' }}>히스토리</span>
        </div>
        {meetingHistory.length > 0 && (
          <button className="btn-danger" onClick={() => setConfirmClear(true)}>전체 삭제</button>
        )}
      </Topbar>

      <div style={{ maxWidth: 960, margin: '0 auto', padding: '32px 24px 60px' }}>
        <h1 style={{ fontSize: 24, fontWeight: 700, color: '#fff', marginBottom: 4 }}>회의 히스토리</h1>
        <p style={{ fontSize: 14, color: '#b3b3b3', marginBottom: 20 }}>
          {isHistoryLoading ? '불러오는 중...' : `총 ${active.length}개 저장 · 보관함 ${archived.length}개`}
        </p>

        {/* Tab */}
        <div style={{ display: 'flex', gap: 6, marginBottom: 20, borderBottom: '1px solid #2a2a2a', paddingBottom: 0 }}>
          {([['all', '전체', active.length], ['archived', '보관함', archived.length]] as const).map(([key, label, count]) => (
            <button
              key={key}
              onClick={() => setTab(key)}
              style={{
                padding: '8px 16px', background: 'none', border: 'none', cursor: 'pointer',
                fontSize: 13, fontWeight: tab === key ? 700 : 400,
                color: tab === key ? '#fff' : '#b3b3b3',
                borderBottom: `2px solid ${tab === key ? '#1ed760' : 'transparent'}`,
                marginBottom: -1,
                display: 'flex', alignItems: 'center', gap: 6, transition: 'color .15s',
              }}
            >
              {label}
              <span style={{
                fontSize: 10, fontWeight: 700,
                background: tab === key ? '#1a3a1a' : '#2a2a2a',
                color: tab === key ? '#1ed760' : '#b3b3b3',
                padding: '1px 6px', borderRadius: 9999,
              }}>
                {count}
              </span>
            </button>
          ))}
        </div>

        {list.length === 0 ? (
          <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', padding: '80px 24px', gap: 16 }}>
            <div style={{ fontSize: 48 }}>{tab === 'archived' ? '🗂' : '📋'}</div>
            <div style={{ fontSize: 16, fontWeight: 700, color: '#4d4d4d' }}>
              {tab === 'archived' ? '보관된 회의록이 없어요' : '아직 회의록이 없어요'}
            </div>
            <div style={{ fontSize: 13, color: '#4d4d4d' }}>
              {tab === 'archived' ? '회의록 카드의 보관 버튼을 눌러 보관함에 추가하세요.' : '회의를 마치면 자동으로 여기에 저장돼요.'}
            </div>
            {tab === 'all' && (
              <button className="btn-green" onClick={() => setStep('setup')} style={{ marginTop: 8 }}>새 회의 시작하기</button>
            )}
          </div>
        ) : (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
            {list.map((record) => (
              <div
                key={record.id}
                onClick={() => setSelected(record)}
                style={{
                  background: record.archived ? '#141a14' : '#181818',
                  borderRadius: 10, padding: '18px 20px',
                  border: `1px solid ${record.archived ? '#1a3a1a' : '#2a2a2a'}`,
                  cursor: 'pointer', transition: 'border-color .15s, background .15s',
                  display: 'flex', alignItems: 'flex-start', gap: 16,
                }}
                onMouseEnter={(e) => { e.currentTarget.style.borderColor = '#4d4d4d'; e.currentTarget.style.background = '#1f1f1f' }}
                onMouseLeave={(e) => { e.currentTarget.style.borderColor = record.archived ? '#1a3a1a' : '#2a2a2a'; e.currentTarget.style.background = record.archived ? '#141a14' : '#181818' }}
              >
                <div style={{ width: 42, height: 42, borderRadius: 8, background: record.archived ? '#1a3a1a' : '#1f1f1f', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 20, flexShrink: 0 }}>
                  {record.archived ? '🗂' : '📋'}
                </div>

                <div style={{ flex: 1, minWidth: 0 }}>
                  <div style={{ fontSize: 15, fontWeight: 700, color: '#fff', marginBottom: 5, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                    {record.title}
                  </div>
                  <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap' }}>
                    <span style={{ fontSize: 12, color: '#b3b3b3' }}>📅 {record.date}</span>
                    <span style={{ fontSize: 12, color: '#b3b3b3' }}>⏱ {formatDuration(record.duration)}</span>
                    <span style={{ fontSize: 12, color: '#b3b3b3' }}>👥 {record.participants.slice(0, 3).join(', ')}{record.participants.length > 3 ? ` 외 ${record.participants.length - 3}명` : ''}</span>
                  </div>
                  <div style={{ display: 'flex', gap: 6, marginTop: 8, flexWrap: 'wrap' }}>
                    {record.minutes.keywords.slice(0, 4).map((kw) => (
                      <span key={kw} style={{ fontSize: 10, fontWeight: 700, background: '#1f1f1f', border: '1px solid #2a2a2a', color: '#b3b3b3', padding: '2px 8px', borderRadius: 9999 }}>{kw}</span>
                    ))}
                  </div>
                </div>

                <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'flex-end', gap: 6, flexShrink: 0 }}>
                  {record.slackSent && (
                    <span style={{ fontSize: 10, fontWeight: 700, background: '#1a3a1a', color: '#1ed760', padding: '2px 8px', borderRadius: 9999 }}>Slack 전송됨</span>
                  )}
                  <span
                    onClick={(e) => { e.stopPropagation(); toggleArchive(record.id) }}
                    title={record.archived ? '보관 해제' : '보관함에 추가'}
                    style={{ fontSize: 12, color: record.archived ? '#1ed760' : '#4d4d4d', cursor: 'pointer', padding: 4 }}
                    onMouseEnter={(e) => (e.currentTarget.style.color = '#1ed760')}
                    onMouseLeave={(e) => (e.currentTarget.style.color = record.archived ? '#1ed760' : '#4d4d4d')}
                  >{record.archived ? '🗂' : '📥'}</span>
                  <button
                    onClick={(e) => { e.stopPropagation(); handleDelete(record.id) }}
                    title="삭제"
                    style={{
                      background: 'none', border: '1px solid #3a1a1a', borderRadius: 6,
                      color: '#f3727f', cursor: 'pointer', padding: '4px 8px',
                      fontSize: 11, fontWeight: 700, display: 'flex', alignItems: 'center', gap: 3,
                      transition: 'background .15s, border-color .15s',
                    }}
                    onMouseEnter={(e) => { e.currentTarget.style.background = '#3a1a1a'; e.currentTarget.style.borderColor = '#f3727f' }}
                    onMouseLeave={(e) => { e.currentTarget.style.background = 'none'; e.currentTarget.style.borderColor = '#3a1a1a' }}
                  >🗑 삭제</button>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>

      {/* Detail modal */}
      {selected && <DetailModal record={selected} onClose={() => setSelected(null)} onDelete={handleDelete} />}

      {/* Confirm clear dialog */}
      {confirmClear && (
        <div
          onClick={() => setConfirmClear(false)}
          style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.7)', display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 1000 }}
        >
          <div
            onClick={(e) => e.stopPropagation()}
            style={{ background: '#1f1f1f', borderRadius: 12, padding: 28, maxWidth: 340, width: '100%', boxShadow: 'rgba(0,0,0,0.5) 0px 8px 24px', textAlign: 'center' }}
          >
            <div style={{ fontSize: 32, marginBottom: 12 }}>🗑</div>
            <div style={{ fontSize: 16, fontWeight: 700, color: '#fff', marginBottom: 8 }}>전체 삭제</div>
            <div style={{ fontSize: 13, color: '#b3b3b3', marginBottom: 20 }}>저장된 회의록 {meetingHistory.length}개를 모두 삭제할까요? 복구할 수 없어요.</div>
            <div style={{ display: 'flex', gap: 8, justifyContent: 'center' }}>
              <button className="btn-pill" onClick={() => setConfirmClear(false)}>취소</button>
              <button
                className="btn-danger"
                onClick={() => { clearHistory(); setConfirmClear(false) }}
              >삭제</button>
            </div>
          </div>
        </div>
      )}

      {/* Confirm single delete dialog */}
      {confirmDeleteId && (() => {
        const target = meetingHistory.find((r) => r.id === confirmDeleteId)
        return (
          <div
            onClick={() => setConfirmDeleteId(null)}
            style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.7)', display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 1100 }}
          >
            <div
              onClick={(e) => e.stopPropagation()}
              style={{ background: '#1f1f1f', borderRadius: 12, padding: 28, maxWidth: 360, width: '100%', boxShadow: 'rgba(0,0,0,0.5) 0px 8px 24px', textAlign: 'center' }}
            >
              <div style={{ fontSize: 32, marginBottom: 12 }}>🗑</div>
              <div style={{ fontSize: 16, fontWeight: 700, color: '#fff', marginBottom: 8 }}>회의록 삭제</div>
              <div style={{
                fontSize: 14, fontWeight: 700, color: '#f3727f',
                background: '#3a1a1a', border: '1px solid #f3727f',
                borderRadius: 6, padding: '8px 14px', marginBottom: 10,
              }}>{target?.title ?? '회의록'}</div>
              <div style={{ fontSize: 13, color: '#b3b3b3', marginBottom: 20 }}>
                이 회의록을 삭제하면 DB에서도 영구적으로 제거됩니다.<br />복구할 수 없어요.
              </div>
              <div style={{ display: 'flex', gap: 8, justifyContent: 'center' }}>
                <button className="btn-pill" onClick={() => setConfirmDeleteId(null)}>취소</button>
                <button className="btn-danger" onClick={confirmDelete}>삭제</button>
              </div>
            </div>
          </div>
        )
      })()}
    </div>
  )
}
