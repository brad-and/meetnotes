import { NextResponse } from 'next/server'

export async function GET() {
  const apiKey = process.env.DEEPGRAM_API_KEY
  if (!apiKey) return NextResponse.json({ error: 'No API key' }, { status: 500 })
  // For browser-based access, return the API key directly as the token
  // In production, use Deepgram's temporary token endpoint
  return NextResponse.json({ token: apiKey })
}
