let attachedTabId = null;
let capturing = false;

chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
  if (msg.type === 'START_CAPTURE') {
    startCapture(sendResponse);
    return true;
  }
  if (msg.type === 'STOP_CAPTURE') {
    stopCapture(sendResponse);
    return true;
  }
  if (msg.type === 'GET_STATUS') {
    sendResponse({ capturing, tabId: attachedTabId });
    return true;
  }
});

async function startCapture(sendResponse) {
  try {
    const tabs = await chrome.tabs.query({ active: true, currentWindow: true });
    const tab = tabs[0];
    if (!tab) {
      sendResponse({ error: 'No active tab' });
      return;
    }

    if (!tab.url || !tab.url.includes('firefly.adobe.com')) {
      sendResponse({ error: 'Buka firefly.adobe.com dulu!' });
      return;
    }

    if (capturing && attachedTabId === tab.id) {
      sendResponse({ ok: true, message: 'Already capturing' });
      return;
    }

    if (capturing) {
      await stopCapture(() => {});
    }

    chrome.debugger.attach({ tabId: tab.id }, '1.3', () => {
      if (chrome.runtime.lastError) {
        sendResponse({ error: chrome.runtime.lastError.message });
        return;
      }

      attachedTabId = tab.id;
      capturing = true;

      chrome.debugger.sendCommand({ tabId: tab.id }, 'Network.enable', {}, () => {
        if (chrome.runtime.lastError) {
          sendResponse({ error: chrome.runtime.lastError.message });
          return;
        }
        sendResponse({ ok: true, message: 'Capturing started on: ' + tab.url });
      });
    });
    return true;
  } catch (e) {
    sendResponse({ error: e.message });
  }
}

async function stopCapture(sendResponse) {
  try {
    if (attachedTabId !== null) {
      chrome.debugger.detach({ tabId: attachedTabId }, () => {
        attachedTabId = null;
        capturing = false;
        chrome.action.setBadgeText({ text: '' });
        sendResponse({ ok: true });
      });
    } else {
      capturing = false;
      sendResponse({ ok: true });
    }
  } catch (e) {
    capturing = false;
    attachedTabId = null;
    sendResponse({ error: e.message });
  }
}

chrome.debugger.onEvent.addListener((source, method, params) => {
  if (method === 'Network.requestWillBeSent') {
    const req = params.request;
    const url = req.url || '';
    const methodStr = req.method || 'GET';
    const headers = req.headers || {};

    const entry = {
      url,
      method: methodStr,
      headers,
      timestamp: Date.now()
    };

    chrome.storage.local.get('requests', (result) => {
      const requests = result.requests || [];
      requests.unshift(entry);
      if (requests.length > 100) requests.pop();
      chrome.storage.local.set({ requests });
    });

    const auth = headers['Authorization'] || headers['authorization'] || '';
    const apiKey = headers['X-Api-Key'] || headers['x-api-key'] || '';
    const cookie = headers['Cookie'] || headers['cookie'] || '';

    if (auth || apiKey) {
      chrome.storage.local.set({
        capturedHeaders: headers,
        capturedUrl: url,
        capturedTime: Date.now()
      });
      chrome.action.setBadgeText({ text: '!' });
      chrome.action.setBadgeBackgroundColor({ color: '#FF6A00' });
    }
  }
});

console.log('[Firefly Auth Helper] v1.2 background ready (debugger mode)');