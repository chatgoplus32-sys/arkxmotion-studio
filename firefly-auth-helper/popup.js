function showStatus(msg, type) {
  var el = document.getElementById('status');
  el.textContent = msg;
  el.className = 'status ' + (type === 'error' ? 'error' : type === 'warning' ? 'warning' : 'success');
  el.classList.remove('hidden');
  setTimeout(function() { el.classList.add('hidden'); }, 5000);
}

function updateStatus() {
  chrome.runtime.sendMessage({ type: 'GET_STATUS' }, function(resp) {
    var dot = document.getElementById('dot');
    if (resp && resp.capturing) {
      dot.className = 'indicator indicator-active';
      showStatus('Capturing active on tab ' + resp.tabId, 'success');
    } else {
      dot.className = 'indicator indicator-inactive';
    }
  });
}

function startCapture() {
  chrome.runtime.sendMessage({ type: 'START_CAPTURE' }, function(resp) {
    if (resp && resp.error) {
      showStatus(resp.error, 'error');
    } else if (resp && resp.ok) {
      updateStatus();
      showStatus(resp.message || 'Capture started!', 'success');
    }
  });
}

function stopCapture() {
  chrome.runtime.sendMessage({ type: 'STOP_CAPTURE' }, function(resp) {
    updateStatus();
    showStatus('Capture stopped');
  });
}

function grabToken() {
  chrome.storage.local.get(['capturedHeaders', 'capturedTime', 'requests'], function(result) {
    var h = result.capturedHeaders;
    var requests = result.requests || [];

    if (!h || Object.keys(h).length === 0) {
      if (requests.length > 0) {
        var withAuth = requests.filter(function(r) {
          return r.headers && (r.headers['Authorization'] || r.headers['authorization']);
        });
        showStatus('Ada ' + requests.length + ' requests, tapi ' + withAuth.length + ' punya Authorization. Klik "All Requests" untuk debug.', 'warning');
      } else {
        showStatus('No requests captured. Pastikan: 1) Tab firefly.adobe.com aktif 2) Klik Start Capture 3) Generate video', 'error');
      }
      return;
    }

    var auth = h['Authorization'] || h['authorization'] || '';
    var token = auth;
    if (token.startsWith('Bearer ')) token = token.substring(7);

    var apiKey = h['x-api-key'] || h['X-Api-Key'] || '';
    var account = h['x-gw-ims-user-id'] || h['X-Gw-Ims-User-Id'] || '';
    var session = h['x-arp-session-id'] || h['X-Arp-Session-Id'] || '';
    var ims = h['x-ims-user-id'] || h['X-Ims-User-Id'] || '';

    if (!token) {
      showStatus('No Bearer token. Headers: ' + Object.keys(h).join(', '), 'warning');
      document.getElementById('tokenArea').value = JSON.stringify(h, null, 2);
      document.getElementById('tokenSection').classList.remove('hidden');
      return;
    }

    var output = token;

    document.getElementById('tokenArea').value = output;
    document.getElementById('tokenSection').classList.remove('hidden');

    var age = Math.round((Date.now() - (result.capturedTime || 0)) / 1000);
    showStatus('Token grabbed! (captured ' + age + 's ago)', 'success');
  });
}

function showHeaders() {
  chrome.storage.local.get(['capturedHeaders', 'capturedUrl', 'capturedTime'], function(result) {
    var h = result.capturedHeaders;
    var container = document.getElementById('headersList');

    if (!h || Object.keys(h).length === 0) {
      container.innerHTML = '<span class="error">No headers captured.</span>';
      document.getElementById('headersSection').classList.remove('hidden');
      return;
    }

    var html = '';
    if (result.capturedUrl) {
      html += '<div class="header-row"><span class="header-name">URL</span><span class="header-val">' + result.capturedUrl.slice(0, 150) + '</span></div>';
    }
    if (result.capturedTime) {
      html += '<div class="header-row"><span class="header-name">Time</span><span class="header-val">' + new Date(result.capturedTime).toLocaleTimeString() + '</span></div>';
    }
    var keys = Object.keys(h).sort();
    keys.forEach(function(key) {
      var val = typeof h[key] === 'string' ? h[key] : JSON.stringify(h[key]);
      if (key.toLowerCase() === 'authorization') val = val.substring(0, 60) + '...';
      if (key.toLowerCase() === 'cookie') val = val.substring(0, 60) + '...';
      html += '<div class="header-row"><span class="header-name">' + key + '</span><span class="header-val">' + val + '</span></div>';
    });
    container.innerHTML = html;
    document.getElementById('headersSection').classList.remove('hidden');
  });
}

function showAllRequests() {
  chrome.storage.local.get('requests', function(result) {
    var requests = result.requests || [];
    var container = document.getElementById('allRequests');

    if (requests.length === 0) {
      container.innerHTML = '<span class="error">No requests captured. Click Start Capture first.</span>';
      document.getElementById('allSection').classList.remove('hidden');
      return;
    }

    var html = '';
    requests.slice(0, 50).forEach(function(r) {
      var time = new Date(r.timestamp).toLocaleTimeString();
      var method = r.method || 'GET';
      var url = r.url || '';
      var hasAuth = (r.headers && (r.headers['Authorization'] || r.headers['authorization'])) ? '🔑 AUTH' : '';
      var hasApi = (r.headers && (r.headers['X-Api-Key'] || r.headers['x-api-key'])) ? '🔑 API' : '';

      html += '<div class="req-item">';
      html += '<div><span class="req-time">' + time + '</span> <span class="req-method">' + method + '</span> ' + hasAuth + ' ' + hasApi + '</div>';
      html += '<div class="req-url">' + url.slice(0, 180) + '</div>';
      if (r.headers && Object.keys(r.headers).length > 0) {
        var hdrNames = Object.keys(r.headers).filter(function(k) {
          return k.toLowerCase().includes('auth') || k.toLowerCase().includes('api') || k.toLowerCase().includes('token') || k.toLowerCase().includes('x-');
        });
        if (hdrNames.length > 0) {
          html += '<div class="req-headers">Interesting: ' + hdrNames.join(', ') + '</div>';
        }
      }
      html += '</div>';
    });
    container.innerHTML = html;
    document.getElementById('allSection').classList.remove('hidden');
  });
}

function clearAll() {
  chrome.storage.local.set({ capturedHeaders: null, capturedUrl: null, capturedTime: null, requests: [] });
  chrome.action.setBadgeText({ text: '' });
  document.getElementById('tokenSection').classList.add('hidden');
  document.getElementById('headersSection').classList.add('hidden');
  document.getElementById('allSection').classList.add('hidden');
  showStatus('Cleared');
}

function copyToken() {
  var t = document.getElementById('tokenArea').value;
  if (t) navigator.clipboard.writeText(t).then(function() { showStatus('Copied!', 'success'); });
}

document.getElementById('btnStart').addEventListener('click', startCapture);
document.getElementById('btnStop').addEventListener('click', stopCapture);
document.getElementById('btnGrab').addEventListener('click', grabToken);
document.getElementById('btnShow').addEventListener('click', showHeaders);
document.getElementById('btnAll').addEventListener('click', showAllRequests);
document.getElementById('btnClear').addEventListener('click', clearAll);
document.getElementById('btnCopy').addEventListener('click', copyToken);

updateStatus();