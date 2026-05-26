import { NextResponse } from 'next/server'
import { readFileSync } from 'fs'
import { join } from 'path'

export interface CalendarAttendee {
  email: string
  status: 'accepted' | 'tentative' | 'declined' | 'needsAction'
}

export interface CalendarEvent {
  id: string
  title: string
  start: string        // ISO 8601
  end: string
  /** GScript v2: CalendarAttendee[], 구형 캐시 호환: string[] */
  attendees: (CalendarAttendee | string)[]
  location?: string
  meetUrl?: string
}

export async function GET() {
  try {
    const cachePath = join(process.cwd(), 'data', 'calendar-cache.json')
    const raw = readFileSync(cachePath, 'utf-8')
    const cache = JSON.parse(raw) as { updatedAt: string; events: CalendarEvent[] }

    // 지나간 일정 제외 (현재 기준 -1시간 이전)
    const now = new Date(Date.now() - 60 * 60 * 1000)
    const events = cache.events
      .filter(e => new Date(e.end) >= now)
      .sort((a, b) => new Date(a.start).getTime() - new Date(b.start).getTime())

    return NextResponse.json({ events, updatedAt: cache.updatedAt })
  } catch (e: unknown) {
    const msg = e instanceof Error ? e.message : String(e)
    console.error('Calendar cache read error:', msg)
    return NextResponse.json({ error: 'not_configured' }, { status: 400 })
  }
}
