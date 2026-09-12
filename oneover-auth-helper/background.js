chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
  if (msg.type === 'TOKENS_CAPTURED') {
    chrome.storage.local.set({
      accessToken: msg.accessToken,
      refreshToken: msg.refreshToken,
      capturedTime: Date.now(),
    })
    chrome.action.setBadgeText({ text: '!' })
    chrome.action.setBadgeBackgroundColor({ color: '#a78bfa' })
  }
  if (msg.type === 'DEBUG_INFO') {
    chrome.storage.local.set({
      debugInfo: msg.debug,
      capturedTime: Date.now(),
    })
  }
})