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
  // 페이지 로드 후 React 마운트 대기
  await new Promise((r) => setTimeout(r, 1000))
  return tab
}

// 웹앱 window에 직접 postMessage 주입 (MAIN world — content.js 거치지 않음)
async function postToWebApp(tabId, data) {
  await chrome.scripting.executeScript({
    target: { tabId },
    world: 'MAIN',
    func: (payload) => {
      window.postMessage({ source: 'meetnotes-ext', ...payload }, '*')
    },
    args: [data],
  })
}

// 역방향 채널(웹앱→익스텐션)용 content.js 주입
async function ensureContentScript(tabId) {
  try {
    await chrome.scripting.executeScript({ target: { tabId }, files: ['content.js'] })
  } catch {
    // 이미 주입됨
  }
}

// ── 메시지 핸들러 ─────────────────────────────────────────────────────────
chrome.runtime.onMessage.addListener((msg, _sender, sendResponse) => {
  ;(async () => {
    // 팝업 → 웹앱: 일정 선택 (1단계 자동 세팅)
    if (msg.type === 'SELECT_EVENT') {
      let tab = await findMeetNotesTab()
      if (!tab) tab = await openMeetNotesTab()
      await chrome.tabs.update(tab.id, { active: true })
      await ensureContentScript(tab.id)
      await postToWebApp(tab.id, {
        type: 'SELECT_EVENT',
        title: msg.title,
        attendees: msg.attendees ?? [],
      })
      sendResponse({ ok: true })
    }

    // 팝업 → 웹앱: 녹음 시작 (2단계 이동)
    else if (msg.type === 'START_RECORDING') {
      let tab = await findMeetNotesTab()
      if (!tab) tab = await openMeetNotesTab()
      await chrome.tabs.update(tab.id, { active: true })
      await ensureContentScript(tab.id)
      await postToWebApp(tab.id, {
        type: 'START_RECORDING',
        title: msg.title,
        attendees: msg.attendees ?? [],
      })
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
      if (tabId) {
        await postToWebApp(tabId, { type: 'STOP_RECORDING' })
      }
      await chrome.storage.session.set({ isRecording: false, isStopping: true })
      sendResponse({ ok: true })
    }

    // 웹앱 → 팝업: 상태 업데이트 (content.js에서 전달)
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
