const DEFAULT_APP_URL = 'http://localhost:3000'

// ── DOM ───────────────────────────────────────────────────────────────────
const $settingsPanel = document.getElementById('settings-panel')
const $inputAppUrl   = document.getElementById('input-app-url')
const $inputTitle    = document.getElementById('input-title')
const $recTitleLabel = document.getElementById('rec-title-label')
const $errorMsg      = document.getElementById('error-msg')
const $calendarList  = document.getElementById('calendar-list')

// 현재 선택된 캘린더 이벤트 참석자 보관
let selectedAttendees = []

// ── Helpers ───────────────────────────────────────────────────────────────
const localGet   = (k) => new Promise((r) => chrome.storage.local.get(k, r))
const sessionGet = (k) => new Promise((r) => chrome.storage.session.get(k, r))
const escHtml    = (s) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')

function show(id) {
  ;['screen-idle', 'screen-recording', 'screen-error'].forEach((s) => {
    document.getElementById(s).style.display = s === id ? '' : 'none'
  })
}

// ── Init ──────────────────────────────────────────────────────────────────
;(async () => {
  const { appUrl } = await localGet(['appUrl'])
  $inputAppUrl.value = appUrl || DEFAULT_APP_URL

  const { isRecording, title } = await sessionGet(['isRecording', 'title'])
  if (isRecording) {
    $recTitleLabel.textContent = title ? `"${title}" 녹음 중` : '녹음 중'
    show('screen-recording')
  } else {
    show('screen-idle')
    loadCalendar()
  }
  // 팝업 열릴 때 즉시 회의 알림 체크
  chrome.runtime.sendMessage({ type: 'CHECK_MEETINGS' })
})()

// ── 캘린더 조회 ───────────────────────────────────────────────────────────
async function loadCalendar() {
  const { appUrl } = await localGet(['appUrl'])
  const base = appUrl || DEFAULT_APP_URL
  $calendarList.innerHTML = '<div class="cal-loading">불러오는 중...</div>'

  try {
    const res = await fetch(`${base}/api/calendar/events`)
    if (!res.ok) throw new Error('not_configured')
    const { events } = await res.json()

    const todayStr = new Date().toDateString()
    const todayEvents = (events || []).filter(
      (e) => new Date(e.start).toDateString() === todayStr
    )
    renderCalendar(todayEvents)
  } catch {
    $calendarList.innerHTML = '<div class="cal-empty">캘린더 미연동 — 앱에서 설정하세요</div>'
  }
}

function renderCalendar(events) {
  if (!events.length) {
    $calendarList.innerHTML = '<div class="cal-empty">오늘 예정된 회의가 없습니다</div>'
    return
  }

  const now = new Date()
  $calendarList.innerHTML = ''

  events.forEach((event) => {
    const start  = new Date(event.start)
    const end    = new Date(event.end)
    const isPast = end < now
    const isNow  = start <= now && now <= end

    const item = document.createElement('div')
    item.className = `cal-item${isPast ? ' past' : ''}${isNow ? ' now' : ''}`

    const timeStr = start.toLocaleTimeString('ko-KR', {
      hour: '2-digit', minute: '2-digit', hour12: false,
    })

    item.innerHTML = `
      <div class="cal-time">${timeStr}</div>
      <div class="cal-info">
        <div class="cal-title">
          ${escHtml(event.title)}
          ${isNow ? '<span class="cal-badge">진행중</span>' : ''}
        </div>
      </div>
      <div class="cal-check">✓</div>
    `

    // 이벤트 클릭 → 1단계 세팅 (제목 + 참여자 자동 입력)
    item.addEventListener('click', () => selectEvent(item, event))

    $calendarList.appendChild(item)
  })
}

// ── 이벤트 선택 → 웹앱 1단계 자동 세팅 ──────────────────────────────────
async function selectEvent(itemEl, event) {
  // 팝업 UI 업데이트
  document.querySelectorAll('.cal-item').forEach((el) => el.classList.remove('selected'))
  itemEl.classList.add('selected')
  $inputTitle.value = event.title
  selectedAttendees = event.attendees || []

  // 웹앱 1단계(SetupScreen)에 제목 + 참여자 자동 입력
  const res = await chrome.runtime.sendMessage({
    type: 'SELECT_EVENT',
    title: event.title,
    attendees: selectedAttendees,
  })

  if (!res?.ok) {
    $errorMsg.textContent = res?.error || '앱 연결 실패. 설정에서 URL을 확인하세요.'
    show('screen-error')
  }
}

// ── 녹음 시작 → 웹앱 2단계 이동 ─────────────────────────────────────────
document.getElementById('btn-start').addEventListener('click', async () => {
  const title = $inputTitle.value.trim()
  const res = await chrome.runtime.sendMessage({
    type: 'START_RECORDING',
    title,
    attendees: selectedAttendees,
  })

  if (!res?.ok) {
    $errorMsg.textContent = res?.error || '앱 연결 실패. 설정에서 URL을 확인하세요.'
    show('screen-error')
    return
  }

  await chrome.storage.session.set({ isRecording: true, title })
  $recTitleLabel.textContent = title ? `"${title}" 녹음 중` : '녹음 중'
  show('screen-recording')
})

// ── 녹음 종료 ─────────────────────────────────────────────────────────────
document.getElementById('btn-stop').addEventListener('click', async () => {
  await chrome.runtime.sendMessage({ type: 'STOP_RECORDING' })
  await chrome.storage.session.clear()
  selectedAttendees = []
  $inputTitle.value = ''
  show('screen-idle')
  loadCalendar()
})

// ── 웹앱 탭으로 이동 ──────────────────────────────────────────────────────
document.getElementById('btn-focus').addEventListener('click', async () => {
  const { appUrl } = await localGet(['appUrl'])
  const url = appUrl || DEFAULT_APP_URL
  const tabs = await chrome.tabs.query({})
  const tab = tabs.find((t) => t.url?.startsWith(url))
  if (tab) {
    chrome.tabs.update(tab.id, { active: true })
    chrome.windows.update(tab.windowId, { focused: true })
  } else {
    chrome.tabs.create({ url })
  }
})

// ── 새로고침 ──────────────────────────────────────────────────────────────
document.getElementById('btn-refresh').addEventListener('click', loadCalendar)

// ── 재시도 ────────────────────────────────────────────────────────────────
document.getElementById('btn-retry').addEventListener('click', () => {
  show('screen-idle')
  loadCalendar()
})

// ── 설정 ──────────────────────────────────────────────────────────────────
document.getElementById('btn-settings').addEventListener('click', () => {
  $settingsPanel.style.display = $settingsPanel.style.display !== 'none' ? 'none' : ''
})

document.getElementById('btn-save-url').addEventListener('click', async () => {
  const url = $inputAppUrl.value.trim().replace(/\/$/, '')
  await chrome.storage.local.set({ appUrl: url })
  $settingsPanel.style.display = 'none'
  loadCalendar()
})
