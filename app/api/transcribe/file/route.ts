import { NextRequest, NextResponse } from 'next/server'
import OpenAI from 'openai'

export async function POST(req: NextRequest) {
  const apiKey = process.env.OPENAI_API_KEY
  if (!apiKey) return NextResponse.json({ error: 'No API key' }, { status: 500 })

  const openai = new OpenAI({ apiKey })

  const formData = await req.formData()
  const file = formData.get('audio') as File
  if (!file) return NextResponse.json({ error: 'No audio file' }, { status: 400 })

  const transcription = await openai.audio.transcriptions.create({
    file,
    model: 'whisper-1',
    language: 'ko',
    response_format: 'verbose_json',
    timestamp_granularities: ['segment'],
  })

  const segments = (transcription as { segments?: { start: number; text: string }[] }).segments ?? []

  const utterances = segments
    .map((seg, i) => ({
      id: i.toString(),
      speaker: 'Speaker 0',
      speakerName: 'Speaker 0',
      text: seg.text.trim(),
      timestamp: formatTime(Math.floor(seg.start)),
      isFinal: true,
    }))
    .filter((u) => u.text.length > 0)

  if (utterances.length === 0 && transcription.text.trim()) {
    utterances.push({
      id: '0',
      speaker: 'Speaker 0',
      speakerName: 'Speaker 0',
      text: transcription.text.trim(),
      timestamp: '00:00:00',
      isFinal: true,
    })
  }

  return NextResponse.json({ utterances })
}

function formatTime(s: number) {
  const h = Math.floor(s / 3600).toString().padStart(2, '0')
  const m = Math.floor((s % 3600) / 60).toString().padStart(2, '0')
  const sec = (s % 60).toString().padStart(2, '0')
  return `${h}:${m}:${sec}`
}
