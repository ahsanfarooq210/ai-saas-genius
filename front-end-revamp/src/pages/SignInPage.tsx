import { type FormEvent, useState } from "react";
import {
  ArrowRight,
  KeyRound,
  Mail,
  ShieldCheck,
  Sparkles,
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

const benefits = [
  "Access your AI dashboard from anywhere",
  "Continue your creative workflows instantly",
  "Switch between light and dark themes seamlessly",
];

const SignInPage = () => {
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);
  const navigate = useNavigate();
  const { signIn } = useAuth();

  const handleSignIn = async (e: FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    setLoading(true);
    setError("");

    const { error: authError } = await signIn({
      email,
      password,
    });

    setLoading(false);

    if (authError) {
      setError(authError.message || "Failed to sign in");
    } else {
      navigate("/swarm");
    }
  };

  return (
    <div className="relative min-h-screen overflow-hidden bg-background px-4 py-8 text-foreground md:px-6 lg:px-8">
      <div className="absolute inset-0 bg-[radial-gradient(circle_at_top_left,rgba(217,119,6,0.10),transparent_28%),radial-gradient(circle_at_bottom_right,rgba(59,130,246,0.10),transparent_24%)]" />
      <div className="relative mx-auto flex min-h-[calc(100vh-4rem)] max-w-6xl items-center justify-center">
        <div className="grid w-full overflow-hidden rounded-[28px] border border-border/70 bg-card/70 shadow-2xl shadow-black/8 backdrop-blur-xl lg:grid-cols-[1.05fr_0.95fr]">
          <div className="relative hidden border-r border-border/70 bg-linear-to-br from-muted/60 via-background to-background p-10 lg:flex lg:flex-col lg:justify-between">
            <div className="space-y-6">
              <Link to="/landing" className="inline-flex w-fit items-center gap-3 rounded-full border border-border/70 bg-background/80 px-4 py-2 text-sm font-medium shadow-sm transition hover:bg-background">
                <div className="flex h-9 w-9 items-center justify-center rounded-full bg-primary text-primary-foreground shadow-lg shadow-primary/20">
                  <Sparkles className="h-4 w-4" />
                </div>
                Genius
              </Link>

              <div className="space-y-4">
                <Badge variant="secondary" className="border-0 bg-primary/10 text-primary">
                  Welcome back
                </Badge>
                <div className="space-y-3">
                  <h1 className="max-w-md text-4xl font-extrabold tracking-tight">
                    Sign in and continue creating with AI.
                  </h1>
                  <p className="max-w-lg text-sm leading-6 text-muted-foreground">
                    Access your workspace, pick up unfinished ideas, and jump back
                    into conversations, code, music, images, and video generation.
                  </p>
                </div>
              </div>
            </div>

            <div className="space-y-4">
              {benefits.map((benefit) => (
                <div
                  key={benefit}
                  className="flex items-start gap-3 rounded-2xl border border-border/70 bg-background/80 p-4 shadow-sm"
                >
                  <div className="mt-0.5 flex h-9 w-9 shrink-0 items-center justify-center rounded-xl bg-primary/10 text-primary">
                    <ShieldCheck className="h-4 w-4" />
                  </div>
                  <p className="text-sm leading-6 text-foreground/85">{benefit}</p>
                </div>
              ))}
            </div>
          </div>

          <div className="flex items-center justify-center p-4 sm:p-8 lg:p-10">
            <Card className="w-full max-w-xl border-border/70 bg-background/80 py-0 shadow-none ring-0">
              <CardHeader className="space-y-4 border-b border-border/70 px-6 py-6 sm:px-8">
                <div className="flex items-center justify-between gap-3">
                  <Badge variant="outline" className="border-border/70 bg-background/80 text-muted-foreground">
                    Secure access
                  </Badge>
                  <Link to="/landing" className="text-sm font-medium text-muted-foreground transition hover:text-foreground lg:hidden">
                    Back home
                  </Link>
                </div>
                <div className="space-y-2">
                  <CardTitle className="text-3xl font-extrabold tracking-tight">
                    Sign In
                  </CardTitle>
                  <CardDescription className="text-sm leading-6">
                    Enter your details to access your dashboard and creative
                    workspace.
                  </CardDescription>
                </div>
              </CardHeader>

              <CardContent className="space-y-6 px-6 py-6 sm:px-8">
                {error && (
                  <div className="rounded-2xl border border-destructive/20 bg-destructive/10 px-4 py-3 text-sm text-destructive">
                    {error}
                  </div>
                )}

                <form onSubmit={handleSignIn} className="space-y-5">
                  <FieldGroup>
                    <Field>
                      <FieldLabel htmlFor="signin-email">Email</FieldLabel>
                      <div className="relative">
                        <Mail className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
                        <Input
                          id="signin-email"
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
                      <FieldLabel htmlFor="signin-password">Password</FieldLabel>
                      <div className="relative">
                        <KeyRound className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
                        <Input
                          id="signin-password"
                          type="password"
                          value={password}
                          onChange={(e) => setPassword(e.target.value)}
                          required
                          placeholder="Enter your password"
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
                    <span>{loading ? "Signing in..." : "Sign In"}</span>
                    <ArrowRight className="h-4 w-4" />
                  </Button>
                </form>

                <div className="rounded-2xl border border-border/70 bg-muted/40 px-4 py-3 text-sm text-muted-foreground">
                  Don&apos;t have an account?{" "}
                  <button
                    type="button"
                    onClick={() => navigate("/sign-up")}
                    className="font-semibold text-primary transition hover:underline"
                  >
                    Create one now
                  </button>
                </div>
              </CardContent>
            </Card>
          </div>
        </div>
      </div>
    </div>
  );
};

export default SignInPage;
