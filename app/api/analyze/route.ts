import { NextRequest, NextResponse } from 'next/server'
import { GoogleGenerativeAI, Part } from '@google/generative-ai'
import { jsonrepair } from 'jsonrepair'

const genAI = new GoogleGenerativeAI(process.env.GOOGLE_AI_API_KEY ?? '')

// 503 과부하 시 재시도 + 모델 폴백
const MODEL_FALLBACK = ['gemini-2.5-flash', 'gemini-2.0-flash', 'gemini-1.5-flash']

async function generateWithFallback(parts: (string | Part)[]): Promise<string> {
  for (const modelName of MODEL_FALLBACK) {
    const model = genAI.getGenerativeModel({
      model: modelName,
      generationConfig: { responseMimeType: 'application/json', maxOutputTokens: 16384 },
    })
    for (let attempt = 0; attempt < 2; attempt++) {
      try {
        const result = await model.generateContent(parts)
        return result.response.text()
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err)
        const retryable = msg.includes('503') || msg.includes('high demand') || msg.includes('temporarily')
        if (!retryable) throw err
        if (attempt === 0) await new Promise((r) => setTimeout(r, 2000))
      }
    }
  }
  throw new Error('모든 Gemini 모델에서 503 오류가 발생했습니다. 잠시 후 다시 시도해주세요.')
}

export async function POST(req: NextRequest) {
  try {
    const contentType = req.headers.get('content-type') ?? ''
    let transcript = ''
    let participants: string[] = []
    let title = ''
    let audioBase64 = ''
    let audioMimeType = ''

    if (contentType.includes('multipart/form-data')) {
      const formData = await req.formData()
      const audioFile = formData.get('audio') as File | null
      participants = JSON.parse((formData.get('participants') as string) ?? '[]')
      title = (formData.get('title') as string) ?? ''
      if (audioFile && audioFile.size > 0) {
        audioBase64 = Buffer.from(await audioFile.arrayBuffer()).toString('base64')
        audioMimeType = audioFile.type || 'audio/webm'
      }
    } else {
      const body = await req.json()
      transcript = body.transcript ?? ''
      participants = body.participants ?? []
      title = body.title ?? ''
    }

    // Build Gemini content parts
    const parts: (string | Part)[] = []
    if (audioBase64) {
      parts.push({ inlineData: { mimeType: audioMimeType, data: audioBase64 } })
    }

    const transcriptSection = audioBase64
      ? '위 오디오를 한국어로 정확히 전사하고, 전사된 내용을 바탕으로 회의록을 작성해주세요.'
      : `트랜스크립트:\n${transcript}`

    parts.push(`당신은 회의록 전문 AI 작성자입니다.

회의 제목: ${title}
참여자: ${participants.join(', ')}

${transcriptSection}

${audioBase64 ? `=== 전사 및 회의록 작성 지침 ===

【utterances 필드 — 전사 결과】
- 오디오 내용을 발화 단위로 전사하세요
- speaker는 "Speaker 0"으로 통일 (화자 구분 없이)
- timestamp는 "00:00:00" 형식
- 각 문장/발화를 별도 utterance로

【detail 필드】
- 주제별 섹션으로 나누어 작성 "[주제명]" 헤더 사용
- 논의 배경, 의견, 결론 포함

【core 필드】
- 최종 확정 사항만 번호 목록

【나머지 필드】
- keywords: 핵심 용어 8개
- actions: 담당자·기한이 명확한 할 일
- nextSteps: AI 제안 후속 행동 3가지

다음 JSON 형식으로만 응답 (마크다운 없이):
{
  "utterances": [{"speaker": "Speaker 0", "speakerName": "Speaker 0", "text": "발화내용", "timestamp": "00:00:00", "isFinal": true}],
  "detail": "...",
  "core": "...",
  "keywords": ["키워드1","키워드2","키워드3","키워드4","키워드5","키워드6","키워드7","키워드8"],
  "actions": [{"id":"1","text":"액션","assignee":"담당자","due":"기한","priority":"high"}],
  "nextSteps": [{"title":"제목","reason":"이유"}]
}` : `=== 작성 지침 ===

【공통 — 서술 시점 및 어조】
- 모든 내용은 반드시 3인칭 객관적 시점으로 서술하세요.
  예) "brad.and는 ~라고 언급했습니다", "참석자들은 ~에 합의했습니다"
- "나는", "저는", "우리는" 등 1인칭 표현을 절대 사용하지 마세요.
- 트랜스크립트에서 발언자 구분이 불명확하거나 한 명에게만 기록된 경우에도, 해당 발언자의 이름을 명시하며 객관적으로 서술하세요.
- 발언 내용을 직접 인용할 때는 따옴표("")를 사용하세요.

【detail 필드 — 주제별 상세 회의록】
- 트랜스크립트에서 논의된 모든 안건을 주제별 섹션으로 나누어 작성하세요.
- 각 섹션 시작은 반드시 "[주제명]" 형식의 헤더로 표시하세요. 예: [1. 스프린트 일정 조정]
- 각 주제 아래에 다음 내용을 모두 포함하세요:
  · 논의 배경 및 현황
  · 참석자별 의견 및 근거 (발언자가 구분된 경우 이름 포함)
  · 대안 검토 및 찬반 의견
  · 해당 주제의 결론 또는 미결 사항
- 생략·압축 금지. 트랜스크립트에 언급된 구체적 수치, 날짜, 이름, 기능명을 그대로 활용하세요.
- 회의 길이에 비례해 분량을 확보하세요 (30분 → 최소 1000자, 1시간 → 최소 2000자).

【core 필드 — 핵심 결정사항】
- 회의에서 최종 확정된 사항만 번호 목록으로 작성하세요 (미결·보류 사항 제외).
- 형식: "1. [결정 내용]" (줄바꿈으로 구분)

【나머지 필드】
- keywords: 회의에서 반복 언급된 핵심 용어 8개
- actions: 담당자·기한이 명확히 정해진 할 일만 포함
- nextSteps: AI가 제안하는 후속 행동 3가지

다음 JSON 형식으로만 응답해주세요 (마크다운 코드블록 없이 순수 JSON):
{
  "utterances": [],
  "detail": "[주제 1: 제목]\\n내용...\\n\\n[주제 2: 제목]\\n내용...",
  "core": "1. 결정사항\\n2. 결정사항",
  "keywords": ["키워드1", "키워드2", "키워드3", "키워드4", "키워드5", "키워드6", "키워드7", "키워드8"],
  "actions": [
    {
      "id": "1",
      "text": "액션 아이템 내용",
      "assignee": "담당자 이름",
      "due": "기한 (예: 이번 주 내, 05.28까지)",
      "priority": "high"
    }
  ],
  "nextSteps": [
    {
      "title": "다음 스텝 제목",
      "reason": "이 스텝이 필요한 이유 (1-2문장)"
    }
  ]
}

주의사항:
- actions의 priority는 "high", "medium", "low" 중 하나
- nextSteps는 정확히 3개
- 트랜스크립트에 없는 내용을 추가하거나 변조하지 마세요
- 담당자가 불명확하면 "미정"으로 표기`}`)

    const text = await generateWithFallback(parts)

    const match = text.match(/\{[\s\S]*\}/)
    if (match) {
      /**
       * Gemini JSON 수정 3-레이어 전략:
       *  Layer 1 — sanitizeJson 상태 머신:
       *    · raw 제어문자 (0x00-0x1F) → 이스케이프
       *    · 잘못된 이스케이프 시퀀스 (\명 \k 등) → \\ 로 변환
       *    · 잘못된 이스케이프 뒤 제어문자도 이스케이프 처리 (기존 버그 수정)
       *  Layer 2 — jsonrepair:
       *    · 이스케이프되지 않은 따옴표, trailing comma, 누락 쉼표 등 처리
       *  Layer 3 — 에러 반환 (두 방법 모두 실패 시)
       */
      const sanitizeJson = (s: string): string => {
        const VALID_ESC = new Set(['"', '\\', '/', 'b', 'f', 'n', 'r', 't', 'u'])
        const escapeControlChar = (ch: string): string => {
          if (ch === '\n') return '\\n'
          if (ch === '\r') return '\\r'
          if (ch === '\t') return '\\t'
          const code = ch.charCodeAt(0)
          if (code < 0x20) return `\\u${code.toString(16).padStart(4, '0')}`
          return ch
        }
        let out = ''
        let inStr = false
        let esc = false
        for (const ch of s) {
          if (esc) {
            if (VALID_ESC.has(ch)) {
              out += ch                       // 유효한 이스케이프 → 그대로
            } else {
              // 잘못된 이스케이프: 백슬래시를 \\로 변환 + 현재 문자도 제어문자면 이스케이프
              out = out.slice(0, -1) + '\\\\' + escapeControlChar(ch)
            }
            esc = false
            continue
          }
          if (ch === '\\' && inStr) { out += ch; esc = true; continue }
          if (ch === '"') { out += ch; inStr = !inStr; continue }
          if (inStr) {
            const escaped = escapeControlChar(ch)
            if (escaped !== ch) { out += escaped; continue }
          }
          out += ch
        }
        return out
      }

      let raw: Record<string, unknown>
      try {
        // Layer 1: 상태 머신 sanitize
        raw = JSON.parse(sanitizeJson(match[0]))
      } catch (parseErr1) {
        console.warn('sanitizeJson parse failed, trying jsonrepair:', parseErr1)
        console.warn('Raw text (first 500):', text.slice(0, 500))
        try {
          // Layer 2: sanitize 후 jsonrepair (unescaped quotes, trailing commas 등 처리)
          raw = JSON.parse(jsonrepair(sanitizeJson(match[0])))
          console.log('jsonrepair succeeded')
        } catch (parseErr2) {
          console.error('JSON parse failed after jsonrepair:', parseErr2)
          return NextResponse.json({ error: `JSON 파싱 실패: ${parseErr2 instanceof Error ? parseErr2.message : String(parseErr2)}` }, { status: 500 })
        }
      }

      // Gemini가 string 필드를 배열로 반환하는 경우 방어적 정규화
      const toStr = (v: unknown): string => {
        if (typeof v === 'string') return v
        if (Array.isArray(v)) return v.join('\n')
        return String(v ?? '')
      }
      const utterancesFromAudio = Array.isArray(raw.utterances) ? raw.utterances : []
      const minutes = {
        detail: toStr(raw.detail),
        core:   toStr(raw.core),
        keywords: raw.keywords,
        actions: raw.actions,
        nextSteps: raw.nextSteps,
      }
      return NextResponse.json({ minutes, utterances: utterancesFromAudio })
    }
    return NextResponse.json({ error: 'JSON 파싱 실패', raw: text }, { status: 500 })
  } catch (e) {
    const message = e instanceof Error ? e.message : String(e)
    return NextResponse.json({ error: message }, { status: 500 })
  }
}
