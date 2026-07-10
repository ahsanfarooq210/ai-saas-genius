import { useState, type FormEvent } from "react"
import { Link, useNavigate } from "react-router-dom"
import {
  ArrowRight,
  Check,
  Envelope,
  Eye,
  EyeSlash,
  LockKey,
  ShieldCheck,
  UserCircle,
  X,
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
import {
  Field,
  FieldDescription,
  FieldError,
  FieldGroup,
  FieldLabel,
} from "@/components/ui/field"
import {
  InputGroup,
  InputGroupAddon,
  InputGroupButton,
  InputGroupInput,
} from "@/components/ui/input-group"
import { Spinner } from "@/components/ui/spinner"
import { useAuth } from "@/features/auth/auth-context"
import { getErrorMessage } from "@/lib/api-error"
import { cn } from "@/lib/utils"

const MIN_PASSWORD_LENGTH = 8

export function SignupScreen() {
  const { signUp } = useAuth()
  const navigate = useNavigate()

  const [fullName, setFullName] = useState("")
  const [email, setEmail] = useState("")
  const [password, setPassword] = useState("")
  const [confirmPassword, setConfirmPassword] = useState("")
  const [showPassword, setShowPassword] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [isSubmitting, setIsSubmitting] = useState(false)

  const hasMinLength = password.length >= MIN_PASSWORD_LENGTH
  const passwordsMatch = confirmPassword.length > 0 && password === confirmPassword

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    setError(null)

    if (password.length < MIN_PASSWORD_LENGTH) {
      setError(`Password must be at least ${MIN_PASSWORD_LENGTH} characters.`)
      return
    }
    if (password !== confirmPassword) {
      setError("Passwords do not match.")
      return
    }

    setIsSubmitting(true)
    try {
      await signUp({
        email,
        password,
        full_name: fullName.trim() ? fullName.trim() : null,
      })
      navigate("/", { replace: true })
    } catch (err) {
      setError(getErrorMessage(err, "Could not create your account."))
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
            AI architecture workspace
          </Badge>
          <div className="flex size-14 items-center justify-center rounded-2xl bg-primary text-primary-foreground shadow-lg shadow-primary/25">
            <UserCircle className="size-7" weight="duotone" />
          </div>
          <div className="space-y-1.5">
            <CardTitle className="text-3xl font-semibold tracking-tight">
              Create your workspace
            </CardTitle>
            <CardDescription className="text-sm">
              Turn system ideas into review-ready architecture plans.
            </CardDescription>
          </div>
        </CardHeader>
        <form onSubmit={handleSubmit}>
          <CardContent className="px-6 py-7 sm:px-8">
            <FieldGroup className="gap-5">
              <Field>
                <div className="flex items-center justify-between">
                  <FieldLabel
                    htmlFor="signup-name"
                    className="text-sm font-medium"
                  >
                    Full name
                  </FieldLabel>
                  <span className="text-xs text-muted-foreground">Optional</span>
                </div>
                <InputGroup className="h-11 rounded-lg bg-background/60 transition-shadow focus-within:shadow-sm">
                  <InputGroupAddon>
                    <UserCircle />
                  </InputGroupAddon>
                  <InputGroupInput
                    id="signup-name"
                    type="text"
                    autoComplete="name"
                    placeholder="Ada Lovelace"
                    value={fullName}
                    onChange={(event) => setFullName(event.target.value)}
                    disabled={isSubmitting}
                  />
                </InputGroup>
              </Field>
              <Field data-invalid={!!error}>
                <FieldLabel
                  htmlFor="signup-email"
                  className="text-sm font-medium"
                >
                  Email address
                </FieldLabel>
                <InputGroup className="h-11 rounded-lg bg-background/60 transition-shadow focus-within:shadow-sm">
                  <InputGroupAddon>
                    <Envelope />
                  </InputGroupAddon>
                  <InputGroupInput
                    id="signup-email"
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
                <FieldLabel
                  htmlFor="signup-password"
                  className="text-sm font-medium"
                >
                  Password
                </FieldLabel>
                <InputGroup className="h-11 rounded-lg bg-background/60 transition-shadow focus-within:shadow-sm">
                  <InputGroupAddon>
                    <LockKey />
                  </InputGroupAddon>
                  <InputGroupInput
                    id="signup-password"
                    type={showPassword ? "text" : "password"}
                    autoComplete="new-password"
                    required
                    minLength={MIN_PASSWORD_LENGTH}
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
                <FieldDescription
                  className={cn(
                    "flex items-center gap-1.5",
                    hasMinLength && "text-primary"
                  )}
                >
                  {hasMinLength ? (
                    <Check className="size-3.5" />
                  ) : (
                    <X className="size-3.5 opacity-40" />
                  )}
                  At least {MIN_PASSWORD_LENGTH} characters
                </FieldDescription>
              </Field>
              <Field data-invalid={!!error}>
                <FieldLabel
                  htmlFor="signup-confirm-password"
                  className="text-sm font-medium"
                >
                  Confirm password
                </FieldLabel>
                <InputGroup className="h-11 rounded-lg bg-background/60 transition-shadow focus-within:shadow-sm">
                  <InputGroupAddon>
                    <LockKey />
                  </InputGroupAddon>
                  <InputGroupInput
                    id="signup-confirm-password"
                    type={showPassword ? "text" : "password"}
                    autoComplete="new-password"
                    required
                    value={confirmPassword}
                    onChange={(event) => setConfirmPassword(event.target.value)}
                    disabled={isSubmitting}
                  />
                </InputGroup>
                {confirmPassword.length > 0 && (
                  <FieldDescription
                    className={cn(
                      "flex items-center gap-1.5",
                      passwordsMatch ? "text-primary" : "text-destructive"
                    )}
                  >
                    {passwordsMatch ? (
                      <Check className="size-3.5" />
                    ) : (
                      <X className="size-3.5" />
                    )}
                    {passwordsMatch ? "Passwords match" : "Passwords do not match"}
                  </FieldDescription>
                )}
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
              Sign up
              {!isSubmitting && (
                <ArrowRight className="size-4" weight="bold" />
              )}
            </Button>
            <p className="flex items-center justify-center gap-1.5 text-xs text-muted-foreground">
              <ShieldCheck className="size-3.5" />
              Keep design work in one secure workspace
            </p>
            <p className="rounded-lg border border-border/70 bg-background/60 px-4 py-3 text-center text-xs text-muted-foreground">
              Already have an account?{" "}
              <Link to="/login" className="font-semibold text-primary underline-offset-4 hover:underline">
                Log in
              </Link>
            </p>
          </CardFooter>
        </form>
      </Card>
    </AuthLayout>
  )
}
