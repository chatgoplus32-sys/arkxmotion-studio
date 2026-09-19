import { useNavigate } from 'react-router-dom'
import { useAuthStore } from '@/stores/authStore'
import { Shirt, Video, MessageSquare, Wand2, ArrowRight, Sparkles, Zap, Clapperboard, Globe } from 'lucide-react'

interface QuickAction {
  id: string
  title: string
  subtitle: string
  icon: React.ReactNode
  color: string
  gradient: string
  href: string
  popular?: boolean
}

const quickActions: QuickAction[] = [
  {
    id: 'motion-control',
    title: 'Motion Control',
    subtitle: 'Transfer gerakan dari video ke foto kamu',
    icon: <Clapperboard className="h-8 w-8" />,
    color: 'from-red-500 to-rose-500',
    gradient: 'bg-gradient-to-br from-red-500/20 to-rose-500/20 border-red-500/30',
    href: '/generate/motion',
    popular: true,
  },
  {
    id: 'virtual-tryon',
    title: 'Ganti Pakaian',
    subtitle: 'Upload foto model + foto baju → hasil realistis',
    icon: <Shirt className="h-8 w-8" />,
    color: 'from-purple-500 to-pink-500',
    gradient: 'bg-gradient-to-br from-purple-500/20 to-pink-500/20 border-purple-500/30',
    href: '/generate/virtual-tryon',
    popular: true,
  },
  {
    id: 'image-to-video',
    title: 'Foto jadi Video',
    subtitle: 'Ubah foto statis jadi video bergerak',
    icon: <Video className="h-8 w-8" />,
    color: 'from-blue-500 to-cyan-500',
    gradient: 'bg-gradient-to-br from-blue-500/20 to-cyan-500/20 border-blue-500/30',
    href: '/generate/image-to-video',
  },
  {
    id: 'talking-photo',
    title: 'Foto Bicara',
    subtitle: 'Buat foto berbicara dengan suara AI',
    icon: <MessageSquare className="h-8 w-8" />,
    color: 'from-green-500 to-emerald-500',
    gradient: 'bg-gradient-to-br from-green-500/20 to-emerald-500/20 border-green-500/30',
    href: '/generate/talking-photo',
  },
  {
    id: 'travel-photo',
    title: '🌍 Travel Photo',
    subtitle: '1 foto karakter → berbagai destinasi realistis',
    icon: <Globe className="h-8 w-8" />,
    color: 'from-teal-500 to-cyan-500',
    gradient: 'bg-gradient-to-br from-teal-500/20 to-cyan-500/20 border-teal-500/30',
    href: '/generate/travel-photo',
  },
  {
    id: 'dola-chat',
    title: '💬 Dola Chat',
    subtitle: 'Chat dengan AI Dola — cerdas & kreatif',
    icon: <MessageSquare className="h-8 w-8" />,
    color: 'from-violet-500 to-purple-500',
    gradient: 'bg-gradient-to-br from-violet-500/20 to-purple-500/20 border-violet-500/30',
    href: '/generate/dola-chat',
  },
  {
    id: 'upscaler',
    title: 'Tingkatkan Kualitas',
    subtitle: 'Upscale gambar jadi lebih tajam & detail',
    icon: <Wand2 className="h-8 w-8" />,
    color: 'from-orange-500 to-yellow-500',
    gradient: 'bg-gradient-to-br from-orange-500/20 to-yellow-500/20 border-orange-500/30',
    href: '/generate/upscaler',
  },
]

export default function QuickStartPage() {
  const navigate = useNavigate()
  const { user } = useAuthStore()

  return (
    <div className="min-h-[calc(100vh-80px)] flex flex-col items-center justify-center px-4 py-12">
      {/* Welcome Header */}
      <div className="text-center mb-12 max-w-xl">
        <div className="inline-flex items-center gap-2 px-4 py-2 rounded-full bg-primary/10 text-primary text-sm font-medium mb-6">
          <Sparkles className="h-4 w-4" />
          <span>ARKX Motion Studio</span>
        </div>
        <h1 className="text-4xl md:text-5xl font-bold text-foreground mb-4">
          Halo, {user?.name?.split(' ')[0] || 'Kamu'}! 👋
        </h1>
        <p className="text-lg text-muted-foreground">
          Mau bikin apa hari ini? Pilih salah satu untuk mulai.
        </p>
      </div>

      {/* Quick Action Cards */}
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4 max-w-4xl w-full mb-8">
        {quickActions.map((action) => (
          <button
            key={action.id}
            onClick={() => navigate(action.href)}
            className={`relative group text-left p-6 rounded-2xl border transition-all duration-300 hover:scale-[1.02] hover:shadow-xl ${action.gradient}`}
          >
            {action.popular && (
              <div className="absolute -top-2 -right-2 px-2 py-0.5 bg-primary text-white text-[10px] font-bold rounded-full flex items-center gap-1">
                <Zap className="h-2.5 w-2.5" />
                POPULER
              </div>
            )}
            <div className={`inline-flex p-3 rounded-xl bg-gradient-to-br ${action.color} text-white mb-4`}>
              {action.icon}
            </div>
            <h3 className="text-lg font-semibold text-foreground mb-1">{action.title}</h3>
            <p className="text-sm text-muted-foreground mb-4">{action.subtitle}</p>
            <div className="flex items-center gap-2 text-sm font-medium text-primary group-hover:gap-3 transition-all">
              Mulai <ArrowRight className="h-4 w-4" />
            </div>
          </button>
        ))}
      </div>

      {/* Footer hint */}
      <div className="text-center">
        <p className="text-sm text-muted-foreground mb-4">
          Butuh bantuan? Lihat{' '}
          <button
            onClick={() => navigate('/settings')}
            className="text-primary hover:underline"
          >
            Pengaturan
          </button>
        </p>
        <div className="flex items-center justify-center gap-6 text-xs text-muted-foreground">
          <span className="flex items-center gap-1.5">
            <span className="w-2 h-2 rounded-full bg-emerald-400" />
            Semua sistem aktif
          </span>
          <span>•</span>
          <span>Version 2.0</span>
        </div>
      </div>
    </div>
  )
}
