import { useState, type FormEvent } from "react"
import { Link, useNavigate } from "react-router-dom"
import {
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
      <Card className="shadow-lg shadow-primary/5">
        <CardHeader className="items-center gap-3 text-center">
          <div className="flex size-12 items-center justify-center rounded-xl bg-primary/10 text-primary">
            <UserCircle className="size-6" weight="duotone" />
          </div>
          <CardTitle className="text-2xl font-semibold tracking-tight">
            Create an account
          </CardTitle>
          <CardDescription>
            Sign up to start building with the swarm.
          </CardDescription>
        </CardHeader>
        <form onSubmit={handleSubmit}>
          <CardContent>
            <FieldGroup>
              <Field>
                <FieldLabel htmlFor="signup-name">Full name</FieldLabel>
                <InputGroup>
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
                <FieldDescription>Optional.</FieldDescription>
              </Field>
              <Field data-invalid={!!error}>
                <FieldLabel htmlFor="signup-email">Email</FieldLabel>
                <InputGroup>
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
                <FieldLabel htmlFor="signup-password">Password</FieldLabel>
                <InputGroup>
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
                <FieldLabel htmlFor="signup-confirm-password">
                  Confirm password
                </FieldLabel>
                <InputGroup>
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
          <CardFooter className="mt-5 flex flex-col gap-3">
            <Button type="submit" className="w-full" disabled={isSubmitting}>
              {isSubmitting && <Spinner />}
              Sign up
            </Button>
            <p className="flex items-center justify-center gap-1.5 text-xs text-muted-foreground">
              <ShieldCheck className="size-3.5" />
              Secured with encrypted sessions
            </p>
            <p className="text-xs text-muted-foreground">
              Already have an account?{" "}
              <Link to="/login" className="text-primary underline-offset-4 hover:underline">
                Log in
              </Link>
            </p>
          </CardFooter>
        </form>
      </Card>
    </AuthLayout>
  )
}
