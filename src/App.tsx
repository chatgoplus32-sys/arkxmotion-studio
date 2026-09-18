import { Suspense, useEffect, useRef } from 'react'
import { BrowserRouter as Router, Routes, Route } from 'react-router-dom'
import { Sidebar, Header } from '@/components/layout'
import { useAppStore, useAuthStore } from '@/stores'
import { cn } from '@/lib/utils'
import ProtectedRoute from '@/components/auth/ProtectedRoute'
import { ToastContainer } from '@/components/ui/Toast'
import { ErrorBoundary } from '@/components/ErrorBoundary'
import { lazyWithRetry } from '@/lib/lazyWithRetry'
import { initChunkErrorInterceptor } from '@/lib/chunkInterceptor'
import { useProviderManager } from '@/stores/providerManager'
import { useToastStore } from '@/stores/toastStore'
import { isRiversideJwtNearExpiry, refreshRiversideJwt } from '@/lib/riverside'
import { pollAutoSyncQueues } from '@/lib/tokenAutoSync'
import { startNexabotSessionMonitor } from '@/lib/nexabotSessionMonitor'

import LandingPage from '@/pages/LandingPage'
import LoginPage from '@/pages/Login'
import RegisterPage from '@/pages/Register'
import RegisterStatusPage from '@/pages/RegisterStatus'
import ForgotPasswordPage from '@/pages/ForgotPassword'
import ResetPasswordPage from '@/pages/ResetPassword'

const DashboardPage = lazyWithRetry(() => import('@/pages/Dashboard'))
const CommandPage = lazyWithRetry(() => import('@/pages/Command'))
const MotionPage = lazyWithRetry(() => import('@/pages/Motion'))
const BulkFashionPage = lazyWithRetry(() => import('@/pages/BulkFashion'))
const ImageToVideoPage = lazyWithRetry(() => import('@/pages/ImageToVideo'))
const UpscalerPage = lazyWithRetry(() => import('@/pages/Upscaler'))
const UGCPage = lazyWithRetry(() => import('@/pages/UGC'))
const TextToVideoPage = lazyWithRetry(() => import('@/pages/TextToVideo'))
const EditImagePage = lazyWithRetry(() => import('@/pages/EditImage'))
const ProvidersPage = lazyWithRetry(() => import('@/pages/Providers'))
const RoutingProviderPage = lazyWithRetry(() => import('@/pages/RoutingProvider'))
const SettingsPage = lazyWithRetry(() => import('@/pages/Settings'))
const AdminUsersPage = lazyWithRetry(() => import('@/pages/AdminUsers'))
const AdminMembershipPage = lazyWithRetry(() => import('@/pages/AdminMembership'))
const AdminTokensPage = lazyWithRetry(() => import('@/pages/AdminTokens'))
const AdminOrderTokensPage = lazyWithRetry(() => import('@/pages/AdminOrderTokens'))
const AdminProviderStatusPage = lazyWithRetry(() => import('@/pages/AdminProviderStatus'))
const AdminTopupPage = lazyWithRetry(() => import('@/pages/AdminTopup'))
const AdminAnalyticsPage = lazyWithRetry(() => import('@/pages/AdminAnalytics'))
const AdminActivityPage = lazyWithRetry(() => import('@/pages/AdminActivity'))
const AdminCreditManagementPage = lazyWithRetry(() => import('@/pages/AdminCreditManagement'))
const AdminSystemSettingsPage = lazyWithRetry(() => import('@/pages/AdminSystemSettings'))
const AdminSystemHealthPage = lazyWithRetry(() => import('@/pages/AdminSystemHealth'))
const SecondBrainPage = lazyWithRetry(() => import('@/pages/SecondBrain'))
const ClipGeniusPage = lazyWithRetry(() => import('@/pages/ClipGenius'))
const AdminNotificationsPage = lazyWithRetry(() => import('@/pages/AdminNotifications'))
const CreatePulseTopupPage = lazyWithRetry(() => import('@/pages/CreatePulseTopup'))
const NexaBotTopupPage = lazyWithRetry(() => import('@/pages/NexaBotTopup'))
const BeliTokenPage = lazyWithRetry(() => import('@/pages/BeliToken'))
const PluginsPage = lazyWithRetry(() => import('@/pages/Plugins'))
const VirtualTryOnPage = lazyWithRetry(() => import('@/pages/VirtualTryOn'))
const TalkingPhotoPage = lazyWithRetry(() => import('@/pages/TalkingPhoto'))
const VideoUpscalerPage = lazyWithRetry(() => import('@/pages/VideoUpscaler'))

function PageLoader() {
  return <div className="flex items-center justify-center py-20"><div className="h-8 w-8 rounded-full border-2 border-primary/30 border-t-primary animate-spin" /></div>
}

// Initialize chunk error interceptor immediately
initChunkErrorInterceptor()

export default function App() {
  const { sidebarCollapsed, toggleSidebar } = useAppStore()
  const addToast = useToastStore((s) => s.addToast)
  const startX = useRef(0)

  // Riverside: auto-refresh JWT session yang mendekati expired (hanya untuk
  // key bertipe refresh-token / AMf-; JWT session murni di-refresh oleh
  // extension keep-alive lewat auto-sync di bawah, jadi di sini dilewati).
  useEffect(() => {
    const refreshExpiring = async () => {
      const pm = useProviderManager.getState()
      const keys = pm.keys.riverside || []
      for (const k of keys) {
        if (k.status === 'invalid' || k.status === 'expired') continue
        if (!isRiversideJwtNearExpiry(k.key)) continue
        // Tanpa refresh token tersimpan, serahkan ke auto-sync extension
        // (token baru masuk antrian tiap ±4 menit) — jangan warn spam.
        if (!k.refreshToken) continue
        const result = await refreshRiversideJwt(k.key, k.refreshToken)
        if (result.ok && result.token) {
          pm.replaceKey('riverside', k.id, result.token, k.refreshToken)
          addToast('🔄 Token Riverside auto-refresh berhasil', 'success')
        } else {
          pm.updateKeyStatus('riverside', k.id, 'expired')
          addToast(`Token Riverside expired — grab ulang: ${result.error || ''}`, 'warning')
        }
      }
    }
    // Jalankan sekali saat app load, lalu tiap 30 detik (lebih cepat dari 60)
    refreshExpiring()
    const timer = setInterval(refreshExpiring, 30000)
    return () => clearInterval(timer)
  }, [addToast])

  // Auto-sync extension→app untuk provider token pendek (Riverside, Roboneo,
  // Weavy, Leonardo). Extension mengirim token terbaru ke /api/sync-tokens —
  // app polling tiap 10 detik: token baru otomatis mengganti key yang expired,
  // LALU LANGSUNG menjalankan Cek Limit & Status untuk key tsb (balance &
  // pool summary segar), plus toast + badge sidebar + riwayat pergantian.
  useEffect(() => {
    let cancelled = false
    const run = async () => {
      if (cancelled) return
      await pollAutoSyncQueues()
    }
    run()
    const timer = setInterval(run, 10000)
    return () => { cancelled = true; clearInterval(timer) }
  }, [])

  // Sesi app: access token cuma hidup 15 menit, dan poller auto-sync di atas
  // memakai token yang sama tiap 10 detik. Tanpa perpanjangan di latar
  // belakang, sesi yang masih bisa di-refresh mati di tengah jalan dan semua
  // permintaan sesudahnya jadi 401/403 (dulu 403 untuk 7 provider sekaligus).
  // Diperiksa tiap menit dan setiap kali tab kembali aktif — kasus paling
  // sering: tab lama dibuka lagi setelah lebih dari 15 menit.
  useEffect(() => {
    const tick = () => { void useAuthStore.getState().refreshIfExpiring() }
    tick()
    const timer = setInterval(tick, 60000)
    const onActive = () => { if (!document.hidden) tick() }
    document.addEventListener('visibilitychange', onActive)
    window.addEventListener('focus', onActive)
    return () => {
      clearInterval(timer)
      document.removeEventListener('visibilitychange', onActive)
      window.removeEventListener('focus', onActive)
    }
  }, [])

  // NexaBot: pantau sesi cookie (paket Unlimited) di latar belakang supaya user
  // diberi tahu SEBELUM generate kalau sesi sudah/mendekati kedaluwarsa — job
  // NexaBot bisa berjalan menit-an, dan sesi yang mati di tengah job memaksa
  // fallback ke API key pay-as-you-go (0.25 cr). Probe tiap 5 menit + langsung
  // saat cookie baru masuk dari extension (`aatools:keys-changed`).
  useEffect(() => {
    const stop = startNexabotSessionMonitor()
    return stop
  }, [])
  useEffect(() => {
    const onStart = (e: TouchEvent) => { startX.current = e.touches[0].clientX }
    const onMove = (e: TouchEvent) => {
      const dx = e.touches[0].clientX - startX.current
      if (startX.current < 28 && dx > 72 && sidebarCollapsed) toggleSidebar()
      if (!sidebarCollapsed && dx < -72 && startX.current < 300) toggleSidebar()
    }
    const onKey = (e: KeyboardEvent) => { if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'b') { e.preventDefault(); toggleSidebar() } }
    window.addEventListener('touchstart', onStart as any, { passive: true })
    window.addEventListener('touchmove', onMove as any, { passive: true })
    window.addEventListener('keydown', onKey)
    return () => { window.removeEventListener('touchstart', onStart as any); window.removeEventListener('touchmove', onMove as any); window.removeEventListener('keydown', onKey) }
  }, [sidebarCollapsed, toggleSidebar])

  return (
    <ErrorBoundary>
      <Router>
        <ToastContainer />
        <Routes>
        <Route path="/" element={<LandingPage />} />
        <Route path="/login" element={<LoginPage />} />
        <Route path="/register" element={<RegisterPage />} />
        <Route path="/register-status" element={<RegisterStatusPage />} />
        <Route path="/forgot-password" element={<ForgotPasswordPage />} />
        <Route path="/reset-password" element={<ResetPasswordPage />} />
        <Route
          path="/*"
          element={
            <ProtectedRoute>
              <div className="flex min-h-screen bg-background">
                {!sidebarCollapsed && (
                  <div
                    className="fixed inset-0 z-40 bg-black/50 lg:hidden"
                    onClick={toggleSidebar}
                  />
                )}
                <div className={cn(
                  'fixed lg:sticky top-0 z-50 h-screen transition-transform duration-300 lg:translate-x-0',
                  sidebarCollapsed ? '-translate-x-full' : 'translate-x-0'
                )}>
                  <Sidebar collapsed={false} />
                </div>
                <div className="flex-1 flex flex-col min-w-0">
                  <Header
                    collapsed={sidebarCollapsed}
                    onToggleSidebar={toggleSidebar}
                  />
                  <main className="flex-1 p-4 lg:p-6 overflow-auto">
                    <Suspense fallback={<PageLoader />}>
                      <Routes>
                        <Route path="/dashboard" element={<DashboardPage />} />
                        <Route path="/command" element={<CommandPage />} />
                        <Route path="/generate/motion" element={<MotionPage />} />
                        <Route path="/generate/bulk-fashion" element={<BulkFashionPage />} />
                        <Route path="/generate/virtual-tryon" element={<VirtualTryOnPage />} />
                        <Route path="/generate/talking-photo" element={<TalkingPhotoPage />} />
                        <Route path="/generate/video-upscaler" element={<VideoUpscalerPage />} />
                        <Route path="/generate/ugc" element={<UGCPage />} />
                        <Route path="/generate/upscaler" element={<UpscalerPage />} />
                        <Route path="/generate/image-to-video" element={<ImageToVideoPage />} />
                        <Route path="/generate/image" element={<TextToVideoPage />} />
                        <Route path="/generate/edit-image" element={<EditImagePage />} />
                        <Route path="/providers" element={<ProvidersPage />} />
                        <Route path="/manage/routing" element={<RoutingProviderPage />} />
                        <Route path="/settings" element={<SettingsPage />} />
                        <Route path="/topup/createpulse" element={<CreatePulseTopupPage />} />
                        <Route path="/topup/nexabot" element={<NexaBotTopupPage />} />
                        <Route path="/beli-token" element={<BeliTokenPage />} />
                        <Route path="/plugins" element={<PluginsPage />} />

                        <Route path="/tools/second-brain" element={<SecondBrainPage />} />
                        <Route path="/tools/clip-genius" element={<ClipGeniusPage />} />
                        <Route path="/admin/users" element={<AdminUsersPage />} />
                        <Route path="/admin/membership" element={<AdminMembershipPage />} />
                        <Route path="/admin/tokens" element={<AdminTokensPage />} />
                        <Route path="/admin/orders" element={<AdminOrderTokensPage />} />
                        <Route path="/admin/status" element={<AdminProviderStatusPage />} />
                        <Route path="/admin/topup" element={<AdminTopupPage />} />
                        <Route path="/admin/analytics" element={<AdminAnalyticsPage />} />
                        <Route path="/admin/activity" element={<AdminActivityPage />} />
                        <Route path="/admin/credits" element={<AdminCreditManagementPage />} />
                        <Route path="/admin/settings" element={<AdminSystemSettingsPage />} />
                        <Route path="/admin/health" element={<AdminSystemHealthPage />} />
                        <Route path="/admin/notifications" element={<AdminNotificationsPage />} />
                      </Routes>
                    </Suspense>
                  </main>
                </div>
              </div>
            </ProtectedRoute>
          }
        />
      </Routes>
      </Router>
    </ErrorBoundary>
  )
}
