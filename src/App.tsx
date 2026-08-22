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
import UGCPage from '@/pages/UGC'
import TextToVideoPage from '@/pages/TextToVideo'


import ProvidersPage from '@/pages/Providers'
import RoutingProviderPage from '@/pages/RoutingProvider'
import SettingsPage from '@/pages/Settings'
import AdminUsersPage from '@/pages/AdminUsers'
import AdminMembershipPage from '@/pages/AdminMembership'
import AdminTokensPage from '@/pages/AdminTokens'
import AdminOrderTokensPage from '@/pages/AdminOrderTokens'
import AdminProviderStatusPage from '@/pages/AdminProviderStatus'
import AdminTopupPage from '@/pages/AdminTopup'
import AdminAnalyticsPage from '@/pages/AdminAnalytics'
import AdminActivityPage from '@/pages/AdminActivity'
import AdminCreditManagementPage from '@/pages/AdminCreditManagement'
import AdminSystemSettingsPage from '@/pages/AdminSystemSettings'
import CreatePulseTopupPage from '@/pages/CreatePulseTopup'
import BeliTokenPage from '@/pages/BeliToken'
import LoginPage from '@/pages/Login'
import RegisterPage from '@/pages/Register'
import RegisterStatusPage from '@/pages/RegisterStatus'
import ForgotPasswordPage from '@/pages/ForgotPassword'
import ResetPasswordPage from '@/pages/ResetPassword'
import LandingPage from '@/pages/LandingPage'

export default function App() {
  const { sidebarCollapsed, toggleSidebar } = useAppStore()

  return (
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
