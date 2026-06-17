const DEFAULT_APP_URL = 'http://localhost:3000'

async function getAppUrl() {
  return new Promise((resolve) =>
    chrome.storage.local.get(['appUrl'], (r) => resolve(r.appUrl || DEFAULT_APP_URL))
  )
}

async function findMeetNotesTab() {
  const appUrl = await getAppUrl()
  const tabs = await chrome.tabs.query({})
  return tabs.find((t) => t.url?.startsWith(appUrl)) ?? null
}

async function openMeetNotesTab() {
  const appUrl = await getAppUrl()
  const tab = await chrome.tabs.create({ url: appUrl })
  await new Promise((resolve) => {
    chrome.tabs.onUpdated.addListener(function listener(tabId, info) {
      if (tabId === tab.id && info.status === 'complete') {
        chrome.tabs.onUpdated.removeListener(listener)
        resolve()
      }
    })
  })
  return tab
}

async function injectContentScript(tabId) {
  try {
    await chrome.scripting.executeScript({ target: { tabId }, files: ['content.js'] })
  } catch {
    // 이미 주입됐으면 무시
  }
  await new Promise((r) => setTimeout(r, 150))
}

async function sendToTab(tabId, payload) {
  await injectContentScript(tabId)
  return chrome.tabs.sendMessage(tabId, { type: 'EXT_CMD', payload })
}

// ── 메시지 핸들러 ─────────────────────────────────────────────────────────
chrome.runtime.onMessage.addListener((msg, _sender, sendResponse) => {
  ;(async () => {
    // 팝업 → 웹앱: 녹음 시작
    if (msg.type === 'START_RECORDING') {
      let tab = await findMeetNotesTab()
      if (!tab) tab = await openMeetNotesTab()

      await chrome.tabs.update(tab.id, { active: true })
      await sendToTab(tab.id, { type: 'START_RECORDING', title: msg.title })

      await chrome.storage.session.set({
        isRecording: true, isStopping: false, isDone: false,
        error: null, result: null,
        startTime: Date.now(), title: msg.title || '', tabId: tab.id,
      })
      sendResponse({ ok: true })
    }

    // 팝업 → 웹앱: 녹음 종료
    else if (msg.type === 'STOP_RECORDING') {
      const { tabId } = await new Promise((r) => chrome.storage.session.get(['tabId'], r))
      if (tabId) await sendToTab(tabId, { type: 'STOP_RECORDING' })
      await chrome.storage.session.set({ isRecording: false, isStopping: true })
      sendResponse({ ok: true })
    }

    // 웹앱 → 팝업: 상태 업데이트
    else if (msg.type === 'APP_EVENT') {
      const { event } = msg
      if (event.type === 'RECORDING_STARTED') {
        await chrome.storage.session.set({ isRecording: true, isStopping: false })
      }
      if (event.type === 'RECORDING_STOPPED') {
        await chrome.storage.session.set({ isRecording: false, isStopping: true })
      }
      if (event.type === 'ANALYSIS_DONE') {
        await chrome.storage.session.set({
          isStopping: false, isDone: true,
          result: event.result ?? null, error: event.error ?? null,
        })
      }
    }
  })()
  return true
})
