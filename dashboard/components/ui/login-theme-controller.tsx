'use client'

import { useEffect } from 'react'
import { useTheme } from '@/lib/theme-context'

export function LoginThemeController() {
  const { setTheme } = useTheme()

  useEffect(() => {
    setTheme('light')
  }, [setTheme])

  return null
}