import { BrowserRouter as Router, Routes, Route } from 'react-router-dom'
import { Sidebar, Header } from '@/components/layout'
import { useAppStore } from '@/stores'
import { cn } from '@/lib/utils'
import ProtectedRoute from '@/components/auth/ProtectedRoute'
import { ToastContainer } from '@/components/ui/Toast'

// Lazy load pages
import DashboardPage from '@/pages/Dashboard'
import CommandPage from '@/pages/Command'
import MotionPage from '@/pages/Motion'
import BulkFashionPage from '@/pages/BulkFashion'
import ImageToVideoPage from '@/pages/ImageToVideo'
import UpscalerPage from '@/pages/Upscaler'

import DubbingPage from '@/pages/Dubbing'

import ProvidersPage from '@/pages/Providers'
import RoutingProviderPage from '@/pages/RoutingProvider'
import SettingsPage from '@/pages/Settings'
import AdminUsersPage from '@/pages/AdminUsers'
import AdminTokensPage from '@/pages/AdminTokens'
import AdminOrderTokensPage from '@/pages/AdminOrderTokens'
import AdminProviderStatusPage from '@/pages/AdminProviderStatus'
import AdminTopupPage from '@/pages/AdminTopup'
import CreatePulseTopupPage from '@/pages/CreatePulseTopup'
import BeliTokenPage from '@/pages/BeliToken'
import LoginPage from '@/pages/Login'
import RegisterPage from '@/pages/Register'

export default function App() {
  const { sidebarCollapsed, toggleSidebar } = useAppStore()

  return (
    <Router>
      <ToastContainer />
      <Routes>
        <Route path="/login" element={<LoginPage />} />
        <Route path="/register" element={<RegisterPage />} />
        <Route
          path="/*"
          element={
            <ProtectedRoute>
              <div className="flex min-h-screen bg-background">
                {/* Mobile overlay when sidebar open */}
                {!sidebarCollapsed && (
                  <div
                    className="fixed inset-0 z-40 bg-black/50 lg:hidden"
                    onClick={toggleSidebar}
                  />
                )}
                {/* Sidebar — hidden on mobile unless toggled */}
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
                    <Routes>
                      <Route path="/" element={<DashboardPage />} />
                      <Route path="/command" element={<CommandPage />} />
                      <Route path="/generate/motion" element={<MotionPage />} />
                      <Route path="/generate/bulk-fashion" element={<BulkFashionPage />} />
                      <Route path="/generate/upscaler" element={<UpscalerPage />} />
                      <Route path="/generate/image-to-video" element={<ImageToVideoPage />} />

                      <Route path="/mixing/dubbing" element={<DubbingPage />} />

                      <Route path="/providers" element={<ProvidersPage />} />
                      <Route path="/manage/routing" element={<RoutingProviderPage />} />
                      <Route path="/settings" element={<SettingsPage />} />
                      <Route path="/topup/createpulse" element={<CreatePulseTopupPage />} />
                      <Route path="/beli-token" element={<BeliTokenPage />} />
                      <Route path="/admin/users" element={<AdminUsersPage />} />
                      <Route path="/admin/tokens" element={<AdminTokensPage />} />
                      <Route path="/admin/orders" element={<AdminOrderTokensPage />} />
                      <Route path="/admin/status" element={<AdminProviderStatusPage />} />
                      <Route path="/admin/topup" element={<AdminTopupPage />} />
                    </Routes>
                  </main>
                </div>
              </div>
            </ProtectedRoute>
          }
        />
      </Routes>
    </Router>
  )
}
