import { NextRequest, NextResponse } from 'next/server'
import { GoogleGenerativeAI } from '@google/generative-ai'

const genAI = new GoogleGenerativeAI(process.env.GOOGLE_AI_API_KEY ?? '')

export async function POST(req: NextRequest) {
  try {
    const { transcript, participants, title } = await req.json()

    const prompt = `당신은 회의록 전문 AI 작성자입니다. 아래 회의 트랜스크립트를 분석해서 정확하고 구조화된 회의록을 작성해주세요.

회의 제목: ${title}
참여자: ${participants.join(', ')}

트랜스크립트:
${transcript}

다음 JSON 형식으로만 응답해주세요 (마크다운 코드블록 없이 순수 JSON):
{
  "detail": "회의 전체 내용을 빠짐없이 서술한 3-5문장 요약. 논의된 모든 주요 포인트 포함.",
  "core": "핵심 결정사항만 번호 매긴 목록 (1. ... 2. ... 3. ...). 3줄 이내.",
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
- nextSteps는 3개 제안
- 실제 트랜스크립트에서 언급된 내용만 포함
- 담당자가 명확하지 않으면 "미정"으로 표기`

    const model = genAI.getGenerativeModel({
      model: 'gemini-2.5-flash',
      generationConfig: {
        responseMimeType: 'application/json',
        maxOutputTokens: 8192,
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
