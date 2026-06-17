import { useEffect } from 'react'
import { useMeetingStore } from '@/store/meetingStore'

function postToExtension(data: object) {
  window.postMessage({ source: 'meetnotes-app', ...data }, '*')
}

export function useExtensionBridge() {
  const { setTitle, setStep, step, isRecording, title, elapsedSeconds } = useMeetingStore()

  // 익스텐션 명령 수신
  useEffect(() => {
    function handleMessage(event: MessageEvent) {
      if (event.data?.source !== 'meetnotes-ext') return
      const { type, payload } = event.data

      if (type === 'START_RECORDING') {
        if (payload?.title) setTitle(payload.title)
        setStep('recording')
        // RecordingScreen의 useEffect가 자동으로 startRecording() 호출
      }

      if (type === 'STOP_RECORDING') {
        // RecordingScreen의 handleStop을 트리거
        window.dispatchEvent(new CustomEvent('ext:stop-recording'))
      }
    }

    window.addEventListener('message', handleMessage)
    return () => window.removeEventListener('message', handleMessage)
  }, [setTitle, setStep])

  // 웹앱 상태 변화를 익스텐션에 전달
  useEffect(() => {
    if (isRecording) {
      postToExtension({ type: 'RECORDING_STARTED', title })
    }
  }, [isRecording, title])

  useEffect(() => {
    if (step === 'review') {
      postToExtension({ type: 'ANALYSIS_DONE', result: { title } })
    }
    if (step === 'recording' && !isRecording) {
      postToExtension({ type: 'RECORDING_STOPPED' })
    }
  }, [step, isRecording, title])
}
