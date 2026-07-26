import { BrowserRouter as Router, Routes, Route } from 'react-router-dom'
import { Sidebar, Header } from '@/components/layout'
import { useAppStore } from '@/stores'
import ProtectedRoute from '@/components/auth/ProtectedRoute'
import { ToastContainer } from '@/components/ui/Toast'

// Lazy load pages
import DashboardPage from '@/pages/Dashboard'
import CommandPage from '@/pages/Command'
import MotionPage from '@/pages/Motion'
import NaratifPage from '@/pages/Naratif'
import StoryboardPage from '@/pages/Storyboard'
import BulkFashionPage from '@/pages/BulkFashion'
import ImageToVideoPage from '@/pages/ImageToVideo'
import FramiaPage from '@/pages/Framia'
import ResearchPage from '@/pages/Research'
import ProjectsPage from '@/pages/Projects'
import AssetsPage from '@/pages/Assets'
import ProvidersPage from '@/pages/Providers'
import SettingsPage from '@/pages/Settings'
import AdminUsersPage from '@/pages/AdminUsers'
import AdminTokensPage from '@/pages/AdminTokens'
import AdminOrderTokensPage from '@/pages/AdminOrderTokens'
import AdminProviderStatusPage from '@/pages/AdminProviderStatus'
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
                <Sidebar collapsed={sidebarCollapsed} />
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
                      <Route path="/generate/naratif" element={<NaratifPage />} />
                      <Route path="/generate/storyboard" element={<StoryboardPage />} />
                      <Route path="/generate/bulk-fashion" element={<BulkFashionPage />} />
                      <Route path="/generate/image-to-video" element={<ImageToVideoPage />} />
                      <Route path="/generate/framia" element={<FramiaPage />} />
                      <Route path="/research" element={<ResearchPage />} />
                      <Route path="/projects" element={<ProjectsPage />} />
                      <Route path="/assets" element={<AssetsPage />} />
                      <Route path="/providers" element={<ProvidersPage />} />
                      <Route path="/settings" element={<SettingsPage />} />
                      <Route path="/admin/users" element={<AdminUsersPage />} />
                      <Route path="/admin/tokens" element={<AdminTokensPage />} />
                      <Route path="/admin/orders" element={<AdminOrderTokensPage />} />
                      <Route path="/admin/status" element={<AdminProviderStatusPage />} />
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
