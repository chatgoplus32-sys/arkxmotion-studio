/**
 * 🔑 Genspark Cookie Extractor
 * 
 * Jalankan di Console (F12) saat halaman https://www.genspark.ai/ terbuka.
 * Script ini akan:
 * 1. Intercept request ke Genspark API
 * 2. Copy SEMUA cookies (termasuk cf_clearance HttpOnly)
 * 3. Tampilkan hasilnya
 * 
 * CARA PAKAI:
 * 1. Buka https://www.genspark.ai/ di Chrome (pastikan SUDAH LOGIN)
 * 2. Tekan F12 → tab Console
 * 3. Paste script ini → Enter
 * 4. Script otomatis jalan dan tampilkan cookies
 * 5. Copy hasilnya → paste ke ARKXMotion → Providers → Genspark → 🍪 Session Cookies
 */
(async function extractGensparkCookies() {
  console.log('🔑 [Cookie Extractor] Mulai...')
  
  // Method 1: Intercept fetch to capture Cookie header
  const originalFetch = window.fetch
  let capturedCookies = ''
  
  window.fetch = function(...args) {
    const [url, options] = args
    const urlStr = typeof url === 'string' ? url : url?.url || ''
    
    // Intercept requests to Genspark API
    if (urlStr.includes('genspark.ai') || urlStr.includes('/api/')) {
      const headers = options?.headers || {}
      const cookieHeader = headers['Cookie'] || headers['cookie'] || ''
      if (cookieHeader && cookieHeader.length > capturedCookies.length) {
        capturedCookies = cookieHeader
        console.log(`🔑 [Cookie Extractor] Captured ${cookieHeader.length} chars from: ${urlStr.slice(0, 80)}`)
      }
    }
    
    return originalFetch.apply(this, args)
  }
  
  // Method 2: Also intercept XMLHttpRequest
  const originalXHROpen = XMLHttpRequest.prototype.open
  const originalXHRSetHeader = XMLHttpRequest.prototype.setRequestHeader
  
  XMLHttpRequest.prototype.open = function(method, url, ...rest) {
    this._cookieUrl = url
    this._cookieHeaders = {}
    return originalXHROpen.apply(this, [method, url, ...rest])
  }
  
  XMLHttpRequest.prototype.setRequestHeader = function(name, value) {
    if (name.toLowerCase() === 'cookie' && value.length > capturedCookies.length) {
      capturedCookies = value
      console.log(`🔑 [Cookie Extractor] Captured ${value.length} chars from XHR: ${this._cookieUrl?.slice(0, 80)}`)
    }
    this._cookieHeaders[name] = value
    return originalXHRSetHeader.apply(this, [name, value])
  }
  
  console.log('🔑 [Cookie Extractor] Interceptor aktif. Menunggu request ke Genspark...')
  console.log('🔑 [Cookie Extractor] TIP: Buka tab lain ke genspark.ai dan buka halaman apapun')
  
  // Wait for user to trigger a request, or trigger one ourselves
  await new Promise(r => setTimeout(r, 2000))
  
  // Try to trigger a request by fetching the user endpoint
  console.log('🔑 [Cookie Extractor] Triggering request ke /api/user...')
  try {
    await fetch('/api/user', { credentials: 'include' })
    await new Promise(r => setTimeout(r, 1000))
  } catch (e) {
    console.warn('[Cookie Extractor] Request gagal:', e.message)
  }
  
  // Try /api/models_config too
  try {
    await fetch('/api/models_config', { credentials: 'include' })
    await new Promise(r => setTimeout(r, 1000))
  } catch {}
  
  // Restore original functions
  window.fetch = originalFetch
  XMLHttpRequest.prototype.open = originalXHROpen
  XMLHttpRequest.prototype.setRequestHeader = originalXHRSetHeader
  
  // Check if we captured cookies
  if (capturedCookies) {
    console.log('\n═══════════════════════════════════════════════════════')
    console.log('✅ COOKIES BERHASIL DI-CAPTURE!')
    console.log(`📊 Total: ${capturedCookies.length} chars`)
    console.log('═══════════════════════════════════════════════════════')
    console.log('\n📋 COPY SEMUA TEKS DI BAWAH INI:\n')
    console.log(capturedCookies)
    console.log('\n═══════════════════════════════════════════════════════')
    console.log('📌 Cara pakai:')
    console.log('1. Copy teks di atas (klik kanan → Copy)')
    console.log('2. Buka ARKXMotion → Providers → Genspark AI')
    console.log('3. Paste ke field 🍪 Session Cookies')
    console.log('4. Klik Save')
    console.log('═══════════════════════════════════════════════════════\n')
    
    // Also try to copy to clipboard
    try {
      await navigator.clipboard.writeText(capturedCookies)
      console.log('📋 ✅ OTOMATIS COPIED ke clipboard! Langsung paste ke ARKXMotion.')
    } catch {
      console.log('📋 ⚠️ Gagal auto-copy. Klik kanan teks di atas → Copy.')
    }
  } else {
    console.log('\n❌ Gagal capture cookies.')
    console.log('Pastikan:')
    console.log('1. Halaman genspark.ai sudah terbuka dan login')
    console.log('2. Jalankan script ini di Console genspark.ai (bukan localhost)')
    console.log('3. Coba buka halaman lain di genspark.ai dulu, lalu jalankan lagi')
    
    // Fallback: try document.cookie
    const docCookies = document.cookie
    if (docCookies) {
      console.log('\n⚠️ document.cookie hanya berisi non-HttpOnly cookies:')
      console.log(docCookies.slice(0, 200) + '...')
      console.log('\nUntuk cf_clearance (HttpOnly), harus pakai method intercept.')
      console.log('Coba: buka Network tab → generate video → copy Cookie header dari request')
    }
  }
})()
