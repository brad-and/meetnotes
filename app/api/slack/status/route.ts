import { NextRequest, NextResponse } from 'next/server'
import { readFileSync } from 'fs'
import { join } from 'path'

function readSlackSettings(): Record<string, string> {
  try {
    return JSON.parse(readFileSync(join(process.cwd(), 'data', 'slack-settings.json'), 'utf-8'))
  } catch {
    return {}
  }
}

export async function GET(req: NextRequest) {
  // ① OAuth 토큰 (쿠키)
  const token = req.cookies.get('slack_token')?.value
  const workspace = req.cookies.get('slack_workspace')?.value
  if (token) {
    return NextResponse.json({ configured: true, method: 'oauth', workspace })
  }

  // ② 파일에 저장된 Webhook URL
  const settings = readSlackSettings()
  if (settings.webhookUrl) {
    return NextResponse.json({
      configured: true,
      method: 'webhook',
      channel: settings.channel ?? '',
    })
  }

  // ③ 환경변수 Webhook URL (레거시 폴백)
  const webhookUrl = process.env.SLACK_WEBHOOK_URL
  if (webhookUrl && webhookUrl !== 'your_slack_webhook_url_here') {
    return NextResponse.json({ configured: true, method: 'webhook' })
  }

  return NextResponse.json({ configured: false })
}
