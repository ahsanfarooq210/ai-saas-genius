import { useCallback, useEffect, useMemo, useState, type ReactNode } from "react"

import { authApi } from "@/api"
import type { SignInRequest, SignUpRequest, UserResponse } from "@/api/auth/auth.types"
import { AuthContext } from "@/features/auth/auth-context"

export function AuthProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<UserResponse | null>(null)
  const [isLoading, setIsLoading] = useState(true)

  useEffect(() => {
    let cancelled = false

    authApi
      .getCurrentUser()
      .then((current) => {
        if (!cancelled) setUser(current)
      })
      .catch(() => {
        if (!cancelled) setUser(null)
      })
      .finally(() => {
        if (!cancelled) setIsLoading(false)
      })

    return () => {
      cancelled = true
    }
  }, [])

  const signIn = useCallback(async (input: SignInRequest) => {
    await authApi.logIn(input)
    setUser(await authApi.getCurrentUser())
  }, [])

  const signUp = useCallback(async (input: SignUpRequest) => {
    await authApi.signUp(input)
    setUser(await authApi.getCurrentUser())
  }, [])

  const logout = useCallback(async () => {
    try {
      await authApi.logout()
    } finally {
      setUser(null)
    }
  }, [])

  const value = useMemo(
    () => ({ user, isLoading, signIn, signUp, logout }),
    [user, isLoading, signIn, signUp, logout]
  )

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>
}
