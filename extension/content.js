// 익스텐션 ↔ 웹앱 메시지 브릿지

// 익스텐션(background) → 웹앱(window)
chrome.runtime.onMessage.addListener((msg, _sender, sendResponse) => {
  if (msg.type === 'EXT_CMD') {
    window.postMessage({ source: 'meetnotes-ext', ...msg.payload }, '*')
    sendResponse({ ok: true })
  }
  return true
})

// 웹앱(window) → 익스텐션(background)
window.addEventListener('message', (event) => {
  if (event.source !== window) return
  if (event.data?.source !== 'meetnotes-app') return
  chrome.runtime.sendMessage({ type: 'APP_EVENT', event: event.data })
})
