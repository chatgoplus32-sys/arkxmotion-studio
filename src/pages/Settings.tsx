import { PageHeader, PageContent } from '@/components/layout'
import { Section, Button, Input, Label, Select } from '@/components/ui'
import { Settings, Moon, Sun, Monitor, Globe, Bell, Shield } from 'lucide-react'
import { useState } from 'react'

export default function SettingsPage() {
  const [theme, setTheme] = useState('system')
  const [language, setLanguage] = useState('id')
  const [notifications, setNotifications] = useState(true)

  return (
    <PageContent>
      <PageHeader
        eyebrow="Configuration"
        title="Settings"
        highlight=""
        desc="Configure your ARKXMotion Studio preferences."
      />

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-5">
        <Section title="🎨 Appearance">
          <div className="space-y-4">
            <div>
              <Label>Theme</Label>
              <Select
                value={theme}
                onChange={(e) => setTheme(e.target.value)}
                options={[
                  { value: 'light', label: 'Light' },
                  { value: 'dark', label: 'Dark' },
                  { value: 'system', label: 'System' },
                ]}
              />
            </div>
            <div>
              <Label>Language</Label>
              <Select
                value={language}
                onChange={(e) => setLanguage(e.target.value)}
                options={[
                  { value: 'id', label: 'Bahasa Indonesia' },
                  { value: 'en', label: 'English' },
                ]}
              />
            </div>
          </div>
        </Section>

        <Section title="🔔 Notifications">
          <div className="space-y-4">
            <label className="flex items-center justify-between cursor-pointer">
              <div>
                <div className="text-sm font-medium">Push Notifications</div>
                <div className="text-xs text-muted-foreground">Get notified when generations complete</div>
              </div>
              <input
                type="checkbox"
                checked={notifications}
                onChange={(e) => setNotifications(e.target.checked)}
                className="h-4 w-4"
              />
            </label>
          </div>
        </Section>

        <Section title="🔐 Security">
          <div className="space-y-4">
            <div>
              <Label>API Keys Storage</Label>
              <p className="text-xs text-muted-foreground mt-1">
                Keys are stored locally in your browser. Never shared with third parties.
              </p>
            </div>
            <Button variant="outline" className="w-full">
              <Shield className="h-4 w-4" /> Export All Keys
            </Button>
          </div>
        </Section>

        <Section title="ℹ️ About">
          <div className="space-y-2 text-sm">
            <div className="flex justify-between">
              <span className="text-muted-foreground">Version</span>
              <span className="font-mono">1.0.0</span>
            </div>
            <div className="flex justify-between">
              <span className="text-muted-foreground">Build</span>
              <span className="font-mono">2026.07.24</span>
            </div>
            <div className="flex justify-between">
              <span className="text-muted-foreground">Framework</span>
              <span>React + Vite + TailwindCSS</span>
            </div>
          </div>
        </Section>
      </div>
    </PageContent>
  )
}
