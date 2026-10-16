import { create } from 'zustand';
import { createJSONStorage, persist } from 'zustand/middleware';

/** localStorage can throw (private mode, blocked storage, sandboxed frames); fall back to memory. */
const mem = new Map<string, string>();
const safeStorage = createJSONStorage(() => ({
  getItem: (k: string) => { try { return localStorage.getItem(k); } catch { return mem.get(k) ?? null; } },
  setItem: (k: string, v: string) => { try { localStorage.setItem(k, v); } catch { mem.set(k, v); } },
  removeItem: (k: string) => { try { localStorage.removeItem(k); } catch { mem.delete(k); } },
}));

export type Theme = 'system' | 'light' | 'dark' | 'contrast';

interface Toast { id: number; text: string; undo?: () => void | Promise<void> }

interface ConfirmRequest { message: string; action: string; danger?: boolean; resolve: (ok: boolean) => void }

interface UI {
  confirmReq: ConfirmRequest | null;
  theme: Theme;
  accent: string;
  hideAmounts: boolean;
  reduceMotion: boolean;
  viewAs: string | null; // member id for role-limited views (kids mode)
  quickAdd: { open: boolean; type?: 'expense' | 'income' | 'transfer'; draft?: Record<string, unknown> };
  toasts: Toast[];
  locked: boolean;
  setTheme: (t: Theme) => void;
  setAccent: (c: string) => void;
  toggleHide: () => void;
  setViewAs: (id: string | null) => void;
  openQuickAdd: (o?: UI['quickAdd']['type'], draft?: Record<string, unknown>) => void;
  closeQuickAdd: () => void;
  toast: (text: string, undo?: Toast['undo']) => void;
  dismiss: (id: number) => void;
  setLocked: (v: boolean) => void;
}

let n = 0;
export const useUI = create<UI>()(
  persist(
    (set) => ({
      theme: 'system',
      accent: '#0F4C5C',
      hideAmounts: false,
      reduceMotion: false,
      viewAs: null,
      quickAdd: { open: false },
      toasts: [],
      locked: false,
      confirmReq: null,
      setTheme: (theme) => set({ theme }),
      setAccent: (accent) => set({ accent }),
      toggleHide: () => set((s) => ({ hideAmounts: !s.hideAmounts })),
      setViewAs: (viewAs) => set({ viewAs }),
      openQuickAdd: (type = 'expense', draft) => set({ quickAdd: { open: true, type, draft } }),
      closeQuickAdd: () => set({ quickAdd: { open: false } }),
      toast: (text, undo) => {
        const id = ++n;
        set((s) => ({ toasts: [...s.toasts.slice(-2), { id, text, undo }] }));
        setTimeout(() => set((s) => ({ toasts: s.toasts.filter((t) => t.id !== id) })), 6000);
      },
      dismiss: (id) => set((s) => ({ toasts: s.toasts.filter((t) => t.id !== id) })),
      setLocked: (locked) => set({ locked }),
    }),
    { name: 'tandem-ui', storage: safeStorage, partialize: (s) => ({ theme: s.theme, accent: s.accent, hideAmounts: s.hideAmounts, viewAs: s.viewAs }) },
  ),
);

/**
 * In-app replacement for window.confirm(), which some hosts (embedded frames, app views)
 * suppress. Resolves true only when the person presses the action button.
 */
export function askConfirm(message: string, action = 'Continue', danger = true): Promise<boolean> {
  return new Promise((resolve) => useUI.setState({ confirmReq: { message, action, danger, resolve } }));
}
