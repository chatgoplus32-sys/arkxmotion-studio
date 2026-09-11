/**
 * 🔑 Auto-Fetch Genspark Cookies via Server Proxy
 * 
 * Jalankan di Console ARKXMotion (localhost:5173).
 * Script ini akan:
 * 1. Fetch /api/user dari Genspark lewat server proxy
 * 2. Tangkap Set-Cookie headers
 * 3. Simpan ke localStorage otomatis
 * 
 * CATATAN: Set-Cookie dari proxy TIDAK termasuk cf_clearance
 * (karena cf_clearance hanya didapat dari Cloudflare challenge di browser)
 * Script ini hanya work kalau cf_clearance sudah ada di browser Genspark.
 */
(async function autoFetchCookies() {
  console.log('🔑 [Auto-Fetch] Mulai...')
  
  const GENSPARK_BASE = '/api/public/genspark'
  
  try {
    // Step 1: Hit Genspark /api/user lewat proxy
    console.log('🔑 [Auto-Fetch] Fetching /api/user...')
    const res = await fetch(`${GENSPARK_BASE}/api/user`, {
      credentials: 'include',
    })
    
    console.log(`🔑 [Auto-Fetch] Response: ${res.status}`)
    
    // Step 2: Get Set-Cookie headers (these come from Genspark server)
    const setCookies = res.headers.getSetCookie?.() || []
    console.log(`🔑 [Auto-Fetch] Set-Cookie headers: ${setCookies.length}`)
    setCookies.forEach((c, i) => console.log(`  ${i + 1}. ${c.slice(0, 80)}...`))
    
    // Step 3: Combine with existing cookies from localStorage
    const raw = localStorage.getItem('arkxmotion.providers')
    const parsed = raw ? JSON.parse(raw) : {}
    const genspark = parsed['genspark'] || []
    const active = genspark.find((k) => k.status === 'active' || k.status === 'unknown') || genspark[0]
    
    if (!active) {
      console.log('❌ No Genspark provider found. Add API key first.')
      return
    }
    
    // Step 4: Build cookie string
    const existingCookies = active.cookies || ''
    const newCookies = setCookies.map(c => c.split(';')[0]).join('; ')
    
    // Merge: keep existing cf_clearance if present, add new cookies
    let finalCookies = ''
    if (existingCookies.includes('cf_clearance=')) {
      // Keep cf_clearance from existing, add new cookies
      const cfMatch = existingCookies.match(/cf_clearance=[^;]+/)?.[0] || ''
      finalCookies = [cfMatch, newCookies].filter(Boolean).join('; ')
      console.log('🔑 [Auto-Fetch] Kept existing cf_clearance')
    } else {
      finalCookies = newCookies || existingCookies
      console.log('⚠️ [Auto-Fetch] No cf_clearance found — ask_proxy will still fail')
    }
    
    // Step 5: Save to localStorage
    active.cookies = finalCookies
    localStorage.setItem('arkxmotion.providers', JSON.stringify(parsed))
    
    console.log(`\n═══════════════════════════════════════════════════════`)
    console.log(`✅ Cookies updated! (${finalCookies.length} chars)`)
    if (!finalCookies.includes('cf_clearance=')) {
      console.log(`\n⚠️ PERINGATAN: cf_clearance TIDAK ada!`)
      console.log(`ask_proxy akan tetap gagal 403.`)
      console.log(`\nUntuk mendapatkan cf_clearance:`)
      console.log(`1. Buka genspark.ai di Chrome`)
      console.log(`2. F12 → Console → jalankan get-genspark-cookies.js`)
      console.log(`3. Copy hasilnya → paste ke Session Cookies field`)
    } else {
      console.log(`\n✅ cf_clearance ADA — ask_proxy seharusnya work!`)
    }
    console.log(`═══════════════════════════════════════════════════════\n`)
    
  } catch (err) {
    console.error('❌ [Auto-Fetch] Error:', err.message)
  }
})()
