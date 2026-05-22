import { NextRequest, NextResponse } from 'next/server'

// GET /api/slack/channels → 참여 가능한 채널 목록
export async function GET(req: NextRequest) {
  const token = req.cookies.get('slack_token')?.value
  if (!token) return NextResponse.json({ error: 'not_connected' }, { status: 401 })

  try {
    const res = await fetch(
      'https://slack.com/api/conversations.list?types=public_channel&exclude_archived=true&limit=100',
      { headers: { Authorization: `Bearer ${token}` } }
    )
    const data = await res.json()
    if (!data.ok) return NextResponse.json({ error: data.error }, { status: 400 })

    const channels = (data.channels as { id: string; name: string; is_member: boolean }[])
      .map((c) => ({ id: c.id, name: `#${c.name}`, isMember: c.is_member }))
      .sort((a, b) => a.name.localeCompare(b.name))

    return NextResponse.json({ channels })
  } catch (e) {
    console.error('channels error:', e)
    return NextResponse.json({ error: 'server_error' }, { status: 500 })
  }
}
