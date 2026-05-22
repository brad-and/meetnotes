import { NextRequest, NextResponse } from 'next/server'
import { writeFileSync, mkdirSync } from 'fs'
import { join } from 'path'
import type { CalendarEvent } from '@/lib/parseICS'

// 프론트에서 파싱된 이벤트를 받아 캐시 파일에 저장
export async function POST(req: NextRequest) {
  try {
    const body = await req.json() as { events: CalendarEvent[]; updatedAt?: string }

    if (!Array.isArray(body.events)) {
      return NextResponse.json({ error: 'events 배열이 필요해요.' }, { status: 400 })
    }

    const updatedAt = body.updatedAt ?? new Date().toISOString()

    const dataDir = join(process.cwd(), 'data')
    mkdirSync(dataDir, { recursive: true })
    writeFileSync(
      join(dataDir, 'calendar-cache.json'),
      JSON.stringify({ updatedAt, events: body.events }, null, 2),
      'utf-8'
    )

    return NextResponse.json({ ok: true, count: body.events.length, updatedAt })
  } catch (e: unknown) {
    const msg = e instanceof Error ? e.message : String(e)
    return NextResponse.json({ error: msg }, { status: 500 })
  }
}
