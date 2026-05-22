import { NextResponse } from 'next/server'

// GET /api/slack/auth → Slack OAuth 페이지로 리다이렉트
export async function GET() {
  const appUrl = process.env.NEXT_PUBLIC_APP_URL || 'http://localhost:3000'
  const params = new URLSearchParams({
    client_id: process.env.SLACK_CLIENT_ID!,
    scope: 'chat:write,channels:read,channels:join',
    redirect_uri: `${appUrl}/api/slack/callback`,
  })
  return NextResponse.redirect(
    `https://slack.com/oauth/v2/authorize?${params.toString()}`
  )
}
