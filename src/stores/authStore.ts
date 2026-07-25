import { create } from 'zustand'

interface User {
  id: number
  email: string
  name: string
  role: string
  approved: boolean
}

interface StoredUser extends User {
  password: string
}

const USERS_KEY = 'arkxmotion_users'
const TOKEN_KEY = 'arkxmotion_token'

function getUsers(): StoredUser[] {
  const raw = localStorage.getItem(USERS_KEY)
  if (!raw) return []
  return JSON.parse(raw)
}

function saveUsers(users: StoredUser[]) {
  localStorage.setItem(USERS_KEY, JSON.stringify(users))
}

function seedAdmin() {
  const users = getUsers()
  if (users.length === 0) {
    saveUsers([
      { id: 1, email: 'admin@arkxmotion.com', name: 'Admin', password: 'admin123', role: 'admin', approved: true }
    ])
  }
}

seedAdmin()

interface AuthState {
  user: User | null
  token: string | null
  isAuthenticated: boolean
  isLoading: boolean
  login: (email: string, password: string) => Promise<{ error?: string }>
  register: (email: string, password: string, name: string) => Promise<{ error?: string; needsApproval?: boolean }>
  logout: () => void
  checkAuth: () => Promise<void>
}

export const useAuthStore = create<AuthState>((set) => ({
  user: null,
  token: localStorage.getItem(TOKEN_KEY),
  isAuthenticated: false,
  isLoading: true,

  login: async (email: string, password: string) => {
    const users = getUsers()
    const found = users.find(u => u.email === email && u.password === password)
    if (!found) return { error: 'Invalid email or password' }
    if (!found.approved) return { error: 'Account not approved yet. Please wait for admin approval.' }

    const token = `tok_${found.id}_${Date.now()}`
    const { password: _, ...safeUser } = found
    localStorage.setItem(TOKEN_KEY, token)
    localStorage.setItem('arkxmotion_user', JSON.stringify(safeUser))
    set({ user: safeUser, token, isAuthenticated: true })
    return {}
  },

  register: async (email: string, password: string, name: string) => {
    const users = getUsers()
    if (users.find(u => u.email === email)) {
      return { error: 'Email already registered' }
    }
    const newUser: StoredUser = {
      id: users.length > 0 ? Math.max(...users.map(u => u.id)) + 1 : 1,
      email, name, password,
      role: 'user',
      approved: true
    }
    saveUsers([...users, newUser])
    return { needsApproval: true }
  },

  logout: () => {
    localStorage.removeItem(TOKEN_KEY)
    localStorage.removeItem('arkxmotion_user')
    set({ user: null, token: null, isAuthenticated: false })
  },

  checkAuth: async () => {
    const token = localStorage.getItem(TOKEN_KEY)
    const userRaw = localStorage.getItem('arkxmotion_user')
    if (!token || !userRaw) {
      localStorage.removeItem(TOKEN_KEY)
      localStorage.removeItem('arkxmotion_user')
      set({ isLoading: false, isAuthenticated: false })
      return
    }
    try {
      const user = JSON.parse(userRaw) as User
      set({ user, isAuthenticated: true, isLoading: false })
    } catch {
      localStorage.removeItem(TOKEN_KEY)
      localStorage.removeItem('arkxmotion_user')
      set({ user: null, token: null, isAuthenticated: false, isLoading: false })
    }
  }
}))
