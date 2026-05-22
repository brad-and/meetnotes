import { NextResponse } from 'next/server'
import { writeFileSync, mkdirSync, readFileSync } from 'fs'
import { join } from 'path'
import { parseICS, type CalendarEvent } from '@/lib/parseICS'

function readSettings(): Record<string, string> {
  try {
    return JSON.parse(readFileSync(join(process.cwd(), 'data', 'calendar-settings.json'), 'utf-8'))
  } catch { return {} }
}

function saveCache(events: CalendarEvent[], updatedAt: string) {
  const dataDir = join(process.cwd(), 'data')
  mkdirSync(dataDir, { recursive: true })
  writeFileSync(
    join(dataDir, 'calendar-cache.json'),
    JSON.stringify({ updatedAt, events }, null, 2),
    'utf-8'
  )
}

export async function POST() {
  const settings = readSettings()
  const gscriptUrl = settings.gscriptUrl
  const icsUrl     = process.env.GOOGLE_CALENDAR_ICS_URL

  // ① Apps Script URL (익명 배포) 우선 시도
  if (gscriptUrl) {
    try {
      const res = await fetch(gscriptUrl, { cache: 'no-store' })
      if (!res.ok) throw new Error(`HTTP ${res.status}`)

      const data = await res.json() as { events: CalendarEvent[]; updatedAt?: string }
      if (!Array.isArray(data.events)) throw new Error('events 배열이 없어요.')

      const now   = new Date(Date.now() - 60 * 60 * 1000)
      const limit = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000)

      // 반복 일정은 Google이 같은 base ID를 재사용 → id+start 조합으로 고유 ID 부여
      const seenIds = new Set<string>()
      const events = data.events
        .filter(e => new Date(e.end) >= now && new Date(e.start) <= limit)
        .filter(e => (e.attendees ?? []).filter(a => !a.includes('resource.calendar')).length > 0)
        .map(e => {
          const uniqueId = seenIds.has(e.id) ? `${e.id}_${e.start}` : e.id
          seenIds.add(e.id)
          return {
            ...e,
            id: uniqueId,
            attendees: (e.attendees ?? []).filter(a => !a.includes('resource.calendar')),
            location:  e.location?.replace(/ \(\d+\)$/, '') ?? undefined,
          }
        })
        .sort((a, b) => new Date(a.start).getTime() - new Date(b.start).getTime())

      const updatedAt = data.updatedAt ?? new Date().toISOString()
      saveCache(events, updatedAt)
      return NextResponse.json({ events, updatedAt })
    } catch (e) {
      console.error('Apps Script fetch failed:', e)
      // fallthrough to iCal
    }
  }

  // ② iCal URL 폴백
  if (icsUrl && !icsUrl.includes('public/basic')) {
    try {
      const res = await fetch(icsUrl, { cache: 'no-store' })
      if (!res.ok) throw new Error(`HTTP ${res.status}`)
      const text = await res.text()
      if (!text.includes('BEGIN:VCALENDAR')) throw new Error('iCal 형식이 아니에요.')
      const events    = parseICS(text)
      const updatedAt = new Date().toISOString()
      saveCache(events, updatedAt)
      return NextResponse.json({ events, updatedAt })
    } catch (e) {
      console.error('iCal fetch failed:', e)
    }
  }

  return NextResponse.json(
    { error: 'Apps Script URL 또는 iCal URL이 설정되지 않았거나 접근할 수 없어요.' },
    { status: 400 }
  )
}
