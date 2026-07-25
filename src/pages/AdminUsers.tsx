import { useState, useEffect, useCallback } from 'react'
import { PageHeader, PageContent } from '@/components/layout'
import { Section, Button } from '@/components/ui'
import { useAuthStore } from '@/stores/authStore'
import { useToastStore } from '@/stores/toastStore'
import { Users, CheckCircle, XCircle, Clock, Trash2, RefreshCw } from 'lucide-react'

interface User {
  id: number
  email: string
  name: string
  role: string
  approved: boolean
  created_at: string
}

export default function AdminUsersPage() {
  const [users, setUsers] = useState<User[]>([])
  const [filter, setFilter] = useState<'all' | 'pending' | 'approved'>('all')
  const [isLoading, setIsLoading] = useState(true)
  const [actionLoading, setActionLoading] = useState<number | null>(null)
  const token = useAuthStore((state) => state.token)
  const addToast = useToastStore((state) => state.addToast)

  const fetchUsers = useCallback(async () => {
    if (!token) return
    setIsLoading(true)
    try {
      const endpoint = filter === 'pending' ? '/api/admin/users/pending' : '/api/admin/users'
      const response = await fetch(endpoint, {
        headers: { 'Authorization': `Bearer ${token}` }
      })
      if (response.ok) {
        const data = await response.json()
        setUsers(data.users)
      }
    } catch {
      addToast('Failed to fetch users', 'error')
    } finally {
      setIsLoading(false)
    }
  }, [token, filter, addToast])

  useEffect(() => {
    fetchUsers()
  }, [fetchUsers])

  const handleApprove = async (userId: number) => {
    if (!token) return
    setActionLoading(userId)
    try {
      const response = await fetch(`/api/admin/users/${userId}/approve`, {
        method: 'POST',
        headers: { 'Authorization': `Bearer ${token}` }
      })
      if (response.ok) {
        addToast('User approved successfully', 'success')
        fetchUsers()
      } else {
        addToast('Failed to approve user', 'error')
      }
    } catch {
      addToast('Failed to approve user', 'error')
    } finally {
      setActionLoading(null)
    }
  }

  const handleReject = async (userId: number) => {
    if (!token) return
    if (!confirm('Are you sure you want to reject this user?')) return
    setActionLoading(userId)
    try {
      const response = await fetch(`/api/admin/users/${userId}`, {
        method: 'DELETE',
        headers: { 'Authorization': `Bearer ${token}` }
      })
      if (response.ok) {
        addToast('User rejected and removed', 'success')
        fetchUsers()
      } else {
        addToast('Failed to reject user', 'error')
      }
    } catch {
      addToast('Failed to reject user', 'error')
    } finally {
      setActionLoading(null)
    }
  }

  const handleDelete = async (userId: number) => {
    if (!token) return
    if (!confirm('Are you sure you want to delete this user?')) return
    setActionLoading(userId)
    try {
      const response = await fetch(`/api/admin/users/${userId}`, {
        method: 'DELETE',
        headers: { 'Authorization': `Bearer ${token}` }
      })
      if (response.ok) {
        addToast('User deleted successfully', 'success')
        fetchUsers()
      } else {
        addToast('Failed to delete user', 'error')
      }
    } catch {
      addToast('Failed to delete user', 'error')
    } finally {
      setActionLoading(null)
    }
  }

  const filtered = filter === 'all' ? users : users.filter(u => filter === 'pending' ? !u.approved : u.approved)
  const pendingCount = users.filter(u => !u.approved && u.role !== 'admin').length

  return (
    <div>
      <PageHeader
        title="User Management"
        desc="Manage user registrations and approvals"
      />
      <PageContent>
        <Section title="Users" sub="View and manage all registered users">
          <div className="flex items-center gap-3 mb-4">
            <div className="flex gap-2">
              <button
                onClick={() => setFilter('all')}
                className={`px-3 py-1.5 text-sm rounded-lg transition-colors ${
                  filter === 'all'
                    ? 'bg-primary text-primary-foreground'
                    : 'bg-secondary text-muted-foreground hover:text-foreground'
                }`}
              >
                All ({users.length})
              </button>
              <button
                onClick={() => setFilter('pending')}
                className={`px-3 py-1.5 text-sm rounded-lg transition-colors ${
                  filter === 'pending'
                    ? 'bg-yellow-500/20 text-yellow-500'
                    : 'bg-secondary text-muted-foreground hover:text-foreground'
                }`}
              >
                <Clock className="h-3.5 w-3.5 inline mr-1" />
                Pending ({pendingCount})
              </button>
              <button
                onClick={() => setFilter('approved')}
                className={`px-3 py-1.5 text-sm rounded-lg transition-colors ${
                  filter === 'approved'
                    ? 'bg-green-500/20 text-green-500'
                    : 'bg-secondary text-muted-foreground hover:text-foreground'
                }`}
              >
                <CheckCircle className="h-3.5 w-3.5 inline mr-1" />
                Approved
              </button>
            </div>
            <Button variant="outline" size="sm" onClick={fetchUsers} disabled={isLoading}>
              <RefreshCw className={`h-4 w-4 ${isLoading ? 'animate-spin' : ''}`} />
            </Button>
          </div>

          {isLoading ? (
            <div className="text-center py-8 text-muted-foreground">Loading users...</div>
          ) : filtered.length === 0 ? (
            <div className="text-center py-8 text-muted-foreground">No users found</div>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b border-border">
                    <th className="text-left py-3 px-4 font-medium text-muted-foreground">Name</th>
                    <th className="text-left py-3 px-4 font-medium text-muted-foreground">Email</th>
                    <th className="text-left py-3 px-4 font-medium text-muted-foreground">Role</th>
                    <th className="text-left py-3 px-4 font-medium text-muted-foreground">Status</th>
                    <th className="text-right py-3 px-4 font-medium text-muted-foreground">Actions</th>
                  </tr>
                </thead>
                <tbody>
                  {filtered.map((user) => (
                    <tr key={user.id} className="border-b border-border hover:bg-secondary/50">
                      <td className="py-3 px-4 font-medium">{user.name}</td>
                      <td className="py-3 px-4 text-muted-foreground">{user.email}</td>
                      <td className="py-3 px-4">
                        <span className={`inline-flex items-center px-2 py-0.5 rounded-full text-xs font-medium ${
                          user.role === 'admin'
                            ? 'bg-primary/10 text-primary'
                            : 'bg-secondary text-muted-foreground'
                        }`}>
                          {user.role}
                        </span>
                      </td>
                      <td className="py-3 px-4">
                        <span className={`inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-xs font-medium ${
                          user.approved
                            ? 'bg-green-500/10 text-green-500'
                            : 'bg-yellow-500/10 text-yellow-500'
                        }`}>
                          {user.approved ? (
                            <><CheckCircle className="h-3 w-3" /> Approved</>
                          ) : (
                            <><Clock className="h-3 w-3" /> Pending</>
                          )}
                        </span>
                      </td>
                      <td className="py-3 px-4 text-right">
                        {user.role !== 'admin' && (
                          <div className="flex items-center justify-end gap-2">
                            {!user.approved && (
                              <Button
                                variant="outline"
                                size="sm"
                                onClick={() => handleApprove(user.id)}
                                disabled={actionLoading === user.id}
                                className="text-green-500 hover:text-green-600 hover:bg-green-500/10"
                              >
                                <CheckCircle className="h-4 w-4" />
                              </Button>
                            )}
                            {user.approved && (
                              <Button
                                variant="outline"
                                size="sm"
                                onClick={() => handleReject(user.id)}
                                disabled={actionLoading === user.id}
                                className="text-yellow-500 hover:text-yellow-600 hover:bg-yellow-500/10"
                              >
                                <XCircle className="h-4 w-4" />
                              </Button>
                            )}
                            <Button
                              variant="outline"
                              size="sm"
                              onClick={() => handleDelete(user.id)}
                              disabled={actionLoading === user.id}
                              className="text-destructive hover:text-destructive hover:bg-destructive/10"
                            >
                              <Trash2 className="h-4 w-4" />
                            </Button>
                          </div>
                        )}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </Section>
      </PageContent>
    </div>
  )
}
