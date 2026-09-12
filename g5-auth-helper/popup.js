function showStatus(msg, isError) {
  var el = document.getElementById('status');
  el.textContent = msg;
  el.className = 'status' + (isError ? ' error' : '');
  el.classList.remove('hidden');
  setTimeout(function() { el.classList.add('hidden'); }, 3000);
}

function clearRequests() {
  chrome.storage.local.set({ capturedRequests: [], submitHeaders: null, firebaseToken: null, refreshToken: null });
  chrome.action.setBadgeText({ text: '' });
  document.getElementById('submitSection').classList.add('hidden');
  document.getElementById('allSection').classList.add('hidden');
  document.getElementById('tokenSection').classList.add('hidden');
  document.getElementById('firebaseSection').classList.add('hidden');
  showStatus('Cleared');
}

function showSubmitHeaders() {
  chrome.storage.local.get('submitHeaders', function(result) {
    var h = result.submitHeaders;
    var container = document.getElementById('submitHeaders');
    if (!h || Object.keys(h).length === 0) {
      container.innerHTML = '<span class="error">No headers captured. Submit motion control on G5 AI Studio first.</span>';
      document.getElementById('submitSection').classList.remove('hidden');
      document.getElementById('allSection').classList.add('hidden');
      document.getElementById('tokenSection').classList.add('hidden');
      document.getElementById('firebaseSection').classList.add('hidden');
      return;
    }

    var html = '';
    for (var key in h) {
      if (h.hasOwnProperty(key)) {
        var val = typeof h[key] === 'string' ? h[key] : JSON.stringify(h[key]);
        html += '<div class="header-row"><span class="header-name">' + key + '</span><span class="header-val">' + val + '</span></div>';
      }
    }
    container.innerHTML = html;
    document.getElementById('tokenArea').value = JSON.stringify(h, null, 2);
    document.getElementById('tokenSection').classList.remove('hidden');
    document.getElementById('submitSection').classList.remove('hidden');
    document.getElementById('allSection').classList.add('hidden');
    document.getElementById('firebaseSection').classList.add('hidden');
  });
}

function showFirebaseToken() {
  chrome.storage.local.get(['firebaseToken', 'firebaseTokenTime', 'submitHeaders', 'refreshToken'], function(result) {
    var container = document.getElementById('firebaseToken');
    var statusEl = document.getElementById('firebaseStatus');
    var token = null;

    // Priority 1: Direct firebase token capture
    if (result.firebaseToken) {
      token = result.firebaseToken;
      var age = Math.round((Date.now() - (result.firebaseTokenTime || 0)) / 1000);
      statusEl.innerHTML = '<span class="badge">Auto-captured (' + age + 's ago)</span>';
    }

    // Priority 2: From submit headers Authorization: Bearer xxx
    if (!token && result.submitHeaders) {
      var auth = result.submitHeaders['Authorization'] || result.submitHeaders['authorization'] || '';
      if (auth.startsWith('Bearer ')) {
        token = auth.substring(7);
        statusEl.innerHTML = '<span class="badge">From Headers</span>';
      }
    }

    // Priority 3: Show refresh token
    if (!token && result.refreshToken) {
      container.textContent = 'Refresh Token: ' + result.refreshToken + '\n\nGunakan ini untuk dapat idToken baru.';
      statusEl.innerHTML = '<span class="badge" style="background:#ffa726">Refresh Only</span>';
      document.getElementById('firebaseSection').classList.remove('hidden');
      return;
    }

    if (token) {
      container.textContent = token;
      document.getElementById('firebaseSection').classList.remove('hidden');
    } else {
      container.textContent = 'Belum ada token.\n\nPastikan:\n1. Reload extension\n2. Reload halaman G5 AI Studio (F5)\n3. Login\n4. Submit motion control\n5. Tunggu beberapa detik, lalu klik tombol ini lagi';
      statusEl.innerHTML = '';
      document.getElementById('firebaseSection').classList.remove('hidden');
    }
  });
}

function showAllRequests() {
  chrome.storage.local.get('capturedRequests', function(result) {
    var requests = result.capturedRequests || [];
    var container = document.getElementById('allRequests');

    if (requests.length === 0) {
      container.innerHTML = '<span class="error">No requests captured yet.</span>';
      document.getElementById('allSection').classList.remove('hidden');
      document.getElementById('submitSection').classList.add('hidden');
      document.getElementById('tokenSection').classList.add('hidden');
      document.getElementById('firebaseSection').classList.add('hidden');
      return;
    }

    var html = '';
    requests.slice(0, 20).forEach(function(r) {
      var time = new Date(r.timestamp).toLocaleTimeString();
      var path = r.url.replace('https://aistudio-backend.calmdesert-ca599847.centralindia.azurecontainerapps.io', '').replace('https://', '');
      var hc = Object.keys(r.headers || {}).length;
      html += '<div class="card"><div style="font-size:11px;color:#78909c">' + time + ' ' + r.method + ' (' + hc + ' h)</div><div style="font-size:10px;color:#4fc3f7;word-break:break-all">' + path + '</div></div>';
    });
    container.innerHTML = html;
    document.getElementById('allSection').classList.remove('hidden');
    document.getElementById('submitSection').classList.add('hidden');
    document.getElementById('tokenSection').classList.add('hidden');
    document.getElementById('firebaseSection').classList.add('hidden');
  });
}

function copyToClipboard() {
  var t = document.getElementById('tokenArea').value;
  if (t) navigator.clipboard.writeText(t).then(function() { showStatus('Headers JSON copied!'); });
}

function copyFirebaseToken() {
  var t = document.getElementById('firebaseToken').textContent;
  if (t) navigator.clipboard.writeText(t).then(function() { showStatus('Firebase token copied!'); });
}

async function reInject() {
  try {
    var tabs = await chrome.tabs.query({ active: true, currentWindow: true });
    var tab = tabs[0];
    if (!tab || !tab.url || !tab.url.includes('galleri5.com')) {
      showStatus('Buka aistudio.galleri5.com dulu!', true);
      return;
    }
    await chrome.scripting.executeScript({ target: { tabId: tab.id }, files: ['inject.js'] });
    showStatus('Re-injected! Submit motion control, then check token.');
  } catch (e) {
    showStatus('Error: ' + e.message, true);
  }
}

document.getElementById('btnShow').addEventListener('click', showSubmitHeaders);
document.getElementById('btnAll').addEventListener('click', showAllRequests);
document.getElementById('btnClear').addEventListener('click', clearRequests);
document.getElementById('btnInject').addEventListener('click', reInject);
document.getElementById('btnCopy').addEventListener('click', copyToClipboard);
document.getElementById('btnFirebase').addEventListener('click', showFirebaseToken);
document.getElementById('btnCopyFirebase').addEventListener('click', copyFirebaseToken);

document.addEventListener('DOMContentLoaded', function() {
  chrome.storage.local.get('submitHeaders', function(result) {
    if (result.submitHeaders && Object.keys(result.submitHeaders).length > 0) {
      showSubmitHeaders();
    }
  });
});
