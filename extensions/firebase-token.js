// ─── Firebase Token Refresh — Node.js ──────────────────────────
// Jalankan: node firebase-token.js AMf-xxxxx

const FIREBASE_API_KEY = 'AIzaSyBejuWIKZ7yQT9bdG_jnb4RrkW3DoFCNNo'
const G5_BACKEND = 'https://aistudio-backend.calmdesert-ca599847.centralindia.azurecontainerapps.io'

async function refreshFirebaseToken(refreshToken) {
  const res = await fetch(
    `https://securetoken.googleapis.com/v1/token?key=${FIREBASE_API_KEY}`,
    {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: `grant_type=refresh_token&refresh_token=${encodeURIComponent(refreshToken)}`,
    }
  )
  if (!res.ok) {
    const err = await res.text()
    throw new Error(`HTTP ${res.status}: ${err}`)
  }
  return await res.json()
}

function decodeJwt(token) {
  const parts = token.split('.')
  const payload = Buffer.from(parts[1].replace(/-/g, '+').replace(/_/g, '/'), 'base64').toString('utf-8')
  return JSON.parse(payload)
}

async function getG5Balance(accessToken) {
  const res = await fetch(`${G5_BACKEND}/api/v1/auth/me/info`, {
    method: 'POST',
    headers: {
      'Accept': '*/*',
      'Authorization': `Bearer ${accessToken}`,
      'Content-Type': 'application/json',
    },
    body: '{}',
  })
  return await res.json()
}

async function main() {
  const refreshToken = process.argv[2]
  if (!refreshToken) {
    console.log(`
Usage: node firebase-token.js <refresh-token>

Example:
  node firebase-token.js AMf-xxxxxxxxxxxxxxxxxxxx

Get refresh token from:
  - aistudio.galleri5.com (login → F12 → Application → Local Storage)
  - Lemur Browser Extension (auto-capture)
`)
    process.exit(1)
  }

  console.log('🔄 Refreshing token...')

  const data = await refreshFirebaseToken(refreshToken)
  const idToken = data.id_token || data.access_token
  const newRefreshToken = data.refresh_token || refreshToken

  const payload = decodeJwt(idToken)

  console.log('\n✅ Token refreshed!\n')
  console.log('╔══════════════════════════════════════════════════════════╗')
  console.log('║  Token Info                                              ║')
  console.log('╠══════════════════════════════════════════════════════════╣')
  console.log(`║  Email:    ${(payload.email || '').padEnd(44)}║`)
  console.log(`║  Name:     ${(payload.name || '').padEnd(44)}║`)
  console.log(`║  User ID:  ${(payload.sub || '').padEnd(44)}║`)
  console.log(`║  Expires:  ${new Date(payload.exp * 1000).toLocaleString().padEnd(44)}║`)
  console.log('╚══════════════════════════════════════════════════════════╝')

  console.log('\n🔑 ID Token (paste ke ARKx → Providers → G5 AI Studio):')
  console.log(idToken)

  if (newRefreshToken !== refreshToken) {
    console.log('\n🔄 New Refresh Token (simpan ini, token lama sudah rotate):')
    console.log(newRefreshToken)
  }

  // Check balance
  console.log('\n💰 Checking balance...')
  try {
    const info = await getG5Balance(idToken)
    console.log('╔══════════════════════════════════════════════════════════╗')
    console.log('║  Balance                                                 ║')
    console.log('╠══════════════════════════════════════════════════════════╣')
    console.log(`║  Email:    ${(info.email || '').padEnd(44)}║`)
    console.log(`║  Plan:     ${(info.plan_name || '').padEnd(44)}║`)
    console.log(`║  Credits:  ${(info.available_credits + ' / ' + info.total_credits).padEnd(44)}║`)
    console.log(`║  Used:     ${String(info.credits_used).padEnd(44)}║`)
    console.log('╚══════════════════════════════════════════════════════════╝')
  } catch (e) {
    console.log('Balance check failed:', e.message)
  }
}

main().catch(console.error)
