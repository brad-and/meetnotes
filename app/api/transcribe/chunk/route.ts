import { NextRequest, NextResponse } from 'next/server'
import OpenAI from 'openai'

// Whisper가 무음/저품질 오디오에서 반복 생성하는 한국어 할루시네이션 키워드
const HALLUCINATION_KEYWORDS = [
  '시청해주셔서', '시청해 주셔서',
  '다음 영상', '다음영상',
  '구독과 좋아요', '좋아요와 구독',
  '오늘 영상', '이번 영상',
  '자막 제공', '자막봉사',
  'MBC 뉴스', 'KBS 뉴스', 'SBS 뉴스',
  '영상이 도움', '도움이 됐다면',
  '여기까지입니다',
]

function isHallucination(text: string): boolean {
  const t = text.trim()
  if (!t || t === '.' || t === '...' || t === '♪' || t === '♫') return true
  return HALLUCINATION_KEYWORDS.some((k) => t.includes(k))
}

export async function POST(req: NextRequest) {
  const apiKey = process.env.OPENAI_API_KEY
  if (!apiKey) return NextResponse.json({ error: 'No API key' }, { status: 500 })

  const openai = new OpenAI({ apiKey })

  const formData = await req.formData()
  const audio = formData.get('audio') as File
  const startTime = parseInt((formData.get('startTime') as string) ?? '0')

  if (!audio || audio.size < 2000) {
    return NextResponse.json({ transcript: '' })
  }

  try {
    const transcription = await openai.audio.transcriptions.create({
      file: audio,
      model: 'whisper-1',
      language: 'ko',
      temperature: 0,
      prompt: '한국어 회의 대화입니다.',
    })

    const transcript = transcription.text.trim()
    if (isHallucination(transcript)) {
      return NextResponse.json({ transcript: '' })
    }

    return NextResponse.json({
      transcript,
      timestamp: formatTime(startTime),
    })
  } catch {
    return NextResponse.json({ transcript: '' })
  }
}

function formatTime(s: number) {
  const h = Math.floor(s / 3600).toString().padStart(2, '0')
  const m = Math.floor((s % 3600) / 60).toString().padStart(2, '0')
  const sec = (s % 60).toString().padStart(2, '0')
  return `${h}:${m}:${sec}`
}
