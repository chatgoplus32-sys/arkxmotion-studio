import { Suspense, useEffect, useRef } from 'react'
import { BrowserRouter as Router, Routes, Route } from 'react-router-dom'
import { Sidebar, Header } from '@/components/layout'
import { useAppStore } from '@/stores'
import { cn } from '@/lib/utils'
import ProtectedRoute from '@/components/auth/ProtectedRoute'
import { ToastContainer } from '@/components/ui/Toast'
import { ErrorBoundary } from '@/components/ErrorBoundary'
import { lazyWithRetry } from '@/lib/lazyWithRetry'
import { initChunkErrorInterceptor } from '@/lib/chunkInterceptor'

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
const BeliTokenPage = lazyWithRetry(() => import('@/pages/BeliToken'))
const PluginsPage = lazyWithRetry(() => import('@/pages/Plugins'))

function PageLoader() {
  return <div className="flex items-center justify-center py-20"><div className="h-8 w-8 rounded-full border-2 border-primary/30 border-t-primary animate-spin" /></div>
}

// Initialize chunk error interceptor immediately
initChunkErrorInterceptor()

export default function App() {
  const { sidebarCollapsed, toggleSidebar } = useAppStore()
  const startX = useRef(0)
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
                        <Route path="/generate/ugc" element={<UGCPage />} />
                        <Route path="/generate/upscaler" element={<UpscalerPage />} />
                        <Route path="/generate/image-to-video" element={<ImageToVideoPage />} />
                        <Route path="/generate/image" element={<TextToVideoPage />} />
                        <Route path="/providers" element={<ProvidersPage />} />
                        <Route path="/manage/routing" element={<RoutingProviderPage />} />
                        <Route path="/settings" element={<SettingsPage />} />
                        <Route path="/topup/createpulse" element={<CreatePulseTopupPage />} />
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
