const DEFAULT_APP_URL = 'http://localhost:3000'

async function getAppUrl() {
  return new Promise((resolve) => {
    chrome.storage.local.get(['appUrl'], (r) => resolve(r.appUrl || DEFAULT_APP_URL))
  })
}

async function createOffscreen() {
  const contexts = await chrome.runtime.getContexts({ contextTypes: ['OFFSCREEN_DOCUMENT'] })
  if (contexts.length > 0) return
  await chrome.offscreen.createDocument({
    url: 'offscreen.html',
    reasons: ['USER_MEDIA'],
    justification: '회의 오디오 녹음',
  })
}

async function closeOffscreen() {
  const contexts = await chrome.runtime.getContexts({ contextTypes: ['OFFSCREEN_DOCUMENT'] })
  if (contexts.length > 0) await chrome.offscreen.closeDocument()
}

async function sendToOffscreen(msg) {
  return chrome.runtime.sendMessage({ ...msg, target: 'offscreen' })
}

chrome.runtime.onMessage.addListener((msg, _sender, sendResponse) => {
  ;(async () => {
    // ── 녹음 시작 ────────────────────────────────────────────────────────
    if (msg.type === 'START_RECORDING') {
      try {
        await createOffscreen()

        let streamId = null
        if (msg.mode === 'tab') {
          streamId = await new Promise((resolve, reject) => {
            chrome.tabCapture.getMediaStreamId({ targetTabId: msg.tabId }, (id) => {
              if (chrome.runtime.lastError) reject(new Error(chrome.runtime.lastError.message))
              else resolve(id)
            })
          })
        }

        const appUrl = await getAppUrl()
        await sendToOffscreen({ type: 'START', mode: msg.mode, streamId, appUrl, title: msg.title })

        await chrome.storage.session.set({
          isRecording: true,
          isStopping: false,
          isDone: false,
          error: null,
          result: null,
          startTime: Date.now(),
          title: msg.title || '',
          mode: msg.mode,
        })

        sendResponse({ ok: true })
      } catch (err) {
        sendResponse({ ok: false, error: err.message })
      }
    }

    // ── 녹음 종료 ────────────────────────────────────────────────────────
    else if (msg.type === 'STOP_RECORDING') {
      await chrome.storage.session.set({ isRecording: false, isStopping: true })
      await sendToOffscreen({ type: 'STOP' })
      sendResponse({ ok: true })
    }

    // ── offscreen에서 분석 완료 콜백 ────────────────────────────────────
    else if (msg.type === 'ANALYSIS_DONE') {
      await chrome.storage.session.set({
        isStopping: false,
        isDone: true,
        result: msg.result ?? null,
        error: msg.error ?? null,
      })
      await closeOffscreen()
    }
  })()
  return true
})
