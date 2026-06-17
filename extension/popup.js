const DEFAULT_APP_URL = 'http://localhost:3000'

// ── DOM ───────────────────────────────────────────────────────────────────
const $settingsPanel = document.getElementById('settings-panel')
const $inputAppUrl   = document.getElementById('input-app-url')
const $inputTitle    = document.getElementById('input-title')
const $recTitleLabel = document.getElementById('rec-title-label')
const $errorMsg      = document.getElementById('error-msg')

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
  }
})()

// ── 녹음 시작 ─────────────────────────────────────────────────────────────
document.getElementById('btn-start').addEventListener('click', async () => {
  const title = $inputTitle.value.trim()
  const res = await chrome.runtime.sendMessage({ type: 'START_RECORDING', title })

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
  $inputTitle.value = ''
  show('screen-idle')
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

// ── 재시도 ────────────────────────────────────────────────────────────────
document.getElementById('btn-retry').addEventListener('click', () => {
  show('screen-idle')
})

// ── 설정 ──────────────────────────────────────────────────────────────────
document.getElementById('btn-settings').addEventListener('click', () => {
  $settingsPanel.style.display = $settingsPanel.style.display !== 'none' ? 'none' : ''
})

document.getElementById('btn-save-url').addEventListener('click', async () => {
  const url = $inputAppUrl.value.trim().replace(/\/$/, '')
  await chrome.storage.local.set({ appUrl: url })
  $settingsPanel.style.display = 'none'
})

// ── Storage helpers ───────────────────────────────────────────────────────
const localGet   = (k) => new Promise((r) => chrome.storage.local.get(k, r))
const sessionGet = (k) => new Promise((r) => chrome.storage.session.get(k, r))
