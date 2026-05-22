import { NextRequest, NextResponse } from 'next/server'
import { writeFileSync, mkdirSync } from 'fs'
import { join } from 'path'
import { parseICS } from '@/lib/parseICS'

export async function POST(req: NextRequest) {
  try {
    const formData = await req.formData()
    const file = formData.get('file')

    if (!file || typeof file === 'string') {
      return NextResponse.json({ error: 'ICS 파일이 없어요.' }, { status: 400 })
    }

    const text = await (file as File).text()

    if (!text.includes('BEGIN:VCALENDAR')) {
      return NextResponse.json({ error: '올바른 ICS 파일이 아니에요.' }, { status: 400 })
    }

    const events    = parseICS(text)
    const updatedAt = new Date().toISOString()

    const dataDir = join(process.cwd(), 'data')
    mkdirSync(dataDir, { recursive: true })
    writeFileSync(
      join(dataDir, 'calendar-cache.json'),
      JSON.stringify({ updatedAt, events }, null, 2),
      'utf-8'
    )

    return NextResponse.json({ events, updatedAt })
  } catch (e: unknown) {
    const msg = e instanceof Error ? e.message : String(e)
    console.error('Calendar upload error:', msg)
    return NextResponse.json({ error: msg }, { status: 500 })
  }
}
