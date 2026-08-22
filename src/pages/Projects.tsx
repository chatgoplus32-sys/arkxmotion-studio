import { PageHeader, PageContent } from '@/components/layout'
import { Section, Button, EmptyState } from '@/components/ui'
import { FolderKanban, Plus, Pin } from 'lucide-react'

export default function ProjectsPage() {
  return (
    <PageContent>
      <PageHeader
        eyebrow="Workspace"
        title="Project"
        highlight="Manager"
        desc="Manage your creative projects with kanban board."
      />

      <div className="grid grid-cols-1 lg:grid-cols-4 gap-4">
        <Section title="📌 Pinned" className="lg:col-span-1">
          <EmptyState
            icon={<Pin className="h-6 w-6" />}
            title="No pinned projects"
            description="Pin your favorite projects for quick access"
          />
        </Section>

        <div className="lg:col-span-3">
          <Section
            title="All Projects"
            right={
              <Button size="sm">
                <Plus className="h-3.5 w-3.5" /> New Project
              </Button>
            }
          >
            <EmptyState
              icon={<FolderKanban className="h-8 w-8" />}
              title="No projects yet"
              description="Create your first project to get started"
            />
          </Section>
        </div>
      </div>
    </PageContent>
  )
}
