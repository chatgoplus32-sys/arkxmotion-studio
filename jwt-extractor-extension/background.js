let capturedTokens = [];
let capturedBasicAuth = null;

browser.webRequest.onBeforeSendHeaders.addListener(
  function (details) {
    for (const header of details.requestHeaders) {
      const name = header.name.toLowerCase();
      const val = header.value || '';

      // Capture Authorization header (Bearer JWT)
      if (name === 'authorization' && val) {
        if (val.startsWith('Bearer ') && val.length > 50) {
          const token = val.slice(7);
          if (!capturedTokens.includes(token)) {
            capturedTokens.unshift(token);
            if (capturedTokens.length > 20) capturedTokens.pop();
            browser.storage.local.set({ jwt_tokens: capturedTokens });
          }
        }
        // Capture Basic auth too
        if (val.startsWith('Basic ')) {
          capturedBasicAuth = val;
          browser.storage.local.set({ jwt_basic_auth: val });
        }
      }

      // Capture from common auth headers
      if ((name === 'x-csrf-token' || name === 'x-token' || name === 'x-auth-token') && val.length > 20) {
        if (!capturedTokens.includes(val)) {
          capturedTokens.unshift(val);
          browser.storage.local.set({ jwt_tokens: capturedTokens });
        }
      }
    }
  },
  { urls: ["<all_urls>"] },
  ["requestHeaders"]
);

browser.webRequest.onHeadersReceived.addListener(
  function (details) {
    for (const header of details.responseHeaders) {
      const name = header.name.toLowerCase();
      const val = header.value || '';

      // Capture Set-Cookie that might contain JWT
      if (name === 'set-cookie') {
        if (val.includes('token') || val.includes('jwt') || val.includes('session')) {
          const match = val.match(/=([A-Za-z0-9\-_]+\.[A-Za-z0-9\-_]+\.[A-Za-z0-9\-_]+)/);
          if (match && match[1]) {
            const token = match[1];
            if (!capturedTokens.includes(token)) {
              capturedTokens.unshift(token);
              browser.storage.local.set({ jwt_tokens: capturedTokens });
            }
          }
        }
      }

      // Capture Authorization from response headers
      if (name === 'authorization' && val.startsWith('Bearer ') && val.length > 50) {
        const token = val.slice(7);
        if (!capturedTokens.includes(token)) {
          capturedTokens.unshift(token);
          browser.storage.local.set({ jwt_tokens: capturedTokens });
        }
      }
    }
  },
  { urls: ["<all_urls>"] },
  ["responseHeaders"]
);

browser.runtime.onMessage.addListener((request, sender, sendResponse) => {
  if (request.action === 'getToken') {
    browser.storage.local.get(['jwt_tokens', 'jwt_basic_auth'], (result) => {
      const tokens = result.jwt_tokens || capturedTokens;
      const basicAuth = result.jwt_basic_auth || capturedBasicAuth;
      sendResponse({ tokens: tokens, basicAuth: basicAuth });
    });
    return true;
  }
  if (request.action === 'setToken') {
    if (request.token && !capturedTokens.includes(request.token)) {
      capturedTokens.unshift(request.token);
      browser.storage.local.set({ jwt_tokens: capturedTokens });
    }
    sendResponse({ success: true });
  }
  if (request.action === 'clearTokens') {
    capturedTokens = [];
    capturedBasicAuth = null;
    browser.storage.local.remove(['jwt_tokens', 'jwt_basic_auth']);
    sendResponse({ success: true });
  }
});
