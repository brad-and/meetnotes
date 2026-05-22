import { NextRequest, NextResponse } from 'next/server'
import { readFileSync, writeFileSync, mkdirSync } from 'fs'
import { join } from 'path'

const SETTINGS_PATH = join(process.cwd(), 'data', 'slack-settings.json')

function readSettings(): Record<string, string> {
  try {
    return JSON.parse(readFileSync(SETTINGS_PATH, 'utf-8'))
  } catch {
    return {}
  }
}

export async function GET() {
  return NextResponse.json(readSettings())
}

export async function POST(req: NextRequest) {
  try {
    const body = await req.json() as Record<string, string>
    const updated = { ...readSettings(), ...body }
    mkdirSync(join(process.cwd(), 'data'), { recursive: true })
    writeFileSync(SETTINGS_PATH, JSON.stringify(updated, null, 2), 'utf-8')
    return NextResponse.json({ ok: true })
  } catch (e: unknown) {
    return NextResponse.json({ error: e instanceof Error ? e.message : String(e) }, { status: 500 })
  }
}
