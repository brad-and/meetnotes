let mediaRecorder = null
let audioChunks = []
let recordingMeta = {}

chrome.runtime.onMessage.addListener((msg) => {
  if (msg.target !== 'offscreen') return

  if (msg.type === 'START') startRecording(msg)
  if (msg.type === 'STOP') stopRecording()
})

async function startRecording({ mode, streamId, appUrl, title }) {
  try {
    let stream

    if (mode === 'tab' && streamId) {
      stream = await navigator.mediaDevices.getUserMedia({
        audio: {
          mandatory: {
            chromeMediaSource: 'tab',
            chromeMediaSourceId: streamId,
          },
        },
        video: false,
      })
    } else {
      stream = await navigator.mediaDevices.getUserMedia({ audio: true })
    }

    const mimeType = MediaRecorder.isTypeSupported('audio/webm;codecs=opus')
      ? 'audio/webm;codecs=opus'
      : 'audio/webm'

    audioChunks = []
    recordingMeta = { appUrl, title, startTime: Date.now(), mimeType }

    mediaRecorder = new MediaRecorder(stream, { mimeType })
    mediaRecorder.ondataavailable = (e) => {
      if (e.data.size > 0) audioChunks.push(e.data)
    }
    mediaRecorder.onstop = () => {
      stream.getTracks().forEach((t) => t.stop())
      analyzeAndReport()
    }
    mediaRecorder.start(1000)
  } catch (err) {
    chrome.runtime.sendMessage({
      type: 'ANALYSIS_DONE',
      error: `녹음 시작 실패: ${err.message}`,
    })
  }
}

function stopRecording() {
  if (mediaRecorder && mediaRecorder.state !== 'inactive') {
    mediaRecorder.stop()
  }
}

async function analyzeAndReport() {
  const { appUrl, title, startTime, mimeType } = recordingMeta
  const duration = Math.floor((Date.now() - startTime) / 1000)

  try {
    const blob = new Blob(audioChunks, { type: mimeType })
    const ext = mimeType.includes('ogg') ? 'ogg' : 'webm'

    const form = new FormData()
    form.append('audio', new File([blob], `meeting.${ext}`, { type: mimeType }))
    form.append('participants', JSON.stringify([]))
    form.append('title', title || '')

    const analyzeRes = await fetch(`${appUrl}/api/analyze`, { method: 'POST', body: form })
    if (!analyzeRes.ok) throw new Error(`분석 API 오류 (${analyzeRes.status})`)

    const { minutes, utterances } = await analyzeRes.json()
    if (!minutes) throw new Error('회의록 데이터가 없습니다')

    const meetingId = `ext-${Date.now()}`
    await fetch(`${appUrl}/api/meetings`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        id: meetingId,
        title: title || '익스텐션 회의',
        date: new Date().toISOString(),
        duration,
        participants: [],
        minutes,
        utterances: utterances ?? [],
        slackSent: false,
        archived: false,
      }),
    })

    chrome.runtime.sendMessage({
      type: 'ANALYSIS_DONE',
      result: { meetingId, title: title || '익스텐션 회의', minutes },
    })
  } catch (err) {
    chrome.runtime.sendMessage({ type: 'ANALYSIS_DONE', error: err.message })
  }
}
