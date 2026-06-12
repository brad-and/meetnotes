import { NextRequest, NextResponse } from 'next/server'
import { GoogleGenerativeAI } from '@google/generative-ai'

const genAI = new GoogleGenerativeAI(process.env.GOOGLE_AI_API_KEY ?? '')

const MODEL_FALLBACK = ['gemini-2.5-flash', 'gemini-2.0-flash', 'gemini-1.5-flash']

export async function POST(req: NextRequest) {
  const formData = await req.formData()
  const audio = formData.get('audio') as File
  console.log('[/api/keywords] size:', audio?.size, 'type:', audio?.type)
  if (!audio || audio.size < 2000) return NextResponse.json({ keywords: [] })

  const base64 = Buffer.from(await audio.arrayBuffer()).toString('base64')
  const mimeType = audio.type || 'audio/webm'
  const prompt = '이 회의 오디오에서 핵심 키워드를 3~5개 추출하세요. 한국어 단어로만. JSON 배열로만 응답하세요. 예: ["마케팅","일정","예산"]'

  for (const modelName of MODEL_FALLBACK) {
    try {
      const model = genAI.getGenerativeModel({ model: modelName })
      const result = await model.generateContent([
        { inlineData: { mimeType, data: base64 } },
        prompt,
      ])
      const text = result.response.text().trim()
      console.log('[/api/keywords] 모델:', modelName, '응답:', text.slice(0, 200))
      const match = text.match(/\[[\s\S]*\]/)
      if (!match) {
        console.warn('[/api/keywords] 배열 미매칭:', text)
        return NextResponse.json({ keywords: [] })
      }
      const keywords = JSON.parse(match[0])
      return NextResponse.json({ keywords: Array.isArray(keywords) ? keywords.slice(0, 5) : [] })
    } catch (err) {
      console.warn(`[/api/keywords] ${modelName} 실패, 다음 모델 시도:`, String(err).slice(0, 150))
      // 어떤 오류든 다음 모델로 폴백
    }
  }

  console.error('[/api/keywords] 모든 모델 할당량 초과')
  return NextResponse.json({ keywords: [] })
}
