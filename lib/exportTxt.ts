import { MeetingRecord, MeetingMinutes, Utterance } from '@/store/meetingStore'

function formatDuration(s: number) {
  const m = Math.floor(s / 60)
  const sec = s % 60
  return m > 0 ? `${m}분 ${sec}초` : `${sec}초`
}

export function buildTxtContent(
  title: string,
  date: string,
  duration: number,
  participants: string[],
  minutes: MeetingMinutes,
  utterances?: Utterance[]
): string {
  const lines: string[] = []
  const hr = '='.repeat(60)
  const hr2 = '-'.repeat(60)

  lines.push(hr)
  lines.push(`[회의록] ${title}`)
  lines.push(hr)
  lines.push(`일시: ${date}`)
  lines.push(`소요시간: ${formatDuration(duration)}`)
  lines.push(`참여자: ${participants.join(', ')}`)
  lines.push('')

  lines.push(hr2)
  lines.push('■ 전체 내용 요약')
  lines.push(hr2)
  lines.push(minutes.detail)
  lines.push('')

  lines.push(hr2)
  lines.push('■ 핵심 결정사항')
  lines.push(hr2)
  lines.push(minutes.core)
  lines.push('')

  lines.push(hr2)
  lines.push('■ 주요 키워드')
  lines.push(hr2)
  lines.push(minutes.keywords.join(', '))
  lines.push('')

  lines.push(hr2)
  lines.push('■ 액션 아이템')
  lines.push(hr2)
  for (const a of minutes.actions) {
    const priority = a.priority === 'high' ? '높음' : a.priority === 'medium' ? '중간' : '낮음'
    lines.push(`□ ${a.text}`)
    lines.push(`   담당: ${a.assignee} | 기한: ${a.due} | 우선순위: ${priority}`)
  }
  lines.push('')

  if (minutes.nextSteps?.length) {
    lines.push(hr2)
    lines.push('■ 다음 스텝 (AI 제안)')
    lines.push(hr2)
    minutes.nextSteps.forEach((s, i) => {
      lines.push(`${i + 1}. ${s.title}`)
      lines.push(`   → ${s.reason}`)
    })
    lines.push('')
  }

  if (utterances && utterances.length > 0) {
    lines.push(hr2)
    lines.push('■ 원본 트랜스크립트')
    lines.push(hr2)
    for (const u of utterances.filter((u) => u.isFinal)) {
      lines.push(`[${u.timestamp}] ${u.speakerName}: ${u.text}`)
    }
    lines.push('')
  }

  lines.push(hr)
  lines.push('MeetNotes AI로 자동 작성됨')
  lines.push(hr)

  return lines.join('\n')
}

export function downloadTxt(filename: string, content: string) {
  const blob = new Blob([content], { type: 'text/plain;charset=utf-8' })
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = filename
  a.click()
  URL.revokeObjectURL(url)
}

export function exportMeetingTxt(record: MeetingRecord, utterances?: Utterance[]) {
  const content = buildTxtContent(
    record.title,
    record.date,
    record.duration,
    record.participants,
    record.minutes,
    utterances
  )
  const safeName = record.title.replace(/[^가-힣a-zA-Z0-9]/g, '_').slice(0, 40)
  downloadTxt(`회의록_${safeName}_${record.date.replace(/\./g, '')}.txt`, content)
}
