import { create } from 'zustand'
import { persist } from 'zustand/middleware'

type Usuario = {
  id: string
  nome: string
  email: string
  perfil: string
}

type AuthState = {
  token: string | null
  refreshToken: string | null
  usuario: Usuario | null
  setAuth: (token: string, refreshToken: string, usuario: Usuario) => void
  logout: () => void
}

export const useAuthStore = create<AuthState>()(
  persist(
    (set) => ({
      token: null,
      refreshToken: null,
      usuario: null,
      setAuth: (token, refreshToken, usuario) => set({ token, refreshToken, usuario }),
      logout: () => set({ token: null, refreshToken: null, usuario: null }),
    }),
    { name: 'auth-storage' }
  )
)
