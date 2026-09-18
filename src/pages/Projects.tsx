import { useState } from 'react'
import { PageHeader, PageContent } from '@/components/layout'
import { Section, Button, EmptyState, Input } from '@/components/ui'
import { FolderKanban, Plus, Pin, Trash2 } from 'lucide-react'
import { t } from '@/lib/i18n'

interface Project {
  id: string
  name: string
  pinned: boolean
  createdAt: string
}

const STORAGE_KEY = 'arkxmotion.projects'

function loadProjects(): Project[] {
  try {
    const raw = localStorage.getItem(STORAGE_KEY)
    if (!raw) return []
    const parsed = JSON.parse(raw)
    return Array.isArray(parsed) ? parsed : []
  } catch {
    return []
  }
}

export default function ProjectsPage() {
  const [projects, setProjects] = useState<Project[]>(loadProjects)
  const [name, setName] = useState('')

  const persist = (next: Project[]) => {
    setProjects(next)
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(next))
    } catch (e) {
      console.warn('[projects] failed to save:', e)
    }
  }

  const createProject = () => {
    const trimmed = name.trim()
    if (!trimmed) return
    persist([
      { id: `${Date.now()}-${Math.random().toString(36).slice(2, 7)}`, name: trimmed, pinned: false, createdAt: new Date().toISOString() },
      ...projects,
    ])
    setName('')
  }

  const togglePin = (id: string) => {
    persist(projects.map((p) => (p.id === id ? { ...p, pinned: !p.pinned } : p)))
  }

  const removeProject = (id: string) => {
    persist(projects.filter((p) => p.id !== id))
  }

  const pinned = projects.filter((p) => p.pinned)

  return (
    <PageContent>
      <PageHeader
        eyebrow="Workspace"
        title="Project"
        highlight="Manager"
        desc="Kelola project kreatif dengan papan kanban."
      />

      <div className="grid grid-cols-1 lg:grid-cols-4 gap-4">
        <Section title="📌 Pinned" className="lg:col-span-1">
          {pinned.length === 0 ? (
            <EmptyState
              icon={<Pin className="h-6 w-6" />}
              title={t.noPinned}
              description={t.pinHint}
            />
          ) : (
            <ul className="space-y-2">
              {pinned.map((p) => (
                <li key={p.id} className="flex items-center justify-between gap-2 p-2 rounded-lg border border-border text-sm">
                  <span className="truncate">{p.name}</span>
                  <button type="button" onClick={() => togglePin(p.id)} aria-label={`Unpin ${p.name}`} aria-pressed="true" className="p-1 rounded hover:bg-accent">
                    <Pin className="h-3.5 w-3.5 fill-current" />
                  </button>
                </li>
              ))}
            </ul>
          )}
        </Section>

        <div className="lg:col-span-3">
          <Section
            title="All Projects"
            right={
              <div className="flex gap-2">
                <Input
                  placeholder="Nama project baru..."
                  aria-label="Nama project baru"
                  value={name}
                  onChange={(e) => setName(e.target.value)}
                  onKeyDown={(e) => e.key === 'Enter' && createProject()}
                  className="h-8 w-44"
                />
                <Button size="sm" onClick={createProject} disabled={!name.trim()} aria-label="Buat project baru">
                  <Plus className="h-3.5 w-3.5" /> New Project
                </Button>
              </div>
            }
          >
            {projects.length === 0 ? (
              <EmptyState
                icon={<FolderKanban className="h-8 w-8" />}
                title={t.noProjects}
                description={t.createFirst}
                action={
                  <Button size="sm" onClick={createProject} disabled={!name.trim()}>
                    <Plus className="h-3.5 w-3.5" /> Buat project
                  </Button>
                }
              />
            ) : (
              <ul className="space-y-2">
                {projects.map((p) => (
                  <li key={p.id} className="flex items-center justify-between gap-2 p-2 rounded-lg border border-border">
                    <div className="min-w-0">
                      <div className="text-sm font-medium truncate">{p.name}</div>
                      <div className="text-xs text-muted-foreground">{new Date(p.createdAt).toLocaleDateString('id-ID')}</div>
                    </div>
                    <div className="flex items-center gap-1 shrink-0">
                      <button
                        type="button"
                        onClick={() => togglePin(p.id)}
                        aria-label={p.pinned ? `Unpin ${p.name}` : `Pin ${p.name}`}
                        aria-pressed={p.pinned}
                        className="p-1.5 rounded hover:bg-accent"
                      >
                        <Pin className={`h-4 w-4 ${p.pinned ? 'fill-current' : ''}`} />
                      </button>
                      <button
                        type="button"
                        onClick={() => removeProject(p.id)}
                        aria-label={`Hapus ${p.name}`}
                        className="p-1.5 rounded hover:bg-accent hover:text-destructive"
                      >
                        <Trash2 className="h-4 w-4" />
                      </button>
                    </div>
                  </li>
                ))}
              </ul>
            )}
          </Section>
        </div>
      </div>
    </PageContent>
  )
}
