import React, { createContext, useContext, useState, useEffect } from "react";
import { api } from "../lib/api";

interface User {
  id: string;
  name: string;
  email: string;
}

interface AuthContextType {
  user: User | null;
  setUser: (user: User | null) => void;
  isPending: boolean;
  signIn: (data: any) => Promise<{ error: any }>;
  signUp: (data: any) => Promise<{ error: any }>;
  signOut: () => Promise<void>;
}

const AuthContext = createContext<AuthContextType | undefined>(undefined);

export const AuthProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const [user, setUser] = useState<User | null>(null);
  const [isPending, setIsPending] = useState(true);

  useEffect(() => {
    const fetchUser = async () => {
      try {
        const userData = await api.auth.me();
        setUser({
          id: userData.id.toString(),
          name: userData.full_name,
          email: userData.email,
        });
      } catch (error) {
        setUser(null);
      } finally {
        setIsPending(false);
      }
    };

    fetchUser();
  }, []);

  const signIn = async (data: any) => {
    try {
      await api.auth.signin(data);
      const userData = await api.auth.me();
      setUser({
        id: userData.id.toString(),
        name: userData.full_name,
        email: userData.email,
      });
      return { error: null };
    } catch (error: any) {
      return { error: { message: error.response?.data?.message || "Login failed" } };
    }
  };

  const signUp = async (data: any) => {
    try {
      await api.auth.signup(data);
      // Auto-login after signup
      if (data.password) {
        await api.auth.signin({ email: data.email, password: data.password });
        const userData = await api.auth.me();
        setUser({
          id: userData.id.toString(),
          name: userData.full_name,
          email: userData.email,
        });
      }
      return { error: null };
    } catch (error: any) {
      return { error: { message: error.response?.data?.message || "Signup failed" } };
    }
  };

  const signOut = async () => {
    try {
      // Clear localStorage tokens
      localStorage.removeItem("accessToken");
      localStorage.removeItem("refreshToken");
      // Optionally call a logout endpoint if it exists: await axiosClient.post("/auth/logout");
      setUser(null);
    } catch (error) {
      console.error("Logout error", error);
    }
  };

  return (
    <AuthContext.Provider value={{ user, setUser, isPending, signIn, signUp, signOut }}>
      {children}
    </AuthContext.Provider>
  );
};

export const useAuth = () => {
  const context = useContext(AuthContext);
  if (context === undefined) {
    throw new Error("useAuth must be used within an AuthProvider");
  }
  return context;
};

// Compatibility hook for existing useSession usages
export const useSession = () => {
  const { user, isPending } = useAuth();
  return {
    data: user ? { user } : null,
    isPending,
  };
};

export const authClient = {
  signIn: {
    email: async (_data: any) => {
      throw new Error("Use useAuth() signIn instead of authClient.signIn.email");
    }
  },
  signUp: {
    email: async (_data: any) => {
      throw new Error("Use useAuth() signUp instead of authClient.signUp.email");
    }
  },
  signOut: async () => {
    throw new Error("Use useAuth() signOut instead of authClient.signOut");
  }
};
