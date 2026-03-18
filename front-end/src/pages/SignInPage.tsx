import { useState } from "react";
import { useNavigate } from "react-router-dom";
import { useAuth } from "@/contexts/AuthContext";
import { Button } from "@/components/ui/button";

const SignInPage = () => {
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);
  const navigate = useNavigate();
  const { signIn } = useAuth();

  const handleSignIn = async (e: React.FormEvent) => {
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
      navigate("/dashboard");
    }
  };

  return (
    <div className="flex h-screen items-center justify-center bg-slate-50">
      <div className="w-full max-w-md p-8 bg-white rounded-xl shadow-lg border border-slate-200">
        <h2 className="text-2xl font-bold text-center text-slate-900 mb-6">Sign In</h2>
        {error && <p className="text-red-500 text-sm mb-4 text-center">{error}</p>}
        <form onSubmit={handleSignIn} className="space-y-4">
          <div>
            <label className="block text-sm font-medium text-slate-700">Email</label>
            <input
              type="email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              required
              className="mt-1 block w-full px-3 py-2 bg-slate-50 border border-slate-300 rounded-md text-slate-900 focus:outline-none focus:ring-2 focus:ring-violet-500"
            />
          </div>
          <div>
            <label className="block text-sm font-medium text-slate-700">Password</label>
            <input
              type="password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              required
              className="mt-1 block w-full px-3 py-2 bg-slate-50 border border-slate-300 rounded-md text-slate-900 focus:outline-none focus:ring-2 focus:ring-violet-500"
            />
          </div>
          <Button type="submit" className="w-full bg-violet-600 hover:bg-violet-700 text-white" disabled={loading}>
            {loading ? "Signing in..." : "Sign In"}
          </Button>
        </form>
        <div className="mt-4 text-center text-sm text-slate-500">
          Don't have an account?{" "}
          <button onClick={() => navigate("/sign-up")} className="text-violet-600 font-semibold hover:underline">
            Sign Up
          </button>
        </div>
      </div>
    </div>
  );
};

export default SignInPage;
