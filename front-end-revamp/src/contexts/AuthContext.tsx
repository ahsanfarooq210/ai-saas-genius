import React, { createContext, useContext, useState, useEffect } from "react";
import { axiosClient } from "../lib/axios";

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
        const response = await axiosClient.get("/auth/me");
        setUser({
          id: response.data.id,
          name: response.data.full_name,
          email: response.data.email,
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
      const response = await axiosClient.post("/auth/signin", data);
      setUser({
        id: response.data._id,
        name: response.data.name,
        email: response.data.email,
      });
      return { error: null };
    } catch (error: any) {
      return { error: { message: error.response?.data?.message || "Login failed" } };
    }
  };

  const signUp = async (data: any) => {
    try {
      const response = await axiosClient.post("/auth/signup", data);
      setUser({
        id: response.data._id,
        name: response.data.name,
        email: response.data.email,
      });
      return { error: null };
    } catch (error: any) {
      return { error: { message: error.response?.data?.message || "Signup failed" } };
    }
  };

  const signOut = async () => {
    try {
      await axiosClient.post("/auth/logout");
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
    email: async (data: any) => {
      // This is a bit hacky because we need access to the context outside of a hook for sign in
      // However, looking at the code, SignInPage actually uses it inside the component.
      // A better approach is to provide signIn from useAuth in SignInPage.
      // But to preserve the API as much as possible, we could use a global approach or just update the pages.
      // For now, we'll implement this properly in the pages.
      throw new Error("Use useAuth() signIn instead of authClient.signIn.email");
    }
  },
  signUp: {
    email: async (data: any) => {
      throw new Error("Use useAuth() signUp instead of authClient.signUp.email");
    }
  },
  signOut: async () => {
    throw new Error("Use useAuth() signOut instead of authClient.signOut");
  }
};
