const DEFAULT_APP_URL = 'http://localhost:3000'

// ── DOM refs ──────────────────────────────────────────────────────────────
const screens = {
  idle:      document.getElementById('screen-idle'),
  recording: document.getElementById('screen-recording'),
  analyzing: document.getElementById('screen-analyzing'),
  done:      document.getElementById('screen-done'),
  error:     document.getElementById('screen-error'),
}

const $title         = document.getElementById('input-title')
const $timer         = document.getElementById('timer')
const $recTitle      = document.getElementById('rec-title-label')
const $doneTitle     = document.getElementById('done-meeting-title')
const $errorMsg      = document.getElementById('error-msg')
const $volBars       = document.getElementById('vol-bars').children
const $settingsPanel = document.getElementById('settings-panel')
const $inputAppUrl   = document.getElementById('input-app-url')

let timerInterval = null
let pollInterval  = null
let startTime     = null

// ── Init ──────────────────────────────────────────────────────────────────
;(async () => {
  const { appUrl } = await localGet(['appUrl'])
  $inputAppUrl.value = appUrl || DEFAULT_APP_URL
  await syncState()
})()

// ── Screen helper ─────────────────────────────────────────────────────────
function showScreen(name) {
  Object.entries(screens).forEach(([k, el]) => {
    el.style.display = k === name ? '' : 'none'
  })
}

// ── State sync ────────────────────────────────────────────────────────────
async function syncState() {
  const s = await sessionGet([
    'isRecording', 'isStopping', 'isDone', 'result', 'error', 'startTime', 'title',
  ])

  if (s.isRecording) {
    showScreen('recording')
    $recTitle.textContent = s.title || ''
    startTime = s.startTime || Date.now()
    startTimer()
    startPoll()
    return
  }
  if (s.isStopping) {
    showScreen('analyzing')
    stopTimer()
    startPoll()
    return
  }
  if (s.isDone) {
    stopPoll()
    s.error ? showError(s.error) : showDone(s.result)
    return
  }

  stopPoll()
  showScreen('idle')
}

// ── Timer ─────────────────────────────────────────────────────────────────
function startTimer() {
  if (timerInterval) return
  timerInterval = setInterval(() => {
    const elapsed = Math.floor((Date.now() - startTime) / 1000)
    $timer.textContent = fmt(elapsed)
    animateBars()
  }, 500)
}

function stopTimer() {
  if (timerInterval) { clearInterval(timerInterval); timerInterval = null }
}

function fmt(sec) {
  return `${String(Math.floor(sec / 60)).padStart(2, '0')}:${String(sec % 60).padStart(2, '0')}`
}

function animateBars() {
  const base = [4, 8, 14, 20, 14, 8, 4]
  Array.from($volBars).forEach((bar, i) => {
    bar.style.height = `${base[i] + Math.random() * 12}px`
  })
}

// ── Poll ──────────────────────────────────────────────────────────────────
function startPoll() {
  if (pollInterval) return
  pollInterval = setInterval(syncState, 1000)
}

function stopPoll() {
  if (pollInterval) { clearInterval(pollInterval); pollInterval = null }
  stopTimer()
}

// ── Done / Error ──────────────────────────────────────────────────────────
function showDone(result) {
  showScreen('done')
  $doneTitle.textContent = result?.title || '회의록이 저장되었습니다'
}

function showError(msg) {
  showScreen('error')
  $errorMsg.textContent = msg
}

// ── 버튼 이벤트 ───────────────────────────────────────────────────────────

// 녹음 시작
document.getElementById('btn-start').addEventListener('click', async () => {
  const title = $title.value.trim()
  const res = await chrome.runtime.sendMessage({ type: 'START_RECORDING', title })

  if (!res?.ok) {
    showError(res?.error || '웹앱 연결에 실패했습니다.\n앱 URL 설정을 확인해주세요.')
    return
  }

  startTime = Date.now()
  $recTitle.textContent = title
  showScreen('recording')
  startTimer()
  startPoll()
})

// 녹음 종료
document.getElementById('btn-stop').addEventListener('click', async () => {
  stopTimer()
  showScreen('analyzing')
  await chrome.runtime.sendMessage({ type: 'STOP_RECORDING' })
})

// 앱에서 보기
document.getElementById('btn-open-app').addEventListener('click', async () => {
  const { appUrl } = await localGet(['appUrl'])
  chrome.tabs.create({ url: `${appUrl || DEFAULT_APP_URL}` })
})

// 새 녹음
document.getElementById('btn-new').addEventListener('click', async () => {
  await chrome.storage.session.clear()
  $title.value = ''
  showScreen('idle')
})

document.getElementById('btn-error-retry').addEventListener('click', async () => {
  await chrome.storage.session.clear()
  showScreen('idle')
})

// 설정 토글
document.getElementById('btn-settings').addEventListener('click', () => {
  $settingsPanel.style.display = $settingsPanel.style.display !== 'none' ? 'none' : ''
})

// URL 저장
document.getElementById('btn-save-url').addEventListener('click', async () => {
  const url = $inputAppUrl.value.trim().replace(/\/$/, '')
  await chrome.storage.local.set({ appUrl: url })
  $settingsPanel.style.display = 'none'
})

// ── Storage helpers ───────────────────────────────────────────────────────
const localGet   = (keys) => new Promise((r) => chrome.storage.local.get(keys, r))
const sessionGet = (keys) => new Promise((r) => chrome.storage.session.get(keys, r))
