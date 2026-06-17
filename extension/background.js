const DEFAULT_APP_URL = 'http://localhost:3000'
const NOTIFY_BEFORE_MS = 3 * 60 * 1000  // 3분 전 알림

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
  await new Promise((r) => setTimeout(r, 1000))
  return tab
}

// 웹앱 window에 직접 postMessage 주입 (MAIN world)
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

// ── 회의 알림 ──────────────────────────────────────────────────────────────

// 알림용 이벤트 키: 제목 + 시작시각으로 중복 방지
function eventKey(event) {
  return `${event.title}__${event.start}`
}

async function checkUpcomingMeetings() {
  const { isRecording } = await new Promise((r) =>
    chrome.storage.session.get(['isRecording'], r)
  )
  if (isRecording) return  // 이미 녹음 중이면 알림 불필요

  const appUrl = await getAppUrl()
  let events = []
  try {
    const res = await fetch(`${appUrl}/api/calendar/events`)
    if (!res.ok) return
    const data = await res.json()
    events = data.events || []
  } catch {
    return
  }

  const now = Date.now()
  const { notifiedKeys = {} } = await new Promise((r) =>
    chrome.storage.session.get(['notifiedKeys'], r)
  )

  // 오늘 이후 알림을 보낸 키는 24시간 지나면 만료
  const freshKeys = {}
  for (const [k, ts] of Object.entries(notifiedKeys)) {
    if (now - ts < 24 * 60 * 60 * 1000) freshKeys[k] = ts
  }

  for (const event of events) {
    const start = new Date(event.start).getTime()
    const msUntil = start - now

    // 3분 전 ~ 시작 후 1분 사이의 이벤트만 알림
    if (msUntil > NOTIFY_BEFORE_MS || msUntil < -60_000) continue

    const key = eventKey(event)
    if (freshKeys[key]) continue  // 이미 알림 보냄

    const timeStr = new Date(event.start).toLocaleTimeString('ko-KR', {
      hour: '2-digit', minute: '2-digit', hour12: false,
    })
    const minutesLeft = Math.max(0, Math.round(msUntil / 60_000))
    const message = minutesLeft > 0
      ? `${timeStr} 시작 — ${minutesLeft}분 후`
      : `${timeStr} 시작`

    chrome.notifications.create(key, {
      type: 'basic',
      iconUrl: 'icons/icon128.png',
      title: `📋 ${event.title}`,
      message,
      buttons: [
        { title: '녹음 시작' },
        { title: '닫기' },
      ],
      requireInteraction: true,
    })

    freshKeys[key] = now

    // 알림 클릭 시 사용할 이벤트 정보 저장
    const pendingNotifs = await new Promise((r) =>
      chrome.storage.session.get(['pendingNotifs'], r)
    ).then((d) => d.pendingNotifs || {})
    pendingNotifs[key] = { title: event.title, attendees: event.attendees || [] }
    await chrome.storage.session.set({ pendingNotifs })
  }

  await chrome.storage.session.set({ notifiedKeys: freshKeys })
}

// 설치/업데이트 시 알람 등록
chrome.runtime.onInstalled.addListener(() => {
  chrome.alarms.create('meetingCheck', { periodInMinutes: 1 })
})

// 브라우저 재시작 시에도 알람 유지
chrome.runtime.onStartup.addListener(() => {
  chrome.alarms.create('meetingCheck', { periodInMinutes: 1 })
})

chrome.alarms.onAlarm.addListener((alarm) => {
  if (alarm.name === 'meetingCheck') checkUpcomingMeetings()
})

// ── 알림 버튼 클릭 ────────────────────────────────────────────────────────
chrome.notifications.onButtonClicked.addListener(async (notifId, btnIdx) => {
  chrome.notifications.clear(notifId)
  if (btnIdx !== 0) return  // 닫기

  const { pendingNotifs = {} } = await new Promise((r) =>
    chrome.storage.session.get(['pendingNotifs'], r)
  )
  const evtData = pendingNotifs[notifId]
  if (!evtData) return

  let tab = await findMeetNotesTab()
  if (!tab) tab = await openMeetNotesTab()
  await chrome.tabs.update(tab.id, { active: true })
  chrome.windows.update(tab.windowId, { focused: true })
  await ensureContentScript(tab.id)
  await postToWebApp(tab.id, {
    type: 'SELECT_EVENT',
    title: evtData.title,
    attendees: evtData.attendees,
  })
})

// 알림 본체 클릭 → 탭 포커스만
chrome.notifications.onClicked.addListener(async (notifId) => {
  chrome.notifications.clear(notifId)
  let tab = await findMeetNotesTab()
  if (!tab) tab = await openMeetNotesTab()
  await chrome.tabs.update(tab.id, { active: true })
  chrome.windows.update(tab.windowId, { focused: true })
})

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

    // 팝업 → background: 즉시 알림 체크 (팝업 열릴 때 호출)
    else if (msg.type === 'CHECK_MEETINGS') {
      await checkUpcomingMeetings()
      sendResponse({ ok: true })
    }
  })()
  return true
})
