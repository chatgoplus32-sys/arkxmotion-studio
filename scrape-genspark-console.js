// ═══════════════════════════════════════════════════════════════
// 🎯 Genspark API Request Scraper
// Copy-paste script ini ke console browser di https://www.genspark.ai/
// Setelah itu generate video motion control — semua request akan di-log
// ═══════════════════════════════════════════════════════════════

(function() {
  'use strict';
  
  const intercepted = [];
  
  // ─── 1. Intercept fetch() ──────────────────────────────
  const originalFetch = window.fetch;
  window.fetch = async function(...args) {
    const [url, options] = args;
    const urlStr = typeof url === 'string' ? url : url?.url || '';
    
    // Log semua request ke Genspark API
    if (urlStr.includes('tool_cli') || urlStr.includes('llm_proxy') || 
        urlStr.includes('video_generation') || urlStr.includes('tool_cli/models')) {
      
      const entry = {
        timestamp: new Date().toISOString(),
        method: options?.method || 'GET',
        url: urlStr,
        headers: options?.headers ? Object.fromEntries(
          options.headers instanceof Headers ? options.headers.entries() : Object.entries(options.headers)
        ) : null,
        body: null,
        responsePreview: null,
      };
      
      // Parse body
      if (options?.body) {
        try {
          entry.body = typeof options.body === 'string' ? JSON.parse(options.body) : options.body;
        } catch {
          entry.body = String(options.body).slice(0, 500);
        }
      }
      
      console.log('%c[SCRAPER] 🚀 REQUEST CAPTURED', 'color: #00ff00; font-weight: bold; font-size: 14px;');
      console.log(`  Method: ${entry.method}`);
      console.log(`  URL: ${entry.url}`);
      console.log(`  Body:`, entry.body);
      console.log(`  Headers:`, entry.headers);
      
      intercepted.push(entry);
      
      // Intercept response
      try {
        const response = await originalFetch.apply(this, args);
        const clone = response.clone();
        
        // Read response in background
        clone.text().then(text => {
          entry.responsePreview = text.slice(0, 2000);
          entry.responseStatus = response.status;
          console.log('%c[SCRAPER] 📥 RESPONSE CAPTURED', 'color: #ffaa00; font-weight: bold; font-size: 14px;');
          console.log(`  Status: ${response.status}`);
          console.log(`  Response (preview):`, text.slice(0, 1000));
        }).catch(() => {});
        
        return response;
      } catch (err) {
        console.error('[SCRAPER] Fetch error:', err);
        throw err;
      }
    }
    
    // Non-API requests — pass through unchanged
    return originalFetch.apply(this, args);
  };
  
  // ─── 2. Intercept XMLHttpRequest ───────────────────────
  const originalXHROpen = XMLHttpRequest.prototype.open;
  const originalXHRSend = XMLHttpRequest.prototype.send;
  
  XMLHttpRequest.prototype.open = function(method, url, ...rest) {
    this._scraperMethod = method;
    this._scraperUrl = url;
    return originalXHROpen.call(this, method, url, ...rest);
  };
  
  XMLHttpRequest.prototype.send = function(body) {
    const url = this._scraperUrl || '';
    if (url.includes('tool_cli') || url.includes('llm_proxy') || url.includes('video_generation')) {
      let parsedBody = null;
      try { parsedBody = body ? JSON.parse(body) : null; } catch { parsedBody = String(body).slice(0, 500); }
      
      console.log('%c[SCRAPER] 🚀 XHR REQUEST', 'color: #00ff00; font-weight: bold;');
      console.log(`  Method: ${this._scraperMethod}`);
      console.log(`  URL: ${url}`);
      console.log(`  Body:`, parsedBody);
      
      const entry = {
        timestamp: new Date().toISOString(),
        method: this._scraperMethod,
        url: url,
        body: parsedBody,
        type: 'xhr',
      };
      intercepted.push(entry);
      
      this.addEventListener('load', function() {
        entry.responsePreview = this.responseText?.slice(0, 2000);
        entry.responseStatus = this.status;
        console.log('%c[SCRAPER] 📥 XHR RESPONSE', 'color: #ffaa00; font-weight: bold;');
        console.log(`  Status: ${this.status}`);
        console.log(`  Response:`, this.responseText?.slice(0, 1000));
      });
    }
    return originalXHRSend.call(this, body);
  };
  
  // ─── 3. Utility functions ──────────────────────────────
  window.gensparkScrapeResults = intercepted;
  
  window.gensparkScrapeExport = function() {
    console.log('%c[SCRAPER] 📋 ALL CAPTURED REQUESTS', 'color: #00aaff; font-weight: bold; font-size: 16px;');
    console.table(intercepted.map(e => ({
      time: e.timestamp?.slice(11, 19),
      method: e.method,
      url: e.url?.slice(-60),
      hasBody: !!e.body,
      bodyModel: e.body?.model || e.body?.query?.slice(0, 50) || '-',
      bodyKeys: e.body ? Object.keys(e.body).join(', ') : '-',
      status: e.responseStatus || 'pending',
    })));
    console.log('%c[SCRAPER] 💾 Copy all: copy(gensparkScrapeResults)', 'color: #aaa; font-size: 12px');
    return intercepted;
  };
  
  window.gensparkScrapeClear = function() {
    intercepted.length = 0;
    console.log('%c[SCRAPER] 🗑️ Cleared', 'color: #ff6666');
  };
  
  // ─── 4. Fetch API Schema ───────────────────────────────
  window.gensparkScrapeSchema = async function() {
    console.log('%c[SCRAPER] 🔍 Fetching /api/tool_cli/tools schema...', 'color: #aa00ff; font-weight: bold;');
    try {
      const res = await originalFetch('/api/tool_cli/tools', {
        headers: { 'X-GSK-CLI-Caps': 'video_generation' }
      });
      const data = await res.json();
      console.log('%c[SCRAPER] ✅ Tool schema loaded!', 'color: #00ff00; font-weight: bold;');
      console.log(data);
      
      // Find video_generation tool
      const tools = data?.tools || data?.data?.tools || [];
      for (const tool of tools) {
        if (tool.name === 'video_generation') {
          console.log('%c[SCRAPER] 🎬 video_generation schema:', 'color: #ff00ff; font-weight: bold;');
          console.log(JSON.stringify(tool, null, 2));
          
          // Extract model enum
          const modelParam = tool.parameters?.properties?.model;
          if (modelParam?.enum) {
            console.log('%c[SCRAPER] 📋 Available models:', 'color: #00ffff; font-size: 14px');
            console.table(modelParam.enum.map(m => ({ model: m })));
          }
          
          // Extract all param names
          console.log('%c[SCRAPER] 📋 All parameters:', 'color: #00ffff; font-size: 14px');
          const props = tool.parameters?.properties || {};
          console.table(Object.entries(props).map(([name, def]) => ({
            name,
            type: def.type || (def.enum ? 'enum: ' + def.enum.join('|') : '?'),
            description: (def.description || '').slice(0, 80),
            default: def.default || '-',
            enum: def.enum?.join(', ') || '-',
          })));
        }
      }
      return data;
    } catch (err) {
      console.error('[SCRAPER] Schema fetch error:', err);
    }
  };
  
  // ─── 5. Instructions ───────────────────────────────────
  console.log('%c═══════════════════════════════════════════════════', 'color: #00ff00');
  console.log('%c🎯 Genspark API Scraper ACTIVE', 'color: #00ff00; font-weight: bold; font-size: 16px');
  console.log('%c═══════════════════════════════════════════════════', 'color: #00ff00');
  console.log(`
  Commands:
  
  gensparkScrapeSchema()     — Fetch video_generation API schema
  gensparkScrapeExport()     — Export all captured requests
  gensparkScrapeClear()      — Clear captured data
  gensparkScrapeResults      — Raw array of captured requests
  
  Cara pakai:
  1. Jalankan: gensparkScrapeSchema()
  2. Generate video motion control di Genspark
  3. Semua request + response otomatis di-log di console
  4. Export: gensparkScrapeExport()
  5. Copy hasilnya ke sini (Chat Codebuff)
  `);
})();
