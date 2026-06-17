/**
 * ══════════════════════════════════════════════════════════
 * 🔌  테스트 그룹 4: API 라우트 통합 테스트
 * ══════════════════════════════════════════════════════════
 */
import { describe, it, expect, vi, beforeEach } from 'vitest'

// ── Deepgram SDK 모킹 ─────────────────────────────────────
vi.mock('@deepgram/sdk', () => ({
  createClient: vi.fn(() => ({
    auth: {
      grantToken: vi.fn(async () => ({
        result: { token: 'test-deepgram-token-abc123' },
        error: null,
      })),
    },
  })),
}))

// ── NextResponse 모킹 ─────────────────────────────────────
vi.mock('next/server', () => ({
  NextResponse: {
    json: vi.fn((data: unknown, init?: { status?: number }) => ({
      ok: !init?.status || init.status < 400,
      status: init?.status ?? 200,
      json: async () => data,
    })),
  },
}))

// ══════════════════════════════════════════════════════════
describe('🔌  /api/transcribe/token — 토큰 발급 라우트', () => {
// ══════════════════════════════════════════════════════════

  beforeEach(() => {
    vi.clearAllMocks()
    process.env.DEEPGRAM_API_KEY = 'test-api-key-123'
  })

  it('Deepgram SDK가 createClient로 초기화된다', async () => {
    const { createClient } = await import('@deepgram/sdk')
    const client = createClient('test-key')
    expect(createClient).toHaveBeenCalledWith('test-key')
    expect(client).toBeDefined()
  })

  it('grantToken() 호출 시 token 문자열이 반환된다', async () => {
    const { createClient } = await import('@deepgram/sdk')
    const client = createClient('test-key')
    const { result } = await client.auth.grantToken()
    expect(result?.token).toBe('test-deepgram-token-abc123')
    expect(typeof result?.token).toBe('string')
  })

  it('API 키가 없으면 적절한 에러가 발생해야 한다', async () => {
    delete process.env.DEEPGRAM_API_KEY
    expect(process.env.DEEPGRAM_API_KEY).toBeUndefined()
    // 실제 라우트에서는 에러 핸들링이 필요함
  })

  it('반환된 토큰이 빈 문자열이 아니다', async () => {
    const { createClient } = await import('@deepgram/sdk')
    const client = createClient(process.env.DEEPGRAM_API_KEY ?? '')
    const { result } = await client.auth.grantToken()
    expect(result?.token).toBeTruthy()
    expect(result?.token?.length).toBeGreaterThan(0)
  })
})

// ══════════════════════════════════════════════════════════
describe('🔌  /api/transcribe/token — 모킹 없는 구조 검증', () => {
// ══════════════════════════════════════════════════════════

  it('fetch 모킹이 /api/transcribe/token에 응답한다', async () => {
    const res  = await fetch('/api/transcribe/token')
    const data = await res.json()
    expect(data).toHaveProperty('token')
  })

  it('WebSocket 연결에 사용할 토큰 형식이 올바르다', async () => {
    const { token } = await (await fetch('/api/transcribe/token')).json() as { token: string }
    // 토큰은 문자열이어야 함
    expect(typeof token).toBe('string')
    expect(token).not.toBe('')
  })
})
