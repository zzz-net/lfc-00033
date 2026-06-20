import { create } from "zustand";
import type { User } from "@/types";
import { api } from "@/utils/api";

interface AuthState {
  user: User | null;
  token: string | null;
  isAuthenticated: boolean;
  loading: boolean;
  login: (username: string, password: string) => Promise<void>;
  logout: () => void;
  loadFromStorage: () => void;
  fetchMe: () => Promise<void>;
}

const _initialToken = (() => {
  try { return localStorage.getItem("token"); } catch { return null; }
})();

export const useAuthStore = create<AuthState>((set) => ({
  user: null,
  token: _initialToken,
  isAuthenticated: !!_initialToken,
  loading: false,

  login: async (username: string, password: string) => {
    set({ loading: true });
    try {
      const res = await api.login(username, password);
      localStorage.setItem("token", res.token);
      set({
        user: res.user,
        token: res.token,
        isAuthenticated: true,
        loading: false,
      });
    } catch (err) {
      set({ loading: false });
      throw err;
    }
  },

  logout: () => {
    localStorage.removeItem("token");
    set({ user: null, token: null, isAuthenticated: false });
  },

  loadFromStorage: () => {
    const token = localStorage.getItem("token");
    if (token) {
      set({ token, isAuthenticated: true });
    }
  },

  fetchMe: async () => {
    try {
      const user = await api.getMe();
      set({ user, isAuthenticated: true });
    } catch {
      localStorage.removeItem("token");
      set({ user: null, token: null, isAuthenticated: false });
    }
  },
}));
