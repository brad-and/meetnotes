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

function toStr(v: unknown): string {
  if (typeof v === 'string') return v
  if (Array.isArray(v)) return (v as string[]).join('\n')
  return String(v ?? '')
}

const SLACK_BLOCK_LIMIT = 2900  // Slack 블록 텍스트 최대 3000자

// 긴 텍스트를 Slack 블록 한도에 맞게 분할해서 추가
// eslint-disable-next-line @typescript-eslint/no-explicit-any
function pushTextBlocks(blocks: any[], header: string, body: string) {
  const lines = body.split('\n')
  let chunk = `*${header}*\n`
  let first = true
  for (const line of lines) {
    const candidate = chunk + line + '\n'
    if (candidate.length > SLACK_BLOCK_LIMIT) {
      blocks.push({ type: 'section', text: { type: 'mrkdwn', text: chunk.trimEnd() } })
      chunk = first ? '' : ''  // 이어지는 블록은 헤더 없이
      first = false
      chunk = line + '\n'
    } else {
      chunk = candidate
    }
  }
  if (chunk.trim()) {
    blocks.push({ type: 'section', text: { type: 'mrkdwn', text: chunk.trimEnd() } })
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

  // ① 전체 회의 내용 (full 포맷만)
  if (format === 'full') {
    const detail = toStr(m.detail).trim()
    if (detail) {
      pushTextBlocks(blocks, '📝 전체 회의 내용', detail)
      blocks.push({ type: 'divider' })
    }
  }

  // ② 결정사항 (full + brief)
  if (format === 'full' || format === 'brief') {
    const coreText = toStr(m.core).trim()
    if (coreText) {
      const coreBullets = coreText.split('\n')
        .filter(Boolean)
        .map((l: string) => `• ${l.replace(/^\d+\.\s*/, '')}`)
        .join('\n')
      blocks.push({ type: 'section', text: { type: 'mrkdwn', text: `*결정사항*\n${coreBullets}` } })
    }
  }

  // ③ 액션 아이템 (전체 포맷)
  const actionLines = m.actions
    .map((a) => {
      const who = options.mention && a.assignee !== '미정' ? `<@${a.assignee}>` : a.assignee
      return `☐ ${a.text} — ${who}${a.due ? ` · ${a.due}` : ''}`
    })
    .join('\n')

  if (actionLines) {
    blocks.push({ type: 'section', text: { type: 'mrkdwn', text: `*액션 아이템*\n${actionLines}` } })
  }

  // ④ 다음 스텝 (full 포맷만)
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
