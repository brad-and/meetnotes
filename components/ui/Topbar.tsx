'use client'
import { useMeetingStore } from '@/store/meetingStore'

const STEPS = ['기본 설정', '녹음 중', 'AI 분석', '완료'] as const
const STEP_KEYS = ['setup', 'recording', 'review', 'slack'] as const
type MainStep = typeof STEP_KEYS[number]

export default function Topbar({ children }: { children?: React.ReactNode }) {
  const step = useMeetingStore((s) => s.step)
  const mainStep = (STEP_KEYS as readonly string[]).includes(step) ? step as MainStep : 'setup'
  const currentIdx = STEP_KEYS.indexOf(mainStep)

  return (
    <div style={{ background: '#121212', borderBottom: '1px solid #2a2a2a' }}>
      {/* Main topbar */}
      <div style={{
        height: 56, padding: '0 24px', display: 'flex',
        alignItems: 'center', justifyContent: 'space-between', gap: 12
      }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 10, fontSize: 15, fontWeight: 700 }}>
          <div style={{
            width: 32, height: 32, background: '#1ed760', borderRadius: '50%',
            display: 'flex', alignItems: 'center', justifyContent: 'center'
          }}>
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="#000" strokeWidth="2.5" strokeLinecap="round">
              <path d="M12 2a3 3 0 0 0-3 3v7a3 3 0 0 0 6 0V5a3 3 0 0 0-3-3z"/>
              <path d="M19 10v2a7 7 0 0 1-14 0v-2M12 19v3M8 22h8"/>
            </svg>
          </div>
          MeetNotes
        </div>
        {children}
        <div style={{
          width: 32, height: 32, borderRadius: '50%', background: '#1f1f1f',
          border: '1px solid #4d4d4d', display: 'flex', alignItems: 'center',
          justifyContent: 'center', fontSize: 12, fontWeight: 700, cursor: 'pointer'
        }}>나</div>
      </div>

      {/* Step bar — history 페이지에서는 숨김 */}
      {step !== 'history' && (
        <div style={{
          background: '#181818', borderTop: '1px solid #2a2a2a',
          height: 40, padding: '0 24px', display: 'flex', alignItems: 'center'
        }}>
          {STEPS.map((label, i) => (
            <div key={i} style={{ display: 'flex', alignItems: 'center', flex: i < STEPS.length - 1 ? 1 : 'none' }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                <div style={{
                  width: 20, height: 20, borderRadius: '50%', display: 'flex',
                  alignItems: 'center', justifyContent: 'center', fontSize: 11, fontWeight: 700,
                  background: i < currentIdx ? '#1a3a1a' : i === currentIdx ? '#1ed760' : '#1f1f1f',
                  color: i < currentIdx ? '#1ed760' : i === currentIdx ? '#000' : '#b3b3b3',
                  border: i > currentIdx ? '1px solid #4d4d4d' : 'none',
                  flexShrink: 0,
                }}>
                  {i < currentIdx ? '✓' : i + 1}
                </div>
                <span style={{
                  fontSize: 12,
                  fontWeight: i === currentIdx ? 700 : 400,
                  color: i === currentIdx ? '#fff' : '#b3b3b3',
                }}>{label}</span>
              </div>
              {i < STEPS.length - 1 && (
                <div style={{ flex: 1, height: 1, background: '#2a2a2a', margin: '0 10px' }} />
              )}
            </div>
          ))}
        </div>
      )}
    </div>
  )
}
