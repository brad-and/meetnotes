import { NextResponse } from 'next/server'

// POST /api/slack/disconnect → Slack 연결 해제
export async function POST() {
  const res = NextResponse.json({ ok: true })
  res.cookies.delete('slack_token')
  res.cookies.delete('slack_workspace')
  res.cookies.delete('slack_team_id')
  return res
}
