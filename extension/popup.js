const DEFAULT_APP_URL = 'http://localhost:3000'

// ── DOM ───────────────────────────────────────────────────────────────────
const $settingsPanel = document.getElementById('settings-panel')
const $inputAppUrl   = document.getElementById('input-app-url')
const $inputTitle    = document.getElementById('input-title')
const $recTitleLabel = document.getElementById('rec-title-label')
const $errorMsg      = document.getElementById('error-msg')
const $calendarList  = document.getElementById('calendar-list')

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
})()

// ── 캘린더 조회 ───────────────────────────────────────────────────────────
async function loadCalendar() {
  const { appUrl } = await localGet(['appUrl'])
  const base = appUrl || DEFAULT_APP_URL

  try {
    const res = await fetch(`${base}/api/calendar/events`)
    if (!res.ok) throw new Error('not_configured')
    const { events } = await res.json()

    const today = new Date()
    const todayStr = today.toDateString()

    const todayEvents = (events || []).filter((e) => {
      return new Date(e.start).toDateString() === todayStr
    })

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
    const start   = new Date(event.start)
    const end     = new Date(event.end)
    const isPast  = end < now
    const isNow   = start <= now && now <= end

    const item = document.createElement('div')
    item.className = `cal-item${isPast ? ' past' : ''}${isNow ? ' now' : ''}`

    const timeStr = start.toLocaleTimeString('ko-KR', { hour: '2-digit', minute: '2-digit', hour12: false })

    item.innerHTML = `
      <div class="cal-time">${timeStr}</div>
      <div class="cal-info">
        <div class="cal-title">
          ${escHtml(event.title)}
          ${isNow ? '<span class="cal-badge">진행중</span>' : ''}
        </div>
      </div>
      ${!isPast ? `<button class="cal-rec-btn" data-title="${escAttr(event.title)}">● 녹음</button>` : ''}
    `

    // 일정 클릭 → 제목 자동 입력
    item.addEventListener('click', () => {
      $inputTitle.value = event.title
      $inputTitle.focus()
    })

    // 녹음 버튼 클릭 → 즉시 녹음 시작
    const recBtn = item.querySelector('.cal-rec-btn')
    if (recBtn) {
      recBtn.addEventListener('click', (e) => {
        e.stopPropagation()
        startRecording(event.title)
      })
    }

    $calendarList.appendChild(item)
  })
}

// ── 녹음 시작 ─────────────────────────────────────────────────────────────
async function startRecording(title) {
  const res = await chrome.runtime.sendMessage({ type: 'START_RECORDING', title })

  if (!res?.ok) {
    $errorMsg.textContent = res?.error || '앱 연결 실패. 설정에서 URL을 확인하세요.'
    show('screen-error')
    return
  }

  await chrome.storage.session.set({ isRecording: true, title })
  $recTitleLabel.textContent = title ? `"${title}" 녹음 중` : '녹음 중'
  show('screen-recording')
}

document.getElementById('btn-start').addEventListener('click', () => {
  startRecording($inputTitle.value.trim())
})

// ── 녹음 종료 ─────────────────────────────────────────────────────────────
document.getElementById('btn-stop').addEventListener('click', async () => {
  await chrome.runtime.sendMessage({ type: 'STOP_RECORDING' })
  await chrome.storage.session.clear()
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

// ── 캘린더 새로고침 ───────────────────────────────────────────────────────
document.getElementById('btn-refresh').addEventListener('click', () => {
  $calendarList.innerHTML = '<div class="cal-loading">불러오는 중...</div>'
  loadCalendar()
})

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

// ── Helpers ───────────────────────────────────────────────────────────────
const localGet   = (k) => new Promise((r) => chrome.storage.local.get(k, r))
const sessionGet = (k) => new Promise((r) => chrome.storage.session.get(k, r))
const escHtml    = (s) => s.replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;')
const escAttr    = (s) => s.replace(/"/g, '&quot;')
