import { NextRequest, NextResponse } from 'next/server'

// GET /api/slack/callback → Slack이 인증 후 리다이렉트해주는 엔드포인트
export async function GET(req: NextRequest) {
  const code = req.nextUrl.searchParams.get('code')
  const error = req.nextUrl.searchParams.get('error')
  const appUrl = process.env.NEXT_PUBLIC_APP_URL || 'http://localhost:3000'

  if (error || !code) {
    return NextResponse.redirect(`${appUrl}/?slack_error=${error || 'no_code'}`)
  }

  try {
    // 코드 → 토큰 교환
    const res = await fetch('https://slack.com/api/oauth.v2.access', {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({
        client_id: process.env.SLACK_CLIENT_ID!,
        client_secret: process.env.SLACK_CLIENT_SECRET!,
        code,
        redirect_uri: `${appUrl}/api/slack/callback`,
      }),
    })
    const data = await res.json()

    if (!data.ok) {
      return NextResponse.redirect(`${appUrl}/?slack_error=${data.error}`)
    }

    // 토큰을 httpOnly 쿠키에 저장 (1년)
    const response = NextResponse.redirect(`${appUrl}/?slack_connected=1`)
    const oneYear = 60 * 60 * 24 * 365
    response.cookies.set('slack_token', data.access_token, {
      httpOnly: true, maxAge: oneYear, path: '/',
    })
    response.cookies.set('slack_workspace', data.team?.name ?? 'Slack', {
      maxAge: oneYear, path: '/',
    })
    response.cookies.set('slack_team_id', data.team?.id ?? '', {
      maxAge: oneYear, path: '/',
    })
    return response
  } catch (e) {
    console.error('Slack OAuth error:', e)
    return NextResponse.redirect(`${appUrl}/?slack_error=server_error`)
  }
}
