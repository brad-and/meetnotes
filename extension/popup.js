const DEFAULT_APP_URL = 'http://localhost:3000'

// ── DOM refs ──────────────────────────────────────────────────────────────
const screens = {
  idle:      document.getElementById('screen-idle'),
  recording: document.getElementById('screen-recording'),
  analyzing: document.getElementById('screen-analyzing'),
  done:      document.getElementById('screen-done'),
  error:     document.getElementById('screen-error'),
}

const $title       = document.getElementById('input-title')
const $timer       = document.getElementById('timer')
const $recTitle    = document.getElementById('rec-title-label')
const $recMode     = document.getElementById('rec-mode-label')
const $doneTitle   = document.getElementById('done-meeting-title')
const $errorMsg    = document.getElementById('error-msg')
const $volBars     = document.getElementById('vol-bars').children
const $settingsPanel = document.getElementById('settings-panel')
const $inputAppUrl = document.getElementById('input-app-url')

let selectedMode = 'mic'
let timerInterval = null
let pollInterval = null
let startTime = null

// ── Init ──────────────────────────────────────────────────────────────────
;(async () => {
  const { appUrl } = await storageGet(['appUrl'])
  $inputAppUrl.value = appUrl || DEFAULT_APP_URL

  await syncState()
})()

// ── Screen helper ─────────────────────────────────────────────────────────
function showScreen(name) {
  Object.entries(screens).forEach(([k, el]) => {
    el.style.display = k === name ? '' : 'none'
  })
}

// ── State sync (polling) ──────────────────────────────────────────────────
async function syncState() {
  const state = await storageSessionGet([
    'isRecording', 'isStopping', 'isDone', 'result', 'error', 'startTime', 'title', 'mode',
  ])

  if (state.isRecording) {
    showScreen('recording')
    $recTitle.textContent = state.title || ''
    $recMode.textContent  = state.mode === 'tab' ? '탭 오디오 녹음 중' : '마이크 녹음 중'
    startTime = state.startTime || Date.now()
    startTimer()
    startPoll()
    return
  }

  if (state.isStopping) {
    showScreen('analyzing')
    startPoll()
    return
  }

  if (state.isDone) {
    stopPoll()
    if (state.error) {
      showError(state.error)
    } else {
      showDone(state.result)
    }
    return
  }

  showScreen('idle')
}

// ── Timer ─────────────────────────────────────────────────────────────────
function startTimer() {
  stopTimer()
  timerInterval = setInterval(() => {
    const elapsed = Math.floor((Date.now() - startTime) / 1000)
    $timer.textContent = formatTime(elapsed)
    animateVolBars()
  }, 500)
}

function stopTimer() {
  if (timerInterval) { clearInterval(timerInterval); timerInterval = null }
}

function formatTime(sec) {
  const m = String(Math.floor(sec / 60)).padStart(2, '0')
  const s = String(sec % 60).padStart(2, '0')
  return `${m}:${s}`
}

function animateVolBars() {
  const heights = [4, 8, 14, 20, 14, 8, 4]
  Array.from($volBars).forEach((bar, i) => {
    const jitter = Math.random() * 12
    bar.style.height = `${heights[i] + jitter}px`
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

// ── Event Listeners ───────────────────────────────────────────────────────

// Mode select
document.querySelectorAll('.mode-card').forEach((card) => {
  card.addEventListener('click', () => {
    document.querySelectorAll('.mode-card').forEach((c) => c.classList.remove('selected'))
    card.classList.add('selected')
    selectedMode = card.dataset.mode
  })
})

// Start
document.getElementById('btn-start').addEventListener('click', async () => {
  const title = $title.value.trim()

  let tabId = null
  if (selectedMode === 'tab') {
    const [tab] = await chrome.tabs.query({ active: true, currentWindow: true })
    tabId = tab?.id ?? null
  }

  const res = await chrome.runtime.sendMessage({
    type: 'START_RECORDING',
    mode: selectedMode,
    tabId,
    title,
  })

  if (!res?.ok) {
    showError(res?.error || '녹음 시작에 실패했습니다')
    return
  }

  startTime = Date.now()
  $recTitle.textContent = title
  $recMode.textContent  = selectedMode === 'tab' ? '탭 오디오 녹음 중' : '마이크 녹음 중'
  showScreen('recording')
  startTimer()
  startPoll()
})

// Stop
document.getElementById('btn-stop').addEventListener('click', async () => {
  stopTimer()
  showScreen('analyzing')
  await chrome.runtime.sendMessage({ type: 'STOP_RECORDING' })
})

// Open app
document.getElementById('btn-open-app').addEventListener('click', async () => {
  const { appUrl } = await storageGet(['appUrl'])
  const url = `${appUrl || DEFAULT_APP_URL}?tab=history`
  chrome.tabs.create({ url })
})

// New recording
document.getElementById('btn-new').addEventListener('click', async () => {
  await chrome.storage.session.clear()
  $title.value = ''
  showScreen('idle')
})

document.getElementById('btn-error-retry').addEventListener('click', async () => {
  await chrome.storage.session.clear()
  showScreen('idle')
})

// Settings toggle
document.getElementById('btn-settings').addEventListener('click', () => {
  const visible = $settingsPanel.style.display !== 'none'
  $settingsPanel.style.display = visible ? 'none' : ''
})

// Save URL
document.getElementById('btn-save-url').addEventListener('click', async () => {
  const url = $inputAppUrl.value.trim().replace(/\/$/, '')
  await chrome.storage.local.set({ appUrl: url })
  $settingsPanel.style.display = 'none'
})

// ── Storage helpers ───────────────────────────────────────────────────────
function storageGet(keys) {
  return new Promise((resolve) => chrome.storage.local.get(keys, resolve))
}

function storageSessionGet(keys) {
  return new Promise((resolve) => chrome.storage.session.get(keys, resolve))
}
