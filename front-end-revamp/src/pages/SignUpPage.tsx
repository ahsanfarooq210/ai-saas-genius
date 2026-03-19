import { type FormEvent, useState } from "react";
import {
  ArrowRight,
  KeyRound,
  Mail,
  Sparkles,
  UserRound,
  WandSparkles,
} from "lucide-react";
import { Link, useNavigate } from "react-router-dom";
import { useAuth } from "@/contexts/AuthContext";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Field, FieldGroup, FieldLabel } from "@/components/ui/field";
import { Input } from "@/components/ui/input";

const highlights = [
  "Start generating content across chat, code, image, music, and video",
  "Save your progress in one personalized creative workspace",
  "Enjoy a polished experience designed for focused productivity",
];

const SignUpPage = () => {
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);
  const navigate = useNavigate();
  const { signUp } = useAuth();

  const handleSignUp = async (e: FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    setLoading(true);
    setError("");

    const { error: authError } = await signUp({
      email,
      password,
      name,
    });

    setLoading(false);

    if (authError) {
      setError(authError.message || "Failed to sign up");
    } else {
      navigate("/dashboard");
    }
  };

  return (
    <div className="relative min-h-screen overflow-hidden bg-background px-4 py-8 text-foreground md:px-6 lg:px-8">
      <div className="absolute inset-0 bg-[radial-gradient(circle_at_top_right,rgba(59,130,246,0.10),transparent_24%),radial-gradient(circle_at_bottom_left,rgba(217,119,6,0.10),transparent_28%)]" />
      <div className="relative mx-auto flex min-h-[calc(100vh-4rem)] max-w-6xl items-center justify-center">
        <div className="grid w-full overflow-hidden rounded-[28px] border border-border/70 bg-card/70 shadow-2xl shadow-black/8 backdrop-blur-xl lg:grid-cols-[0.98fr_1.02fr]">
          <div className="flex items-center justify-center p-4 sm:p-8 lg:p-10">
            <Card className="w-full max-w-xl border-border/70 bg-background/80 py-0 shadow-none ring-0">
              <CardHeader className="space-y-4 border-b border-border/70 px-6 py-6 sm:px-8">
                <div className="flex items-center justify-between gap-3">
                  <Badge variant="outline" className="border-border/70 bg-background/80 text-muted-foreground">
                    New account
                  </Badge>
                  <Link to="/" className="text-sm font-medium text-muted-foreground transition hover:text-foreground lg:hidden">
                    Back home
                  </Link>
                </div>
                <div className="space-y-2">
                  <CardTitle className="text-3xl font-extrabold tracking-tight">
                    Sign Up
                  </CardTitle>
                  <CardDescription className="text-sm leading-6">
                    Create your account and unlock a beautiful AI workspace for
                    faster output and smoother creative flow.
                  </CardDescription>
                </div>
              </CardHeader>

              <CardContent className="space-y-6 px-6 py-6 sm:px-8">
                {error && (
                  <div className="rounded-2xl border border-destructive/20 bg-destructive/10 px-4 py-3 text-sm text-destructive">
                    {error}
                  </div>
                )}

                <form onSubmit={handleSignUp} className="space-y-5">
                  <FieldGroup>
                    <Field>
                      <FieldLabel htmlFor="signup-name">Name</FieldLabel>
                      <div className="relative">
                        <UserRound className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
                        <Input
                          id="signup-name"
                          type="text"
                          value={name}
                          onChange={(e) => setName(e.target.value)}
                          required
                          placeholder="Your full name"
                          className="h-11 rounded-xl border-border/70 bg-background/90 pl-10"
                        />
                      </div>
                    </Field>

                    <Field>
                      <FieldLabel htmlFor="signup-email">Email</FieldLabel>
                      <div className="relative">
                        <Mail className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
                        <Input
                          id="signup-email"
                          type="email"
                          value={email}
                          onChange={(e) => setEmail(e.target.value)}
                          required
                          placeholder="you@example.com"
                          className="h-11 rounded-xl border-border/70 bg-background/90 pl-10"
                        />
                      </div>
                    </Field>

                    <Field>
                      <FieldLabel htmlFor="signup-password">Password</FieldLabel>
                      <div className="relative">
                        <KeyRound className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
                        <Input
                          id="signup-password"
                          type="password"
                          value={password}
                          onChange={(e) => setPassword(e.target.value)}
                          required
                          placeholder="Create a strong password"
                          className="h-11 rounded-xl border-border/70 bg-background/90 pl-10"
                        />
                      </div>
                    </Field>
                  </FieldGroup>

                  <Button
                    type="submit"
                    className="h-11 w-full rounded-xl text-sm font-semibold"
                    disabled={loading}
                  >
                    <span>{loading ? "Signing up..." : "Create account"}</span>
                    <ArrowRight className="h-4 w-4" />
                  </Button>
                </form>

                <div className="rounded-2xl border border-border/70 bg-muted/40 px-4 py-3 text-sm text-muted-foreground">
                  Already have an account?{" "}
                  <button
                    type="button"
                    onClick={() => navigate("/sign-in")}
                    className="font-semibold text-primary transition hover:underline"
                  >
                    Sign in here
                  </button>
                </div>
              </CardContent>
            </Card>
          </div>

          <div className="relative hidden border-l border-border/70 bg-linear-to-br from-background via-muted/50 to-background p-10 lg:flex lg:flex-col lg:justify-between">
            <div className="space-y-6">
              <Link to="/" className="inline-flex w-fit items-center gap-3 rounded-full border border-border/70 bg-background/80 px-4 py-2 text-sm font-medium shadow-sm transition hover:bg-background">
                <div className="flex h-9 w-9 items-center justify-center rounded-full bg-primary text-primary-foreground shadow-lg shadow-primary/20">
                  <Sparkles className="h-4 w-4" />
                </div>
                Genius
              </Link>

              <div className="space-y-4">
                <Badge variant="secondary" className="border-0 bg-primary/10 text-primary">
                  Start free
                </Badge>
                <div className="space-y-3">
                  <h1 className="max-w-md text-4xl font-extrabold tracking-tight">
                    Build your account and unlock your AI toolkit.
                  </h1>
                  <p className="max-w-lg text-sm leading-6 text-muted-foreground">
                    Create once, then move through a polished workspace designed
                    for focused ideation, faster execution, and better output.
                  </p>
                </div>
              </div>
            </div>

            <div className="space-y-4">
              {highlights.map((highlight) => (
                <div
                  key={highlight}
                  className="flex items-start gap-3 rounded-2xl border border-border/70 bg-background/80 p-4 shadow-sm"
                >
                  <div className="mt-0.5 flex h-9 w-9 shrink-0 items-center justify-center rounded-xl bg-primary/10 text-primary">
                    <WandSparkles className="h-4 w-4" />
                  </div>
                  <p className="text-sm leading-6 text-foreground/85">{highlight}</p>
                </div>
              ))}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
};

export default SignUpPage;
