import type { Metadata } from 'next'
import './globals.css'

export const metadata: Metadata = {
  title: 'MeetNotes — AI 회의록 자동화',
  description: '실시간 녹음 → AI 분석 → Slack 자동 전송',
}

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="ko">
      <body style={{ margin: 0, background: '#121212', color: '#fff' }}>{children}</body>
    </html>
  )
}
