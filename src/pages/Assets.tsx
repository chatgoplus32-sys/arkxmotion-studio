import { PageHeader, PageContent } from '@/components/layout'
import { Section, Button, EmptyState, Badge } from '@/components/ui'
import { Database, Image, Video, FileText, Mic, Download, Trash2 } from 'lucide-react'

const CATEGORIES = [
  { id: 'all', label: 'All', icon: <Database className="h-4 w-4" /> },
  { id: 'image', label: 'Images', icon: <Image className="h-4 w-4" /> },
  { id: 'video', label: 'Videos', icon: <Video className="h-4 w-4" /> },
  { id: 'text', label: 'Text', icon: <FileText className="h-4 w-4" /> },
  { id: 'voice', label: 'Voice', icon: <Mic className="h-4 w-4" /> },
]

export default function AssetsPage() {
  return (
    <PageContent>
      <PageHeader
        eyebrow="Storage"
        title="Asset"
        highlight="Hub"
        desc="Organized storage for your generated images, videos, text, and voice."
      />

      <Section title="Assets">
        <div className="flex gap-2 mb-4 overflow-x-auto pb-2">
          {CATEGORIES.map((cat) => (
            <button
              key={cat.id}
              className="flex items-center gap-2 px-3 py-1.5 rounded-full border border-border text-sm hover:bg-accent transition whitespace-nowrap"
            >
              {cat.icon}
              {cat.label}
            </button>
          ))}
        </div>

        <EmptyState
          icon={<Database className="h-8 w-8" />}
          title="Belum ada asset tersimpan"
          description="Asset yang di-generate akan muncul di sini"
        />
      </Section>
    </PageContent>
  )
}
