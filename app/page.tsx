'use client'
import { useMeetingStore } from '@/store/meetingStore'
import SetupScreen from '@/components/SetupScreen'
import RecordingScreen from '@/components/RecordingScreen'
import ReviewScreen from '@/components/ReviewScreen'
import SlackScreen from '@/components/SlackScreen'
import HistoryScreen from '@/components/HistoryScreen'

export default function Home() {
  const step = useMeetingStore((s) => s.step)
  return (
    <>
      {step === 'setup'     && <SetupScreen />}
      {step === 'recording' && <RecordingScreen />}
      {step === 'review'    && <ReviewScreen />}
      {step === 'slack'     && <SlackScreen />}
      {step === 'history'   && <HistoryScreen />}
    </>
  )
}
