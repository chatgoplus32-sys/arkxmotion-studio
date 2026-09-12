chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
  if (msg.type === 'CAPTURED_REQUEST') {
    chrome.storage.local.get('capturedRequests', (result) => {
      const requests = result.capturedRequests || [];
      requests.unshift(msg.data);
      if (requests.length > 50) requests.pop();
      chrome.storage.local.set({ capturedRequests: requests });
    });
  }

  if (msg.type === 'SUBMIT_HEADERS') {
    chrome.storage.local.set({ submitHeaders: msg.headers });
    chrome.action.setBadgeText({ text: '!' });
    chrome.action.setBadgeBackgroundColor({ color: '#4CAF50' });
  }

  if (msg.type === 'SUBMIT_RESPONSE') {
    chrome.storage.local.set({ lastSubmitResponse: msg.data });
  }

  if (msg.type === 'REFRESH_TOKEN') {
    chrome.storage.local.set({ refreshToken: msg.refreshToken });
  }

  if (msg.type === 'FIREBASE_TOKEN') {
    if (msg.token && msg.token.length > 20) {
      chrome.storage.local.set({ firebaseToken: msg.token, firebaseTokenTime: Date.now() });
      chrome.action.setBadgeText({ text: 'T' });
      chrome.action.setBadgeBackgroundColor({ color: '#FF9800' });
    }
  }
});
