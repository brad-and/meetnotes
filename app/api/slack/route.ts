import { NextRequest, NextResponse } from 'next/server'
import { readFileSync } from 'fs'
import { join } from 'path'
import { MeetingMinutes } from '@/store/meetingStore'

function readSlackSettings(): Record<string, string> {
  try {
    return JSON.parse(readFileSync(join(process.cwd(), 'data', 'slack-settings.json'), 'utf-8'))
  } catch {
    return {}
  }
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function buildBlocks(title: string, m: MeetingMinutes, meta: { date: string; duration: string; participants: string }, format: string, options: { mention: boolean }): any[] {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const blocks: any[] = [
    { type: 'header', text: { type: 'plain_text', text: `📋 [회의록] ${title}` } },
    { type: 'context', elements: [{ type: 'mrkdwn', text: `📅 ${meta.date} · ⏱ ${meta.duration} · 👥 ${meta.participants}` }] },
    { type: 'divider' },
  ]

  if (format === 'full' || format === 'brief') {
    blocks.push({
      type: 'section',
      text: {
        type: 'mrkdwn',
        text: `*결정사항*\n${m.core.split('\n').map((l: string) => `• ${l.replace(/^\d+\.\s*/, '')}`).join('\n')}`,
      },
    })
  }

  const actionLines = m.actions
    .map((a) => {
      const who = options.mention && a.assignee !== '미정' ? `<@${a.assignee}>` : a.assignee
      return `☐ ${a.text} — ${who}${a.due ? ` · ${a.due}` : ''}`
    })
    .join('\n')

  if (actionLines) {
    blocks.push({ type: 'section', text: { type: 'mrkdwn', text: `*액션 아이템*\n${actionLines}` } })
  }

  if (format === 'full' && m.nextSteps?.length) {
    const nextLines = m.nextSteps.map((s, i) => `${i + 1}. ${s.title}`).join('\n')
    blocks.push({ type: 'section', text: { type: 'mrkdwn', text: `*다음 스텝 (AI 제안)*\n${nextLines}` } })
  }

  blocks.push({ type: 'divider' })
  blocks.push({ type: 'context', elements: [{ type: 'mrkdwn', text: `_MeetNotes AI로 자동 작성됨_` }] })
  return blocks
}

export async function POST(req: NextRequest) {
  try {
    const { minutes, title, channel, format = 'full', options = { mention: true }, meta } = await req.json()
    const m = minutes as MeetingMinutes
    const blocks = buildBlocks(title, m, meta, format, options)
    const text = `[회의록] ${title}`

    // ① OAuth 토큰 (쿠키)
    const oauthToken = req.cookies.get('slack_token')?.value
    if (oauthToken) {
      const res = await fetch('https://slack.com/api/chat.postMessage', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json; charset=utf-8', Authorization: `Bearer ${oauthToken}` },
        body: JSON.stringify({ channel, text, blocks }),
      })
      const data = await res.json()
      if (!data.ok) {
        if (data.error === 'not_in_channel') {
          const channelId = channel.startsWith('#') ? channel.slice(1) : channel
          await fetch('https://slack.com/api/conversations.join', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${oauthToken}` },
            body: JSON.stringify({ channel: channelId }),
          })
          const retry = await fetch('https://slack.com/api/chat.postMessage', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json; charset=utf-8', Authorization: `Bearer ${oauthToken}` },
            body: JSON.stringify({ channel, text, blocks }),
          })
          const retryData = await retry.json()
          if (!retryData.ok) throw new Error(retryData.error)
        } else {
          throw new Error(data.error)
        }
      }
      return NextResponse.json({ ok: true })
    }

    // ② 파일 설정 Webhook URL 우선, 없으면 env 폴백
    const slackSettings = readSlackSettings()
    const webhookUrl = slackSettings.webhookUrl
      || (process.env.SLACK_WEBHOOK_URL !== 'your_slack_webhook_url_here'
          ? process.env.SLACK_WEBHOOK_URL
          : undefined)

    if (!webhookUrl) {
      return NextResponse.json({ error: 'not_configured' }, { status: 400 })
    }

    // Webhook으로 전송 (fetch 직접 사용, @slack/webhook 의존성 제거)
    const whRes = await fetch(webhookUrl, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ text, blocks }),
    })

    if (!whRes.ok) {
      const body = await whRes.text()
      throw new Error(`Webhook 전송 실패: ${whRes.status} ${body}`)
    }

    return NextResponse.json({ ok: true })

  } catch (e: unknown) {
    const message = e instanceof Error ? e.message : 'Unknown error'
    console.error('Slack send error:', message)
    return NextResponse.json({ error: message }, { status: 500 })
  }
}
