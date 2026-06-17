import { NextRequest, NextResponse } from 'next/server'
import { GoogleGenerativeAI, Part } from '@google/generative-ai'
import { jsonrepair } from 'jsonrepair'

const genAI = new GoogleGenerativeAI(process.env.GOOGLE_AI_API_KEY ?? '')
const MODEL_FALLBACK = ['gemini-2.5-flash', 'gemini-2.0-flash', 'gemini-1.5-flash']

// ── 사실 기반 절대 원칙 ───────────────────────────────────────────────────
const SYSTEM_INSTRUCTION = `당신은 회의록 작성 전문가입니다.

【절대 원칙 — 반드시 준수】
- 트랜스크립트(또는 오디오)에서 실제로 말한 내용만 기록합니다.
- 말하지 않은 내용을 절대 추가하거나 지어내지 마세요.
- 일반 상식, 업계 지식, 배경 설명을 임의로 보충하지 마세요.
- 발언자가 말하지 않은 의견을 해당 발언자의 것으로 쓰지 마세요.
- 담당자·기한·수치가 언급되지 않았으면 "미정"으로만 표기하세요.
- 트랜스크립트 내용이 짧거나 부족하면 있는 내용만 작성하고 부족하다고 명시하세요.
- 모든 서술은 3인칭 객관 시점으로 작성하세요. 1인칭 표현 금지.
- 응답은 순수 JSON만, 마크다운 코드블록 없이.`

function buildTextPrompt(title: string, participants: string[], transcript: string): string {
  return `회의 제목: ${title}
참여자: ${participants.join(', ')}

=== 트랜스크립트 (아래 내용만 근거로 사용) ===
${transcript}
=== 끝 ===

위 대화 내용만을 근거로 아래 JSON을 작성하세요.
대화에 없는 내용은 단 한 글자도 추가하지 마세요.

【detail — 3단계 사실 정리】
반드시 아래 3개 섹션으로 구성하세요:

[1단계: 주요 발언 요약]
- 실제 발언된 내용을 주제별로 묶어 정리합니다.
- 발언자가 구분되면 이름을 명시합니다. 예: "김민준은 ~라고 말했습니다."
- 대화에 언급된 숫자·날짜·고유명사를 그대로 씁니다.
- 대화에 없는 맥락·배경 설명을 추가하지 마세요.

[2단계: 명시적으로 결정된 사항]
- "~하기로 했다", "~로 결정했다", "~로 확정했다"고 말한 내용만 씁니다.
- 그런 말이 없었다면: "대화에서 명시적 결정사항이 확인되지 않습니다."

[3단계: 미결 및 보류 사항]
- "나중에", "다음에", "추후 확인" 등으로 미룬 내용만 씁니다.
- 없으면: "대화에서 미결 사항이 확인되지 않습니다."

【core】[2단계]에서 확정된 사항만 번호 목록. 없으면 "확인된 결정사항 없음".
【keywords】대화에서 2회 이상 언급된 단어만. 부족하면 실제 수만큼만 포함.
【actions】대화에서 "~할게요", "~부탁드립니다" 등 명시된 할 일만. 담당자·기한 미언급 시 "미정". 없으면 [].
【nextSteps】AI 제안 3개. 단, 대화에서 논의된 내용을 근거로 하고 reason에 "대화에서 ~가 언급됐기 때문에" 형식으로 근거 명시.

JSON 형식 (마크다운 없이):
{
  "utterances": [],
  "detail": "[1단계: 주요 발언 요약]\\n내용...\\n\\n[2단계: 명시적으로 결정된 사항]\\n내용...\\n\\n[3단계: 미결 및 보류 사항]\\n내용...",
  "core": "1. 결정사항 또는 확인된 결정사항 없음",
  "keywords": ["단어1","단어2"],
  "actions": [{"id":"1","text":"할 일","assignee":"담당자 또는 미정","due":"기한 또는 미정","priority":"high"}],
  "nextSteps": [{"title":"제목","reason":"대화에서 ~가 언급됐기 때문에..."}]
}`
}

function buildAudioPrompt(title: string, participants: string[]): string {
  return `회의 제목: ${title}
참여자: ${participants.join(', ')}

위 오디오를 한국어로 정확히 전사하고, 전사된 실제 대화 내용만을 근거로 회의록을 작성하세요.
오디오에 없는 내용을 절대 추가하지 마세요.

【utterances — 전사 결과】
- 발화 단위로 전사하세요.
- speaker는 "Speaker 0" 으로 통일.
- timestamp는 "00:00:00" 형식.

【detail — 3단계 사실 정리】
[1단계: 주요 발언 요약] / [2단계: 명시적으로 결정된 사항] / [3단계: 미결 및 보류 사항]
각 단계는 오디오에서 실제 확인된 내용만 기재. 없으면 "확인되지 않습니다." 명시.

【core】명시적으로 결정된 사항만. 없으면 "확인된 결정사항 없음".
【keywords】오디오에서 반복 언급된 단어만.
【actions】명시적으로 언급된 할 일만. 담당자·기한 미언급 시 "미정". 없으면 [].
【nextSteps】AI 제안 3개, 오디오 내용 근거 명시.

JSON 형식 (마크다운 없이):
{
  "utterances": [{"speaker":"Speaker 0","speakerName":"Speaker 0","text":"발화","timestamp":"00:00:00","isFinal":true}],
  "detail": "[1단계: 주요 발언 요약]\\n내용...\\n\\n[2단계: 명시적으로 결정된 사항]\\n내용...\\n\\n[3단계: 미결 및 보류 사항]\\n내용...",
  "core": "1. 결정사항 또는 확인된 결정사항 없음",
  "keywords": ["단어1","단어2"],
  "actions": [{"id":"1","text":"할 일","assignee":"담당자 또는 미정","due":"기한 또는 미정","priority":"high"}],
  "nextSteps": [{"title":"제목","reason":"오디오에서 ~가 언급됐기 때문에..."}]
}`
}

async function generate(parts: (string | Part)[]): Promise<string> {
  for (const modelName of MODEL_FALLBACK) {
    const model = genAI.getGenerativeModel({
      model: modelName,
      systemInstruction: SYSTEM_INSTRUCTION,
      generationConfig: {
        temperature: 0,
        responseMimeType: 'application/json',
        maxOutputTokens: 8192,
      },
    })
    for (let attempt = 0; attempt < 2; attempt++) {
      try {
        const result = await model.generateContent(parts)
        return result.response.text()
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err)
        const retryable = msg.includes('503') || msg.includes('high demand') || msg.includes('temporarily') || msg.includes('overloaded')
        if (!retryable) throw err
        if (attempt === 0) await new Promise((r) => setTimeout(r, 2000))
      }
    }
  }
  throw new Error('모든 Gemini 모델에서 오류가 발생했습니다. 잠시 후 다시 시도해주세요.')
}

export async function POST(req: NextRequest) {
  try {
    const contentType = req.headers.get('content-type') ?? ''
    let parts: (string | Part)[] = []
    let participants: string[] = []
    let title = ''
    let isAudio = false

    if (contentType.includes('multipart/form-data')) {
      const formData = await req.formData()
      const audioFile = formData.get('audio') as File | null
      participants = JSON.parse((formData.get('participants') as string) ?? '[]')
      title = (formData.get('title') as string) ?? ''

      if (audioFile && audioFile.size > 0) {
        const audioBase64 = Buffer.from(await audioFile.arrayBuffer()).toString('base64')
        parts = [
          { inlineData: { mimeType: audioFile.type || 'audio/webm', data: audioBase64 } },
          buildAudioPrompt(title, participants),
        ]
        isAudio = true
      }
    } else {
      const body = await req.json()
      const transcript: string = body.transcript ?? ''
      participants = body.participants ?? []
      title = body.title ?? ''
      parts = [buildTextPrompt(title, participants, transcript)]
    }

    if (!isAudio && parts.length === 0) {
      return NextResponse.json({ error: '분석할 내용이 없습니다.' }, { status: 400 })
    }

    const text = await generate(parts)
    const match = text.match(/\{[\s\S]*\}/)
    if (!match) {
      return NextResponse.json({ error: 'JSON 파싱 실패', raw: text }, { status: 500 })
    }

    let raw: Record<string, unknown>
    try {
      raw = JSON.parse(match[0])
    } catch {
      try {
        raw = JSON.parse(jsonrepair(match[0]))
      } catch (e2) {
        return NextResponse.json({ error: `JSON 파싱 실패: ${e2}` }, { status: 500 })
      }
    }

    const toStr = (v: unknown): string => {
      if (typeof v === 'string') return v
      if (Array.isArray(v)) return v.join('\n')
      return String(v ?? '')
    }

    const minutes = {
      detail:    toStr(raw.detail),
      core:      toStr(raw.core),
      keywords:  Array.isArray(raw.keywords)  ? raw.keywords  : [],
      actions:   Array.isArray(raw.actions)   ? raw.actions   : [],
      nextSteps: Array.isArray(raw.nextSteps) ? raw.nextSteps : [],
    }
    const utterancesFromAudio = Array.isArray(raw.utterances) ? raw.utterances : []
    return NextResponse.json({ minutes, utterances: utterancesFromAudio })
  } catch (e) {
    const message = e instanceof Error ? e.message : String(e)
    return NextResponse.json({ error: message }, { status: 500 })
  }
}
