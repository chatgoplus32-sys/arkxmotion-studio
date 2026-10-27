import { Sun, Moon } from 'lucide-react'
import { useTheme } from '@/lib/theme'

export function ThemeToggle() {
  const { resolved, setTheme } = useTheme()
  const next = resolved === 'dark' ? 'light' : 'dark'

  return (
    <button
      onClick={() => setTheme(next)}
      aria-label={next === 'light' ? 'Aktifkan mode terang' : 'Aktifkan mode gelap'}
      className="flex h-9 w-9 items-center justify-center rounded-lg text-muted-foreground transition-colors hover:bg-accent hover:text-foreground"
      title={next === 'light' ? 'Switch to light mode' : 'Switch to dark mode'}
    >
      {resolved === 'dark' ? <Sun className="h-4 w-4" /> : <Moon className="h-4 w-4" />}
    </button>
  )
}
