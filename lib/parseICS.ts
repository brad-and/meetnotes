export interface CalendarEvent {
  id: string
  title: string
  start: string
  end: string
  attendees: string[]
  location?: string
  meetUrl?: string
}

/**
 * ICS 텍스트를 CalendarEvent 배열로 파싱 (외부 라이브러리 없음, RFC 5545 기반)
 */
export function parseICS(text: string, windowDays = 7): CalendarEvent[] {
  // Line unfolding: 다음 줄이 공백/탭으로 시작하면 이전 줄과 합침
  const unfolded = text
    .replace(/\r\n/g, '\n')
    .replace(/\r/g, '\n')
    .replace(/\n[ \t]/g, '')

  const events: CalendarEvent[] = []
  const blocks = unfolded.match(/BEGIN:VEVENT[\s\S]*?END:VEVENT/g) ?? []

  /** PROPERTY 또는 PROPERTY;PARAMS:value 에서 value 추출 */
  const getProp = (block: string, key: string): string => {
    const m = block.match(new RegExp(`^${key}(?:;[^\\r\\n]*?)?:([^\\r\\n]*)`, 'm'))
    return m ? m[1].trim() : ''
  }

  /** DTSTART / DTEND 에서 Date 객체 추출 */
  const parseDT = (block: string, key: string): Date | null => {
    const m = block.match(new RegExp(`^${key}(?:;[^\\r\\n]*?)?:([^\\r\\n]+)`, 'm'))
    if (!m) return null
    const raw = m[1].trim()

    // 종일 이벤트: YYYYMMDD
    if (/^\d{8}$/.test(raw)) {
      return new Date(`${raw.slice(0, 4)}-${raw.slice(4, 6)}-${raw.slice(6, 8)}T00:00:00+09:00`)
    }
    // UTC: YYYYMMDDTHHmmssZ
    if (raw.endsWith('Z')) {
      const d = raw.slice(0, -1)
      return new Date(
        `${d.slice(0, 4)}-${d.slice(4, 6)}-${d.slice(6, 8)}` +
        `T${d.slice(9, 11)}:${d.slice(11, 13)}:${d.slice(13, 15)}Z`
      )
    }
    // Local (TZID 무관 — Asia/Seoul = UTC+9 가정)
    return new Date(
      `${raw.slice(0, 4)}-${raw.slice(4, 6)}-${raw.slice(6, 8)}` +
      `T${raw.slice(9, 11)}:${raw.slice(11, 13)}:${raw.slice(13, 15) || '00'}+09:00`
    )
  }

  const now   = new Date(Date.now() - 60 * 60 * 1000)
  const limit = new Date(Date.now() + windowDays * 24 * 60 * 60 * 1000)

  for (const block of blocks) {
    if (getProp(block, 'STATUS') === 'CANCELLED') continue

    const start = parseDT(block, 'DTSTART')
    const end   = parseDT(block, 'DTEND') ?? parseDT(block, 'DTSTART')
    if (!start || !end) continue
    if (end < now || start > limit) continue

    const uid     = getProp(block, 'UID')
    const summary = getProp(block, 'SUMMARY')
      .replace(/\\,/g, ',').replace(/\\n/g, ' ').replace(/\\;/g, ';').trim()
    const rawLoc  = getProp(block, 'LOCATION')
      .replace(/\\,/g, ',').replace(/\\n/g, ' ').trim()
    const location = rawLoc || undefined

    // ATTENDEE 줄에서 mailto: 이메일만 추출
    const attendeeLines = block.match(/^ATTENDEE[^\n]*/mg) ?? []
    const attendees = attendeeLines
      .map(line => {
        const mm = line.match(/mailto:([^\s;,>\r\n]+)/i)
        return mm ? mm[1].toLowerCase().trim() : ''
      })
      .filter(e => e && !e.includes('resource.calendar'))

    // Google Meet URL 추출 (설명 or 위치)
    const desc      = getProp(block, 'DESCRIPTION').replace(/\\n/g, '\n').replace(/\\,/g, ',')
    const meetMatch = desc.match(/https:\/\/meet\.google\.com\/[a-z0-9-]+/)
    const locMatch  = rawLoc.match(/https:\/\/meet\.google\.com\/[a-z0-9-]+/)
    const meetUrl   = meetMatch?.[0] ?? locMatch?.[0]

    events.push({
      id:       uid,
      title:    summary || '(제목 없음)',
      start:    start.toISOString(),
      end:      end.toISOString(),
      attendees,
      location: rawLoc.startsWith('http') ? undefined : location,
      meetUrl,
    })
  }

  return events.sort((a, b) => new Date(a.start).getTime() - new Date(b.start).getTime())
}
