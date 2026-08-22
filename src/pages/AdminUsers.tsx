import { useState, useEffect, useCallback } from 'react'
import { PageHeader, PageContent } from '@/components/layout'
import { Section, Button } from '@/components/ui'
import { useAuthStore } from '@/stores/authStore'
import { useToastStore } from '@/stores/toastStore'
import { CheckCircle, XCircle, Clock, Trash2, RefreshCw, Key, Mail, BadgeCheck, Ban, Download, CheckSquare } from 'lucide-react'

interface User {
  id: number
  email: string
  name: string
  role: string
  approved: boolean
  email_verified: boolean
  created_at: string
  payment?: {
    id: number
    amount: number
    status: string
    proofNote: string
    adminNote: string
  } | null
}

export default function AdminUsersPage() {
  const [users, setUsers] = useState<User[]>([])
  const [filter, setFilter] = useState<'all' | 'pending' | 'approved'>('all')
  const [isLoading, setIsLoading] = useState(true)
  const [actionLoading, setActionLoading] = useState<number | null>(null)
  const [selectedIds, setSelectedIds] = useState<Set<number>>(new Set())
  const [bulkLoading, setBulkLoading] = useState(false)
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

  const handleApprovePayment = async (paymentId: number, userEmail: string) => {
    if (!token) return
    if (!confirm(`Setujui pembayaran ${userEmail}? Akun member akan langsung diaktifkan.`)) return
    setActionLoading(paymentId)
    try {
      const response = await fetch(`/api/admin/membership/payments/${paymentId}/approve`, {
        method: 'POST',
        headers: { 'Authorization': `Bearer ${token}` }
      })
      const data = await response.json().catch(() => ({}))
      if (response.ok) {
        addToast(data.message || 'Pembayaran disetujui', 'success')
        fetchUsers()
      } else {
        addToast(data.error || 'Gagal menyetujui pembayaran', 'error')
      }
    } catch {
      addToast('Gagal menyetujui pembayaran', 'error')
    } finally {
      setActionLoading(null)
    }
  }

  const handleRejectPayment = async (paymentId: number, userEmail: string) => {
    if (!token) return
    const note = prompt(`Tolak pembayaran ${userEmail}? Alasan (opsional):`)
    if (note === null) return
    setActionLoading(paymentId)
    try {
      const response = await fetch(`/api/admin/membership/payments/${paymentId}/reject`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${token}` },
        body: JSON.stringify({ admin_note: note || '' })
      })
      const data = await response.json().catch(() => ({}))
      if (response.ok) {
        addToast(data.message || 'Pembayaran ditolak', 'success')
        fetchUsers()
      } else {
        addToast(data.error || 'Gagal menolak pembayaran', 'error')
      }
    } catch {
      addToast('Gagal menolak pembayaran', 'error')
    } finally {
      setActionLoading(null)
    }
  }

  const handleResendVerification = async (userId: number, userEmail: string) => {
    if (!token) return
    setActionLoading(userId)
    try {
      const response = await fetch(`/api/admin/users/${userId}/resend-verification`, {
        method: 'POST',
        headers: { 'Authorization': `Bearer ${token}` }
      })
      const data = await response.json().catch(() => ({}))
      if (response.ok) {
        addToast(`Link verifikasi dikirim ke ${userEmail}`, 'success')
        if (data.devVerifyLink) {
          try {
            await navigator.clipboard.writeText(data.devVerifyLink)
            addToast('Mode dev — link verifikasi disalin ke clipboard', 'warning')
          } catch {
            addToast(`Mode dev — link: ${data.devVerifyLink}`, 'warning')
          }
        }
      } else {
        addToast(data.error || 'Gagal kirim link verifikasi', 'error')
      }
    } catch {
      addToast('Gagal kirim link verifikasi', 'error')
    } finally {
      setActionLoading(null)
    }
  }

  const handleResetPassword = async (userId: number, userName: string) => {
    if (!token) return
    const newPassword = prompt(`Reset password untuk ${userName}.\nMasukkan password baru (min 4 karakter):`)
    if (!newPassword || newPassword.length < 4) {
      if (newPassword !== null) addToast('Password minimal 4 karakter', 'error')
      return
    }
    setActionLoading(userId)
    try {
      const response = await fetch(`/api/admin?id=${userId}&action=reset-password`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${token}` },
        body: JSON.stringify({ new_password: newPassword })
      })
      if (response.ok) {
        addToast('Password berhasil direset', 'success')
      } else {
        const data = await response.json()
        addToast(data.error || 'Gagal reset password', 'error')
      }
    } catch {
      addToast('Gagal reset password', 'error')
    } finally {
      setActionLoading(null)
    }
  }

  const filtered = filter === 'all' ? users : users.filter(u => filter === 'pending' ? !u.approved : u.approved)
  const pendingCount = users.filter(u => !u.approved && u.role !== 'admin').length
  const selectableUsers = filtered.filter(u => u.role !== 'admin')
  const allSelected = selectableUsers.length > 0 && selectableUsers.every(u => selectedIds.has(u.id))

  const toggleSelect = (id: number) => {
    setSelectedIds(prev => {
      const next = new Set(prev)
      if (next.has(id)) next.delete(id)
      else next.add(id)
      return next
    })
  }
  const toggleSelectAll = () => {
    if (allSelected) {
      setSelectedIds(new Set())
    } else {
      setSelectedIds(new Set(selectableUsers.map(u => u.id)))
    }
  }

  const handleBulkAction = async (action: 'approve' | 'delete') => {
    if (selectedIds.size === 0) return
    const label = action === 'approve' ? 'Approve' : 'Delete'
    if (!confirm(`${label} ${selectedIds.size} user(s)?`)) return
    setBulkLoading(true)
    try {
      const res = await fetch('/api/admin/users/bulk', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${token}` },
        body: JSON.stringify({ action, ids: Array.from(selectedIds) }),
      })
      const data = await res.json()
      if (res.ok) {
        addToast(data.message, 'success')
        setSelectedIds(new Set())
        fetchUsers()
      } else {
        addToast(data.error || 'Bulk action failed', 'error')
      }
    } catch {
      addToast('Bulk action failed', 'error')
    } finally {
      setBulkLoading(false)
    }
  }

  const handleExportCSV = () => {
    window.open('/api/admin/export/users', '_blank')
  }

  return (
    <div>
      <PageHeader
        title="User Management"
        desc="Manage user registrations and approvals"
      />
      <PageContent>
        <Section title="Users" sub="View and manage all registered users">
          {selectedIds.size > 0 && (
            <div className="flex items-center gap-2 mb-3 p-2 rounded-lg bg-primary/5 border border-primary/20">
              <span className="text-sm text-primary font-medium">{selectedIds.size} dipilih</span>
              <Button variant="outline" size="sm" onClick={() => handleBulkAction('approve')} disabled={bulkLoading} className="text-green-500 hover:text-green-600 hover:bg-green-500/10">
                <CheckCircle className="h-3.5 w-3.5 mr-1" /> Approve All
              </Button>
              <Button variant="outline" size="sm" onClick={() => handleBulkAction('delete')} disabled={bulkLoading} className="text-destructive hover:bg-destructive/10">
                <Trash2 className="h-3.5 w-3.5 mr-1" /> Delete All
              </Button>
              <Button variant="ghost" size="sm" onClick={() => setSelectedIds(new Set())}>
                Batal
              </Button>
            </div>
          )}
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
            <Button variant="outline" size="sm" onClick={handleExportCSV}>
              <Download className="h-4 w-4 mr-1" /> Export CSV
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
                    <th className="py-3 px-2 w-8">
                      <input
                        type="checkbox"
                        checked={allSelected}
                        onChange={toggleSelectAll}
                        className="rounded border-border cursor-pointer"
                      />
                    </th>
                    <th className="text-left py-3 px-4 font-medium text-muted-foreground">Name</th>
                    <th className="text-left py-3 px-4 font-medium text-muted-foreground">Email</th>
                    <th className="text-left py-3 px-4 font-medium text-muted-foreground">Role</th>
                    <th className="text-left py-3 px-4 font-medium text-muted-foreground">Status</th>
                    <th className="text-left py-3 px-4 font-medium text-muted-foreground">Verified</th>
                    <th className="text-left py-3 px-4 font-medium text-muted-foreground">Payment</th>
                    <th className="text-right py-3 px-4 font-medium text-muted-foreground">Actions</th>
                  </tr>
                </thead>
                <tbody>
                  {filtered.map((user) => (
                    <tr key={user.id} className="border-b border-border hover:bg-secondary/50">
                      <td className="py-3 px-2">
                        {user.role !== 'admin' && (
                          <input
                            type="checkbox"
                            checked={selectedIds.has(user.id)}
                            onChange={() => toggleSelect(user.id)}
                            className="rounded border-border cursor-pointer"
                          />
                        )}
                      </td>
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
                      <td className="py-3 px-4">
                        <span className={`inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-xs font-medium ${
                          user.email_verified
                            ? 'bg-emerald-500/10 text-emerald-500'
                            : 'bg-yellow-500/10 text-yellow-500'
                        }`}>
                          {user.email_verified ? (
                            <><CheckCircle className="h-3 w-3" /> Verified</>
                          ) : (
                            <><Clock className="h-3 w-3" /> Belum</>
                          )}
                        </span>
                      </td>
                      <td className="py-3 px-4">
                        {user.payment ? (
                          <div className="flex flex-col items-start gap-1">
                            <span className="text-xs font-mono">Rp {user.payment.amount.toLocaleString('id-ID')}</span>
                            <span className={`inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[10px] font-medium ${
                              user.payment.status === 'approved'
                                ? 'bg-emerald-500/10 text-emerald-500'
                                : user.payment.status === 'rejected'
                                  ? 'bg-red-500/10 text-red-500'
                                  : 'bg-yellow-500/10 text-yellow-500'
                            }`}>
                              {user.payment.status === 'approved' ? (
                                <><BadgeCheck className="h-3 w-3" /> Diterima</>
                              ) : user.payment.status === 'rejected' ? (
                                <><Ban className="h-3 w-3" /> Ditolak</>
                              ) : (
                                <><Clock className="h-3 w-3" /> Menunggu</>
                              )}
                            </span>
                            {user.payment.status === 'pending' && (
                              <div className="flex items-center gap-1 mt-0.5">
                                <button
                                  onClick={() => handleApprovePayment(user.payment!.id, user.email)}
                                  disabled={actionLoading === user.payment.id}
                                  title="Setujui pembayaran & aktifkan akun"
                                  className="inline-flex items-center gap-1 px-2 py-0.5 rounded-md bg-emerald-500/10 text-emerald-500 hover:bg-emerald-500/20 text-[10px] font-medium transition disabled:opacity-50"
                                >
                                  <BadgeCheck className="h-3 w-3" /> Approve
                                </button>
                                <button
                                  onClick={() => handleRejectPayment(user.payment.id, user.email)}
                                  disabled={actionLoading === user.payment.id}
                                  title="Tolak pembayaran"
                                  className="inline-flex items-center gap-1 px-2 py-0.5 rounded-md bg-red-500/10 text-red-500 hover:bg-red-500/20 text-[10px] font-medium transition disabled:opacity-50"
                                >
                                  <Ban className="h-3 w-3" /> Tolak
                                </button>
                              </div>
                            )}
                          </div>
                        ) : (
                          <span className="text-xs text-muted-foreground">—</span>
                        )}
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
                            {!user.email_verified && (
                              <Button
                                variant="outline"
                                size="sm"
                                onClick={() => handleResendVerification(user.id, user.email)}
                                disabled={actionLoading === user.id}
                                title="Kirim ulang link verifikasi email"
                                className="text-yellow-500 hover:text-yellow-600 hover:bg-yellow-500/10"
                              >
                                <Mail className="h-4 w-4" />
                              </Button>
                            )}
                            <Button
                              variant="outline"
                              size="sm"
                              onClick={() => handleResetPassword(user.id, user.name)}
                              disabled={actionLoading === user.id}
                              className="text-blue-500 hover:text-blue-600 hover:bg-blue-500/10"
                            >
                              <Key className="h-4 w-4" />
                            </Button>
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
