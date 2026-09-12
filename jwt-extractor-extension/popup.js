document.addEventListener('DOMContentLoaded', () => {
  const tokenField = document.getElementById('token');
  const basicField = document.getElementById('basicAuth');
  const status = document.getElementById('status');
  const decodedSection = document.getElementById('decodedSection');
  const decodedPayload = document.getElementById('decoded');
  const tokenList = document.getElementById('tokenList');

  document.getElementById('btnRefresh').addEventListener('click', extractToken);
  document.getElementById('btnCopy').addEventListener('click', copyToken);
  document.getElementById('btnCopyBasic').addEventListener('click', copyBasic);
  document.getElementById('btnDecode').addEventListener('click', decodeToken);
  document.getElementById('btnClear').addEventListener('click', clearTokens);

  extractToken();

  function extractToken() {
    status.className = 'status info';
    status.textContent = 'Searching...';
    tokenField.value = '';
    basicField.value = '';

    browser.runtime.sendMessage({ action: 'getToken' }, (result) => {
      const tokens = (result && result.tokens) || [];
      const basicAuth = (result && result.basicAuth) || '';

      if (tokens.length > 0) {
        tokenField.value = tokens[0];
        status.className = 'status success';
        status.textContent = 'Found ' + tokens.length + ' token(s) from intercepted requests!';
      } else {
        status.className = 'status warning';
        status.textContent = 'No JWT found yet. Navigate the site to trigger API calls.';
      }

      if (basicAuth) {
        basicField.value = basicAuth;
      }

      renderTokenList(tokens);
    });
  }

  function renderTokenList(tokens) {
    if (!tokenList) return;
    tokenList.innerHTML = '';
    if (tokens.length <= 1) {
      tokenList.style.display = 'none';
      return;
    }
    tokenList.style.display = 'block';
    tokens.forEach((t, i) => {
      const btn = document.createElement('button');
      const display = t.startsWith('Bearer ') ? t.slice(7) : t;
      btn.textContent = 'Token ' + (i + 1) + ': ' + display.substring(0, 50) + '...';
      btn.style.cssText = 'width:100%;text-align:left;padding:6px 8px;margin-bottom:4px;background:#0f0f23;border:1px solid #334155;border-radius:4px;color:#a5f3fc;font-size:10px;cursor:pointer;font-family:monospace;word-break:break-all;';
      btn.onclick = () => {
        tokenField.value = display;
        status.className = 'status success';
        status.textContent = 'Selected token ' + (i + 1);
      };
      tokenList.appendChild(btn);
    });
  }

  function copyToken() {
    const token = tokenField.value;
    if (!token) { status.className = 'status error'; status.textContent = 'No token!'; return; }
    navigator.clipboard.writeText(token).then(() => {
      status.className = 'status success';
      status.textContent = 'JWT copied!';
    });
  }

  function copyBasic() {
    const val = basicField.value;
    if (!val) { status.className = 'status error'; status.textContent = 'No Basic auth!'; return; }
    navigator.clipboard.writeText(val).then(() => {
      status.className = 'status success';
      status.textContent = 'Basic auth copied!';
    });
  }

  function decodeToken() {
    const token = tokenField.value;
    if (!token) { status.className = 'status error'; status.textContent = 'No token!'; return; }
    try {
      const parts = token.replace('Bearer ', '').split('.');
      if (parts.length !== 3) throw new Error('Invalid JWT');
      const payload = JSON.parse(atob(parts[1].replace(/-/g, '+').replace(/_/g, '/')));
      decodedPayload.textContent = JSON.stringify(payload, null, 2);
      decodedSection.classList.add('active');
      status.className = 'status success';
      status.textContent = 'Decoded!';
    } catch (e) {
      status.className = 'status error';
      status.textContent = 'Failed: ' + e.message;
    }
  }

  function clearTokens() {
    browser.runtime.sendMessage({ action: 'clearTokens' }, () => {
      tokenField.value = '';
      basicField.value = '';
      if (tokenList) tokenList.innerHTML = '';
      decodedSection.classList.remove('active');
      status.className = 'status info';
      status.textContent = 'Cleared. Navigate the site and Refresh.';
    });
  }
});
