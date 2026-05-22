import { NextRequest, NextResponse } from 'next/server'

export async function POST(req: NextRequest) {
  const apiKey = process.env.DEEPGRAM_API_KEY
  if (!apiKey) return NextResponse.json({ error: 'No API key' }, { status: 500 })

  const formData = await req.formData()
  const file = formData.get('audio') as File
  if (!file) return NextResponse.json({ error: 'No audio file' }, { status: 400 })

  const arrayBuffer = await file.arrayBuffer()

  const response = await fetch(
    'https://api.deepgram.com/v1/listen?language=ko&model=nova-2&diarize=true&punctuate=true&utterances=true',
    {
      method: 'POST',
      headers: {
        Authorization: `Token ${apiKey}`,
        'Content-Type': file.type || 'audio/mpeg',
      },
      body: arrayBuffer,
    }
  )

  if (!response.ok) {
    const err = await response.text()
    return NextResponse.json({ error: err }, { status: response.status })
  }

  const data = await response.json()

  // Extract utterances from diarized result
  const utterances = (data.results?.utterances ?? []).map(
    (u: { speaker: number; transcript: string; start: number }, i: number) => ({
      id: i.toString(),
      speaker: `Speaker ${u.speaker}`,
      speakerName: `Speaker ${u.speaker}`,
      text: u.transcript,
      timestamp: formatTime(Math.floor(u.start)),
      isFinal: true,
    })
  )

  // Fallback: if no utterances, use channel alternatives
  if (utterances.length === 0) {
    const words = data.results?.channels?.[0]?.alternatives?.[0]?.words ?? []
    let current = { speaker: -1, texts: [] as string[], start: 0 }
    const result = []
    for (const w of words) {
      if (w.speaker !== current.speaker) {
        if (current.texts.length > 0) {
          result.push({
            id: result.length.toString(),
            speaker: `Speaker ${current.speaker}`,
            speakerName: `Speaker ${current.speaker}`,
            text: current.texts.join(' '),
            timestamp: formatTime(Math.floor(current.start)),
            isFinal: true,
          })
        }
        current = { speaker: w.speaker, texts: [w.word], start: w.start }
      } else {
        current.texts.push(w.word)
      }
    }
    if (current.texts.length > 0) {
      result.push({
        id: result.length.toString(),
        speaker: `Speaker ${current.speaker}`,
        speakerName: `Speaker ${current.speaker}`,
        text: current.texts.join(' '),
        timestamp: formatTime(Math.floor(current.start)),
        isFinal: true,
      })
    }
    return NextResponse.json({ utterances: result })
  }

  return NextResponse.json({ utterances })
}

function formatTime(s: number) {
  const h = Math.floor(s / 3600).toString().padStart(2, '0')
  const m = Math.floor((s % 3600) / 60).toString().padStart(2, '0')
  const sec = (s % 60).toString().padStart(2, '0')
  return `${h}:${m}:${sec}`
}
