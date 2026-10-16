import { create } from 'zustand';
import { persist } from 'zustand/middleware';

export type Theme = 'system' | 'light' | 'dark' | 'contrast';

interface Toast { id: number; text: string; undo?: () => void | Promise<void> }

interface UI {
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
    { name: 'tandem-ui', partialize: (s) => ({ theme: s.theme, accent: s.accent, hideAmounts: s.hideAmounts, viewAs: s.viewAs }) },
  ),
);
