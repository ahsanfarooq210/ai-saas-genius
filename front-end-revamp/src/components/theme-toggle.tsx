import { Moon, Sun } from '@phosphor-icons/react'

import { Button } from '@/components/ui/button'
import { useTheme } from '@/features/theme/theme-context'

export function ThemeToggle() {
  const { theme, toggleTheme } = useTheme()
  const isDark = theme === 'dark'

  return (
    <Button
      variant="outline"
      size="icon"
      onClick={toggleTheme}
      aria-label={`Switch to ${isDark ? 'light' : 'dark'} mode`}
    >
      {isDark ? <Sun /> : <Moon />}
    </Button>
  )
}
