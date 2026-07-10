import { useState, type FormEvent } from "react"
import { Link, useLocation, useNavigate } from "react-router-dom"
import {
  ArrowRight,
  Envelope,
  Eye,
  EyeSlash,
  LockKey,
  ShieldCheck,
} from "@phosphor-icons/react"

import { AuthLayout } from "@/screens/auth/AuthLayout"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import {
  Card,
  CardContent,
  CardDescription,
  CardFooter,
  CardHeader,
  CardTitle,
} from "@/components/ui/card"
import { Field, FieldError, FieldGroup, FieldLabel } from "@/components/ui/field"
import {
  InputGroup,
  InputGroupAddon,
  InputGroupButton,
  InputGroupInput,
} from "@/components/ui/input-group"
import { Spinner } from "@/components/ui/spinner"
import { useAuth } from "@/features/auth/auth-context"
import { getErrorMessage } from "@/lib/api-error"

export function LoginScreen() {
  const { signIn } = useAuth()
  const navigate = useNavigate()
  const location = useLocation()

  const [email, setEmail] = useState("")
  const [password, setPassword] = useState("")
  const [showPassword, setShowPassword] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [isSubmitting, setIsSubmitting] = useState(false)

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    setError(null)
    setIsSubmitting(true)

    try {
      await signIn({ email, password })
      const from =
        (location.state as { from?: { pathname?: string } } | null)?.from
          ?.pathname ?? "/"
      navigate(from, { replace: true })
    } catch (err) {
      setError(getErrorMessage(err, "Invalid email or password."))
    } finally {
      setIsSubmitting(false)
    }
  }

  return (
    <AuthLayout>
      <Card className="border-border/80 bg-card/95 py-0 shadow-xl shadow-primary/10 backdrop-blur-sm">
        <CardHeader className="items-center gap-4 border-b border-border/70 px-6 py-7 text-center sm:px-8">
          <Badge
            variant="secondary"
            className="rounded-full px-3 text-[10px] tracking-[0.16em] uppercase"
          >
            Architecture design workspace
          </Badge>
          <div className="flex size-14 items-center justify-center rounded-2xl bg-primary text-primary-foreground shadow-lg shadow-primary/25">
            <LockKey className="size-7" weight="duotone" />
          </div>
          <div className="space-y-1.5">
            <CardTitle className="text-3xl font-semibold tracking-tight">
              Welcome back
            </CardTitle>
            <CardDescription className="text-sm">
              Pick up your architecture plans, diagrams, and design reviews.
            </CardDescription>
          </div>
        </CardHeader>
        <form onSubmit={handleSubmit}>
          <CardContent className="px-6 py-7 sm:px-8">
            <FieldGroup className="gap-5">
              <Field data-invalid={!!error}>
                <FieldLabel
                  htmlFor="login-email"
                  className="text-sm font-medium"
                >
                  Email address
                </FieldLabel>
                <InputGroup className="h-11 rounded-lg bg-background/60 transition-shadow focus-within:shadow-sm">
                  <InputGroupAddon>
                    <Envelope />
                  </InputGroupAddon>
                  <InputGroupInput
                    id="login-email"
                    type="email"
                    autoComplete="email"
                    placeholder="you@example.com"
                    required
                    value={email}
                    onChange={(event) => setEmail(event.target.value)}
                    disabled={isSubmitting}
                  />
                </InputGroup>
              </Field>
              <Field data-invalid={!!error}>
                <div className="flex items-center justify-between">
                  <FieldLabel
                    htmlFor="login-password"
                    className="text-sm font-medium"
                  >
                    Password
                  </FieldLabel>
                  <span className="text-xs text-muted-foreground">
                    Your workspace is protected
                  </span>
                </div>
                <InputGroup className="h-11 rounded-lg bg-background/60 transition-shadow focus-within:shadow-sm">
                  <InputGroupAddon>
                    <LockKey />
                  </InputGroupAddon>
                  <InputGroupInput
                    id="login-password"
                    type={showPassword ? "text" : "password"}
                    autoComplete="current-password"
                    required
                    value={password}
                    onChange={(event) => setPassword(event.target.value)}
                    disabled={isSubmitting}
                  />
                  <InputGroupAddon align="inline-end">
                    <InputGroupButton
                      type="button"
                      aria-label={
                        showPassword ? "Hide password" : "Show password"
                      }
                      onClick={() => setShowPassword((value) => !value)}
                    >
                      {showPassword ? <EyeSlash /> : <Eye />}
                    </InputGroupButton>
                  </InputGroupAddon>
                </InputGroup>
              </Field>
              {error && <FieldError>{error}</FieldError>}
            </FieldGroup>
          </CardContent>
          <CardFooter className="flex flex-col gap-5 border-t border-border/70 bg-muted/30 px-6 py-6 sm:px-8">
            <Button
              type="submit"
              size="lg"
              className="h-11 w-full rounded-lg text-sm shadow-md shadow-primary/20"
              disabled={isSubmitting}
            >
              {isSubmitting && <Spinner />}
              Log in
              {!isSubmitting && (
                <ArrowRight className="size-4" weight="bold" />
              )}
            </Button>
            <p className="flex items-center justify-center gap-1.5 text-xs text-muted-foreground">
              <ShieldCheck className="size-3.5" />
              Keep design work in one secure workspace
            </p>
            <p className="rounded-lg border border-border/70 bg-background/60 px-4 py-3 text-center text-xs text-muted-foreground">
              Don&apos;t have an account?{" "}
              <Link to="/signup" className="font-semibold text-primary underline-offset-4 hover:underline">
                Sign up
              </Link>
            </p>
          </CardFooter>
        </form>
      </Card>
    </AuthLayout>
  )
}
