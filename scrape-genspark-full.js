// ═══════════════════════════════════════════════════════════════════════════════
// 🎯 GENSPIRIT — Full Flow Scraper for Kling V3 Motion Control
// ═══════════════════════════════════════════════════════════════════════════════
//
// CARA PAKAI:
// 1. Login ke https://www.genspark.ai/
// 2. Buka Console (F12 → Console)
// 3. Copy-paste SELURUH script ini → Enter
// 4. Buka tab Video Generation → pilih "Kling V3 Motion Control"
// 5. Upload image + video → Generate
// 6. Script akan capture SEMUA request, SSE stream, tool calls, polling
// 7. Ketik: scrapeExport() untuk lihat hasil lengkap
// 8. Copy paste hasilnya ke sini
//
// ═══════════════════════════════════════════════════════════════════════════════

(function() {
  'use strict';

  const log = [];
  const SSE_EVENTS = [];
  const TOOL_CALLS = [];
  const API_REQUESTS = [];
  const _SESSION_STATE = {};

  // ─── Pretty print helpers ──────────────────────────────────────────────
  const C = {
    green: 'color: #00ff00; font-weight: bold',
    yellow: 'color: #ffaa00; font-weight: bold',
    red: 'color: #ff4444; font-weight: bold',
    blue: 'color: #00aaff; font-weight: bold',
    magenta: 'color: #ff00ff; font-weight: bold',
    cyan: 'color: #00ffff',
    dim: 'color: #888',
    bold: 'font-weight: bold; font-size: 14px',
  };

  function stamp() { return new Date().toISOString().slice(11, 23); }

  // ═══════════════════════════════════════════════════════════════════════
  // 1. INTERCEPT fetch()
  // ═══════════════════════════════════════════════════════════════════════
  const _fetch = window.fetch;
  window.fetch = async function(...args) {
    const [input, init] = args;
    const url = typeof input === 'string' ? input : input?.url || '';
    const method = init?.method || 'GET';
    const entry = { ts: stamp(), method, url, type: 'fetch' };

    // Capture request body
    if (init?.body) {
      try {
        entry.requestBody = typeof init.body === 'string' ? JSON.parse(init.body) : init.body;
      } catch {
        entry.requestBody = String(init.body).slice(0, 5000);
      }
    }

    // Capture headers (filter interesting ones)
    if (init?.headers) {
      const h = init.headers instanceof Headers
        ? Object.fromEntries(init.headers.entries())
        : { ...init.headers };
      entry.headers = h;
    }

    // ── Log ALL API requests (not just Genspark) ──────────────────────
    const isAPI = url.includes('/api/') || url.includes('tool_cli') ||
                  url.includes('llm_proxy') || url.includes('video_generation') ||
                  url.includes('sentry') || url.includes('analytics');
    const isGenspark = url.includes('genspark');

    if (isAPI || isGenspark) {
      API_REQUESTS.push(entry);
      console.log(`%c[${stamp()}] 🌐 ${method} ${url.slice(0, 100)}`, C.blue);
      if (entry.requestBody) {
        console.log(`%c  Body:`, C.dim, entry.requestBody);
      }
    }

    // ── Capture SSE/streaming requests ────────────────────────────────
    const isStream = url.includes('/llm_proxy') || url.includes('/chat') ||
                     init?.headers?.['Accept'] === 'text/event-stream';

    try {
      const response = await _fetch.apply(this, args);

      if (isStream && response.body) {
        const clone = response.clone();
        entry.type = 'sse-stream';

        console.log(`%c[${stamp()}] 📡 SSE STREAM STARTED: ${url.slice(0, 80)}`, C.magenta);

        // Read SSE stream in background
        (async () => {
          try {
            const reader = clone.body.getReader();
            const decoder = new TextDecoder();
            let buffer = '';

            while (true) {
              const { done, value } = await reader.read();
              if (done) break;
              buffer += decoder.decode(value, { stream: true });

              // Process complete SSE lines
              const lines = buffer.split('\n');
              buffer = lines.pop() || '';

              for (const line of lines) {
                if (line.startsWith('data: ')) {
                  const data = line.slice(6);
                  if (data === '[DONE]') {
                    console.log(`%c[${stamp()}] 📡 SSE [DONE]`, C.magenta);
                    SSE_EVENTS.push({ ts: stamp(), event: 'DONE', url });
                    continue;
                  }
                  try {
                    const parsed = JSON.parse(data);
                    const sseEntry = { ts: stamp(), url, data: parsed };

                    // ── Detect tool calls in SSE ──
                    const content = parsed.choices?.[0]?.delta?.content ||
                                    parsed.choices?.[0]?.message?.content ||
                                    parsed.content || '';
                    if (content) {
                      // Check for tool_call patterns
                      if (content.includes('tool_call') || content.includes('function_call') ||
                          content.includes('video_generation') || content.includes('tool_cli')) {
                        sseEntry.isToolCall = true;
                        console.log(`%c[${stamp()}] 🔧 TOOL CALL DETECTED in SSE`, C.yellow);
                        console.log(`%c  ${content.slice(0, 300)}`, C.yellow);
                        TOOL_CALLS.push({ ts: stamp(), source: 'sse', content });
                      }
                      sseEntry.contentPreview = content.slice(0, 200);
                    }

                    SSE_EVENTS.push(sseEntry);

                    // Log truncated for readability
                    const preview = JSON.stringify(parsed).slice(0, 300);
                    if (preview.length > 5) {
                      console.log(`%c  SSE: ${preview}`, C.dim);
                    }
                  } catch {
                    // Non-JSON SSE data
                    if (data.length > 3) {
                      SSE_EVENTS.push({ ts: stamp(), url, raw: data.slice(0, 500) });
                    }
                  }
                } else if (line.trim()) {
                  // Non-data SSE lines (event:, id:, retry:)
                  if (line.startsWith('event:')) {
                    console.log(`%c  SSE Event: ${line}`, C.cyan);
                  }
                }
              }
            }
          } catch (err) {
            console.warn('[SCRAPER] SSE read error:', err.message);
          }
        })();
      }

      // ── Log API responses ──────────────────────────────────────────
      if (isAPI || isGenspark) {
        const status = response.status;
        const clone = response.clone();
        entry.responseStatus = status;

        clone.text().then(text => {
          entry.responseBody = text.slice(0, 5000);
          const color = status >= 200 && status < 300 ? C.green : C.red;
          console.log(`%c[${stamp()}] 📥 Response ${status} (${text.length} chars)`, color);
          if (text.length < 2000) {
            try {
              console.log(`%c  ${JSON.stringify(JSON.parse(text), null, 2).slice(0, 1500)}`, C.dim);
            } catch {
              console.log(`%c  ${text.slice(0, 1500)}`, C.dim);
            }
          } else {
            console.log(`%c  ${text.slice(0, 1500)}...`, C.dim);
          }
        }).catch(() => {});
      }

      return response;
    } catch (err) {
      console.error(`%c[${stamp()}] ❌ FETCH ERROR: ${url}`, C.red, err.message);
      throw err;
    }
  };

  // ═══════════════════════════════════════════════════════════════════════
  // 2. INTERCEPT XMLHttpRequest
  // ═══════════════════════════════════════════════════════════════════════
  const _xhrOpen = XMLHttpRequest.prototype.open;
  const _xhrSend = XMLHttpRequest.prototype.send;

  XMLHttpRequest.prototype.open = function(method, url, ...rest) {
    this._sc = { method, url };
    return _xhrOpen.call(this, method, url, ...rest);
  };

  XMLHttpRequest.prototype.send = function(body) {
    const s = this._sc;
    if (!s) return _xhrSend.call(this, body);

    const entry = { ts: stamp(), method: s.method, url: s.url, type: 'xhr' };
    if (body) {
      try { entry.requestBody = JSON.parse(body); } catch { entry.requestBody = String(body).slice(0, 3000); }
    }
    API_REQUESTS.push(entry);

    console.log(`%c[${stamp()}] 🌐 XHR ${s.method} ${s.url?.slice(0, 100)}`, C.blue);
    if (entry.requestBody) console.log(`%c  Body:`, C.dim, entry.requestBody);

    this.addEventListener('load', function() {
      entry.responseStatus = this.status;
      entry.responseBody = this.responseText?.slice(0, 5000);
      const color = this.status >= 200 && this.status < 300 ? C.green : C.red;
      console.log(`%c[${stamp()}] 📥 XHR Response ${this.status}`, color);
      if (this.responseText?.length < 2000) {
        console.log(`%c  ${this.responseText}`, C.dim);
      } else {
        console.log(`%c  ${this.responseText?.slice(0, 1500)}...`, C.dim);
      }
    });

    return _xhrSend.call(this, body);
  };

  // ═══════════════════════════════════════════════════════════════════════
  // 3. INTERCEPT WebSocket (if Genspark uses WS for real-time)
  // ═══════════════════════════════════════════════════════════════════════
  const _ws = window.WebSocket;
  window.WebSocket = function(...args) {
    const ws = new _ws(...args);
    const url = args[0];
    console.log(`%c[${stamp()}] 🔌 WebSocket opened: ${url}`, C.cyan);

    ws.addEventListener('message', (evt) => {
      let data = evt.data;
      try { data = JSON.parse(data); } catch {}
      const entry = { ts: stamp(), url, data, type: 'ws' };
      SSE_EVENTS.push(entry);
      console.log(`%c  WS: ${JSON.stringify(data).slice(0, 300)}`, C.cyan);
    });

    return ws;
  };
  window.WebSocket.prototype = _ws.prototype;

  // ═══════════════════════════════════════════════════════════════════════
  // 4. MONITOR CONSOLE for Genspark logs
  // ═══════════════════════════════════════════════════════════════════════
  const _log = console.log;
  const _warn = console.warn;
  const _err = console.error;

  console.log = function(...args) {
    const text = args.map(a => typeof a === 'string' ? a : JSON.stringify(a)).join(' ');
    if (text.includes('genspark') || text.includes('tool_cli') ||
        text.includes('video_generation') || text.includes('kling') ||
        text.includes('motion')) {
      log.push({ ts: stamp(), level: 'log', text: text.slice(0, 2000) });
    }
    return _log.apply(console, args);
  };

  console.warn = function(...args) {
    const text = args.map(a => typeof a === 'string' ? a : JSON.stringify(a)).join(' ');
    if (text.includes('genspark') || text.includes('error') || text.includes('fail')) {
      log.push({ ts: stamp(), level: 'warn', text: text.slice(0, 2000) });
    }
    return _warn.apply(console, args);
  };

  console.error = function(...args) {
    const text = args.map(a => typeof a === 'string' ? a : JSON.stringify(a)).join(' ');
    log.push({ ts: stamp(), level: 'error', text: text.slice(0, 2000) });
    return _err.apply(console, args);
  };

  // ═══════════════════════════════════════════════════════════════════════
  // 5. UTILITY FUNCTIONS
  // ═══════════════════════════════════════════════════════════════════════

  // ── Fetch API schema ──────────────────────────────────────────────
  window.scrapeSchema = async function() {
    console.log('%c━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━', C.green);
    console.log('%c🔍 Fetching /api/tool_cli/tools schema...', C.bold);
    console.log('%c━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━', C.green);

    const schemas = {};

    for (const endpoint of ['/api/tool_cli/tools', '/api/tool_cli/models']) {
      try {
        const res = await _fetch(endpoint, {
          headers: { 'X-GSK-CLI-Caps': 'video_generation' }
        });
        const data = await res.json();
        schemas[endpoint] = data;
        console.log(`%c✅ ${endpoint} loaded (${JSON.stringify(data).length} chars)`, C.green);

        // Find video_generation tool
        if (endpoint.includes('tools')) {
          const tools = data?.tools || data?.data?.tools || [];
          for (const tool of tools) {
            if (tool.name === 'video_generation' || tool.name?.includes('video')) {
              console.log(`%c\n🎬 Tool: ${tool.name}`, C.bold);
              console.log(`%c  Description: ${tool.description}`, C.dim);

              // Model enum
              const modelProp = tool.parameters?.properties?.model;
              if (modelProp?.enum) {
                console.log('%c  📋 Models:', C.bold);
                console.table(modelProp.enum.map(m => ({ model: m })));
                schemas.models = modelProp.enum;
              }

              // All parameters
              const props = tool.parameters?.properties || {};
              console.log('%c  📋 Parameters:', C.bold);
              const paramTable = Object.entries(props).map(([name, def]) => ({
                name,
                type: def.type || (def.enum ? `enum: ${def.enum.length} values` : '?'),
                description: (def.description || '').slice(0, 100),
                default: String(def.default ?? '-'),
                required: (tool.parameters?.required || []).includes(name) ? 'YES' : 'no',
              }));
              console.table(paramTable);
              schemas.parameters = paramTable;
            }
          }
        }

        // For /api/tool_cli/models — show all available models
        if (endpoint.includes('models')) {
          console.log('%c\n📋 Model list:', C.bold);
          console.log(data);
        }
      } catch (err) {
        console.error(`%c❌ ${endpoint} error: ${err.message}`, C.red);
      }
    }

    return schemas;
  };

  // ── Fetch agent config (for Kling V3 Motion Control) ──────────────
  window.scrapeAgent = async function(agentId) {
    if (!agentId) {
      // List all agents first
      console.log('%c🔍 Listing agents...', C.bold);
      try {
        const res = await _fetch('/api/agents?type=video_generation_agent');
        const data = await res.json();
        console.log(data);
        console.log('%c\nCopy an agent ID and run: scrapeAgent("AGENT_ID")', C.dim);
        return data;
      } catch (err) {
        console.error('Agent list error:', err.message);
      }
    }

    console.log(`%c🔍 Fetching agent ${agentId}...`, C.bold);
    try {
      const res = await _fetch(`/api/agents?id=${agentId}`);
      const data = await res.json();
      console.log('%c✅ Agent config:', C.green);
      console.log(JSON.stringify(data, null, 2));
      return data;
    } catch (err) {
      console.error('Agent config error:', err.message);
    }
  };

  // ── Export all captured data ──────────────────────────────────────
  window.scrapeExport = function() {
    const result = {
      capturedAt: new Date().toISOString(),
      apiRequests: API_REQUESTS,
      sseEvents: SSE_EVENTS.length,
      toolCalls: TOOL_CALLS,
      consoleLogs: log,
      sseEventSample: SSE_EVENTS.slice(-50),
    };

    console.log('%c━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━', C.yellow);
    console.log('%c📋 FULL EXPORT', C.bold);
    console.log('%c━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━', C.yellow);

    // Summary table
    console.log('%c\nAPI Requests:', C.bold);
    console.table(API_REQUESTS.map(r => ({
      time: r.ts,
      method: r.method,
      url: r.url?.slice(-70),
      hasBody: !!r.requestBody,
      status: r.responseStatus || 'pending',
      bodyPreview: typeof r.requestBody === 'object'
        ? (r.requestBody.model || r.requestBody.query || '').slice(0, 50)
        : '-',
    })));

    console.log(`%c\nSSE Events: ${SSE_EVENTS.length}`, C.bold);
    if (SSE_EVENTS.length > 0) {
      console.log('%cLast 5 SSE events:', C.dim);
      SSE_EVENTS.slice(-5).forEach(e => console.log('  ', e));
    }

    console.log(`%c\nTool Calls: ${TOOL_CALLS.length}`, C.bold);
    TOOL_CALLS.forEach(t => console.log('  ', t));

    console.log('%c\n💾 Copy full data: copy(scrapeExport())', C.bold);

    // Auto-copy to clipboard
    try {
      const json = JSON.stringify(result, null, 2);
      navigator.clipboard.writeText(json).then(() => {
        console.log('%c✅ Copied to clipboard!', C.green);
      });
      return result;
    } catch {
      return result;
    }
  };

  // ── Show summary ──────────────────────────────────────────────────
  window.scrapeSummary = function() {
    console.log('%c━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━', C.cyan);
    console.log('%c📊 SUMMARY', C.bold);
    console.log('%c━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━', C.cyan);
    console.log(`  API Requests: ${API_REQUESTS.length}`);
    console.log(`  SSE Events: ${SSE_EVENTS.length}`);
    console.log(`  Tool Calls: ${TOOL_CALLS.length}`);
    console.log(`  Console Logs: ${log.length}`);
  };

  // ── Clear all data ────────────────────────────────────────────────
  window.scrapeClear = function() {
    API_REQUESTS.length = 0;
    SSE_EVENTS.length = 0;
    TOOL_CALLS.length = 0;
    log.length = 0;
    console.log('%c🗑️ All data cleared', C.red);
  };

  // ═══════════════════════════════════════════════════════════════════════
  // 6. BOOT MESSAGE
  // ═══════════════════════════════════════════════════════════════════════
  console.log('%c', C.green);
  console.log('%c═══════════════════════════════════════════════════════════════', C.green);
  console.log('%c  🎯 GENSPARK FULL FLOW SCRAPER — ACTIVE', 'color: #00ff00; font-weight: bold; font-size: 18px');
  console.log('%c═══════════════════════════════════════════════════════════════', C.green);
  console.log(`
  📌 Commands:

  scrapeSchema()                    — Fetch full API schema (models, params)
  scrapeAgent()                     — List video generation agents
  scrapeAgent("agent-id")           — Fetch specific agent config

  scrapeSummary()                   — Quick summary of captured data
  scrapeExport()                    — Full export + auto-copy to clipboard
  scrapeClear()                     — Clear all captured data

  ──────────────────────────────────────────────────────────────────

  🎯 Full Flow Capture Guide:

  1. Run scrapeSchema() → see all models & parameters
  2. Open Kling V3 Motion Control page
  3. Upload image + video → click Generate
  4. Script captures:
     • 🌐 ALL API requests (URL, method, body, headers)
     • 📡 SSE streaming responses (real-time tool calls)
     • 🔧 Tool calls (video_generation, polling, etc.)
     • 📥 All responses (status, body)
  5. Run scrapeExport() → copy & paste to me

  ──────────────────────────────────────────────────────────────────
  `);

})();
