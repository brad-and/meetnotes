import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@supabase/supabase-js'

function getSupabase() {
  return createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!
  )
}

// GET /api/meetings — 전체 목록 조회
export async function GET() {
  try {
    const supabase = getSupabase()
    const { data, error } = await supabase
      .from('meetings')
      .select('*')
      .order('created_at', { ascending: false })

    if (error) throw error
    return NextResponse.json(data ?? [])
  } catch (e: unknown) {
    const message = e instanceof Error ? e.message : 'Unknown error'
    return NextResponse.json({ error: message }, { status: 500 })
  }
}

// POST /api/meetings — 회의록 저장
export async function POST(req: NextRequest) {
  try {
    const body = await req.json()
    const supabase = getSupabase()

    const { data, error } = await supabase
      .from('meetings')
      .insert({
        id: body.id,
        title: body.title,
        date: body.date,
        duration: body.duration,
        participants: body.participants,
        minutes: body.minutes,
        utterances: body.utterances ?? [],
        slack_sent: body.slackSent ?? false,
        archived: body.archived ?? false,
      })
      .select()
      .single()

    if (error) throw error
    return NextResponse.json(data)
  } catch (e: unknown) {
    const message = e instanceof Error ? e.message : 'Unknown error'
    return NextResponse.json({ error: message }, { status: 500 })
  }
}
