import { createContext, useContext } from "react"

import type { SignInRequest, SignUpRequest, UserResponse } from "@/api/auth/auth.types"

export type AuthContextValue = {
  user: UserResponse | null
  // True only while the initial session bootstrap (GET /auth/me) is in flight.
  isLoading: boolean
  signIn: (input: SignInRequest) => Promise<void>
  signUp: (input: SignUpRequest) => Promise<void>
  logout: () => Promise<void>
}

export const AuthContext = createContext<AuthContextValue | undefined>(undefined)

export function useAuth(): AuthContextValue {
  const context = useContext(AuthContext)
  if (!context) {
    throw new Error("useAuth must be used within an AuthProvider")
  }
  return context
}
