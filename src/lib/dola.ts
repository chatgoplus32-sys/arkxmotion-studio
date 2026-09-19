// Dola.com Chat API Client
// Uses session cookies stored in localStorage

const DOLA_BASE = '/api/dola'

export interface DolaConversation {
  conv_id: string
  title: string
  updated_at: number
  message_count?: number
}

export interface DolaMessage {
  role: 'user' | 'assistant' | 'system'
  content: string
  message_id?: string
  timestamp?: number
}

export interface DolaChatResponse {
  ok: boolean
  error?: string
  data?: any
}

// Get stored Dola cookies
function getDolaCookies(): string | null {
  if (typeof window === 'undefined') return null
  return localStorage.getItem('dola.cookies') || null
}

export function setDolaCookies(cookies: string) {
  localStorage.setItem('dola.cookies', cookies)
}

export function getDolaStatus(): { configured: boolean } {
  return { configured: !!getDolaCookies() }
}

// Fetch recent conversations
export async function fetchDolaConversations(): Promise<DolaConversation[]> {
  const cookies = getDolaCookies()
  if (!cookies) throw new Error('Belum ada Dola session. Login di dola.com lalu paste cookies.')

  const res = await fetch(`${DOLA_BASE}/conversations`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ cookies }),
  })

  const data = await res.json()
  if (!data.ok) throw new Error(data.error || 'Gagal mengambil conversations')
  return data.conversations || []
}

// Send a message and get response
export async function sendDolaMessage(
  convId: string | null,
  message: string,
  onChunk?: (text: string) => void
): Promise<string> {
  const cookies = getDolaCookies()
  if (!cookies) throw new Error('Belum ada Dola session.')

  const res = await fetch(`${DOLA_BASE}/chat`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ cookies, convId, message }),
  })

  const data = await res.json()
  if (!data.ok) throw new Error(data.error || 'Gagal mengirim pesan')
  return data.reply || ''
}

// Create new conversation
export async function createDolaConversation(title?: string): Promise<string> {
  const cookies = getDolaCookies()
  if (!cookies) throw new Error('Belum ada Dola session.')

  const res = await fetch(`${DOLA_BASE}/conversation/create`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ cookies, title }),
  })

  const data = await res.json()
  if (!data.ok) throw new Error(data.error || 'Gagal membuat conversation')
  return data.conv_id || ''
}

// Get conversation messages
export async function getDolaMessages(convId: string): Promise<DolaMessage[]> {
  const cookies = getDolaCookies()
  if (!cookies) throw new Error('Belum ada Dola session.')

  const res = await fetch(`${DOLA_BASE}/conversation/${convId}/messages`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ cookies }),
  })

  const data = await res.json()
  if (!data.ok) throw new Error(data.error || 'Gagal mengambil messages')
  return data.messages || []
}
