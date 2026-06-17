import { NextRequest, NextResponse } from 'next/server'
import Anthropic from '@anthropic-ai/sdk'

const anthropic = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY ?? '' })

// ── 시스템 프롬프트: 사실 기반 절대 원칙 ─────────────────────────────────
const SYSTEM_PROMPT = `당신은 회의록 전문 AI 작성자입니다. 다음 원칙을 절대 준수하세요.

【절대 금지 사항】
- 트랜스크립트에 없는 내용을 단 한 글자도 추가하지 마세요.
- "아마", "것 같습니다", "추정됩니다" 등 불확실한 표현으로 내용을 채우지 마세요.
- 일반 상식이나 업계 지식으로 빈칸을 채우지 마세요.
- 언급되지 않은 담당자, 날짜, 수치를 임의로 기입하지 마세요.
- 참석자가 말하지 않은 의견을 해당 참석자의 것으로 서술하지 마세요.

【사실 기반 원칙】
- 모든 서술은 트랜스크립트에서 직접 확인할 수 있는 내용만 포함합니다.
- 발언자가 명확하면 이름을 명시하고, 불명확하면 "참석자"로 표기합니다.
- 수치·날짜·고유명사는 트랜스크립트에 언급된 그대로만 사용합니다.
- 트랜스크립트가 짧거나 내용이 부족하면, 있는 내용만 기록하고 "트랜스크립트 내용이 부족합니다"라고 명시합니다.
- 모든 내용은 3인칭 객관적 시점으로 서술합니다. 1인칭 표현 금지.

응답은 반드시 순수 JSON만, 마크다운 코드블록 없이.`

// ── 3단계 사실 기반 구조 ──────────────────────────────────────────────────
function buildPrompt(title: string, participants: string[], transcript: string): string {
  return `회의 제목: ${title}
참여자: ${participants.join(', ')}

=== 아래가 분석할 트랜스크립트 전문입니다 ===
${transcript}
=== 트랜스크립트 끝 ===

위 트랜스크립트만을 근거로 아래 JSON을 작성하세요.
트랜스크립트에 없는 내용은 절대 포함하지 마세요.

【detail 필드 — 3단계 사실 기반 회의록】
반드시 다음 3개의 섹션으로 구성하세요:

[1단계: 주요 발언 및 논의 내용]
- 트랜스크립트에서 실제로 언급된 주제와 발언을 주제별로 정리합니다.
- 각 주제는 "[주제명]" 헤더로 구분합니다.
- 발언자가 특정되면 이름을 명시합니다. 예: "김민준은 ~라고 언급했습니다."
- 언급된 수치, 날짜, 기능명을 그대로 인용합니다.
- 트랜스크립트에 없는 배경 설명이나 맥락을 추가하지 마세요.

[2단계: 명시적 결정사항]
- 참석자들이 회의 중 "~하기로 했다", "~로 결정됐다", "~로 확정됐다"고 명시한 사항만 작성합니다.
- 결정이 트랜스크립트에 명시되지 않았다면 "명시적으로 결정된 사항이 확인되지 않습니다."라고 기재합니다.

[3단계: 미결 사항 및 보류]
- "다음에 논의", "추후 확인", "검토 필요" 등 미결로 남겨진 항목만 기재합니다.
- 해당 내용이 없으면 "트랜스크립트에서 미결 사항이 확인되지 않습니다."라고 기재합니다.

【core 필드】
- [2단계: 명시적 결정사항]에서 확정된 사항만 번호 목록으로 작성합니다.
- 결정사항이 없으면 "트랜스크립트에서 명시적 결정사항이 확인되지 않습니다."

【keywords 필드】
- 트랜스크립트에서 2회 이상 반복 언급된 용어만 포함합니다.
- 1회만 언급됐어도 핵심 주제어라면 포함 가능합니다.
- 8개를 채우기 어려우면 실제 언급된 개수만 포함합니다.

【actions 필드】
- 트랜스크립트에서 "~해야 한다", "~하겠다", "~부탁드립니다" 등 명시적으로 언급된 할 일만 포함합니다.
- 담당자가 트랜스크립트에 명시되지 않으면 assignee는 반드시 "미정"으로 기입합니다.
- 기한이 언급되지 않으면 due는 "미정"으로 기입합니다.
- 할 일이 언급되지 않으면 빈 배열 []을 반환합니다.

【nextSteps 필드】
- 이 항목만 AI 제안을 허용합니다. 단, 트랜스크립트에서 논의된 내용을 근거로 합니다.
- 정확히 3개를 제안합니다.
- 각 제안의 reason에 "트랜스크립트에서 ~가 논의됐기 때문에"처럼 근거를 명시합니다.

다음 JSON 형식으로만 응답 (마크다운 없이):
{
  "utterances": [],
  "detail": "[1단계: 주요 발언 및 논의 내용]\\n[주제명]\\n내용...\\n\\n[2단계: 명시적 결정사항]\\n내용...\\n\\n[3단계: 미결 사항 및 보류]\\n내용...",
  "core": "1. 결정사항\\n2. 결정사항",
  "keywords": ["키워드1","키워드2","키워드3","키워드4","키워드5","키워드6","키워드7","키워드8"],
  "actions": [{"id":"1","text":"액션 내용","assignee":"담당자 또는 미정","due":"기한 또는 미정","priority":"high"}],
  "nextSteps": [{"title":"제목","reason":"트랜스크립트 근거 포함한 이유"}]
}`
}

export async function POST(req: NextRequest) {
  try {
    const contentType = req.headers.get('content-type') ?? ''
    let transcript = ''
    let participants: string[] = []
    let title = ''

    if (contentType.includes('multipart/form-data')) {
      const formData = await req.formData()
      const audioFile = formData.get('audio') as File | null
      participants = JSON.parse((formData.get('participants') as string) ?? '[]')
      title = (formData.get('title') as string) ?? ''

      if (audioFile && audioFile.size > 0) {
        // Claude는 오디오 미지원 → Deepgram으로 전사 후 Claude 분석
        const audioBuffer = await audioFile.arrayBuffer()
        const dgRes = await fetch(
          'https://api.deepgram.com/v1/listen?language=ko&punctuate=true&diarize=true&model=nova-2',
          {
            method: 'POST',
            headers: {
              Authorization: `Token ${process.env.DEEPGRAM_API_KEY}`,
              'Content-Type': audioFile.type || 'audio/webm',
            },
            body: audioBuffer,
          }
        )
        if (!dgRes.ok) {
          return NextResponse.json({ error: `Deepgram 전사 실패: ${dgRes.status}` }, { status: 500 })
        }
        const dgData = await dgRes.json()
        const words = dgData?.results?.channels?.[0]?.alternatives?.[0]?.words ?? []
        const lines: string[] = []
        let currentSpeaker = ''
        let currentLine = ''
        for (const w of words) {
          const speaker = `Speaker ${w.speaker ?? 0}`
          if (speaker !== currentSpeaker) {
            if (currentLine) lines.push(`${currentSpeaker}: ${currentLine.trim()}`)
            currentSpeaker = speaker
            currentLine = w.punctuated_word ?? w.word ?? ''
          } else {
            currentLine += ' ' + (w.punctuated_word ?? w.word ?? '')
          }
        }
        if (currentLine) lines.push(`${currentSpeaker}: ${currentLine.trim()}`)
        const fallback = dgData?.results?.channels?.[0]?.alternatives?.[0]?.transcript ?? ''
        // Deepgram이 음성을 인식하지 못한 경우 → 빈 트랜스크립트 명시 후 계속 진행
        transcript = lines.join('\n') || fallback || '(오디오에서 음성이 감지되지 않았습니다)'
      } else {
        // 오디오 파일 없음 — 빈 트랜스크립트로 처리
        transcript = '(오디오 파일이 없습니다)'
      }
    } else {
      const body = await req.json()
      transcript = body.transcript ?? ''
      participants = body.participants ?? []
      title = body.title ?? ''
    }

    if (!transcript.trim()) {
      return NextResponse.json({ error: '분석할 트랜스크립트가 없습니다.' }, { status: 400 })
    }

    const message = await anthropic.messages.create({
      model: 'claude-sonnet-4-6',
      max_tokens: 8192,
      temperature: 0,        // 사실 기반 — 가장 결정론적 출력
      system: SYSTEM_PROMPT,
      messages: [{ role: 'user', content: buildPrompt(title, participants, transcript) }],
    })

    const text = message.content[0].type === 'text' ? message.content[0].text : ''
    const match = text.match(/\{[\s\S]*\}/)
    if (!match) {
      return NextResponse.json({ error: 'JSON 파싱 실패', raw: text }, { status: 500 })
    }

    let raw: Record<string, unknown>
    try {
      raw = JSON.parse(match[0])
    } catch {
      const { jsonrepair } = await import('jsonrepair')
      raw = JSON.parse(jsonrepair(match[0]))
    }

    const toStr = (v: unknown): string => {
      if (typeof v === 'string') return v
      if (Array.isArray(v)) return v.join('\n')
      return String(v ?? '')
    }

    const minutes = {
      detail:    toStr(raw.detail),
      core:      toStr(raw.core),
      keywords:  Array.isArray(raw.keywords) ? raw.keywords : [],
      actions:   Array.isArray(raw.actions)  ? raw.actions  : [],
      nextSteps: Array.isArray(raw.nextSteps) ? raw.nextSteps : [],
    }
    return NextResponse.json({ minutes, utterances: [] })
  } catch (e) {
    const message = e instanceof Error ? e.message : String(e)
    return NextResponse.json({ error: message }, { status: 500 })
  }
}
