import { NextRequest, NextResponse } from 'next/server'
import { GoogleGenerativeAI } from '@google/generative-ai'

const genAI = new GoogleGenerativeAI(process.env.GOOGLE_AI_API_KEY ?? '')

export async function POST(req: NextRequest) {
  try {
    const { transcript, participants, title } = await req.json()

    const prompt = `당신은 회의록 전문 AI 작성자입니다. 아래 회의 트랜스크립트를 빠짐없이 분석해 상세한 공식 회의록을 작성해주세요.

회의 제목: ${title}
참여자: ${participants.join(', ')}

트랜스크립트:
${transcript}

=== 작성 지침 ===

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
  "detail": "[주제 1: 제목]\n내용...\n\n[주제 2: 제목]\n내용...",
  "core": "1. 결정사항\n2. 결정사항",
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
- 담당자가 불명확하면 "미정"으로 표기`

    const model = genAI.getGenerativeModel({
      model: 'gemini-2.5-flash',
      generationConfig: {
        responseMimeType: 'application/json',
        maxOutputTokens: 16384,
      },
    })

    const result = await model.generateContent(prompt)
    const text = result.response.text()

    const match = text.match(/\{[\s\S]*\}/)
    if (match) {
      const raw = JSON.parse(match[0])
      // Gemini가 string 필드를 배열로 반환하는 경우 방어적 정규화
      const toStr = (v: unknown): string => {
        if (typeof v === 'string') return v
        if (Array.isArray(v)) return v.join('\n')
        return String(v ?? '')
      }
      const minutes = {
        ...raw,
        detail: toStr(raw.detail),
        core:   toStr(raw.core),
      }
      return NextResponse.json({ minutes })
    }
    return NextResponse.json({ error: 'JSON 파싱 실패', raw: text }, { status: 500 })
  } catch (e) {
    const message = e instanceof Error ? e.message : String(e)
    return NextResponse.json({ error: message }, { status: 500 })
  }
}
