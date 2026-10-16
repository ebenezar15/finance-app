import { Check } from 'lucide-react';
import { SCHEMES, rgb } from '../lib/schemes';
import { useUI, type Theme } from '../store/ui';
import { Segmented } from './ui';

/** Theme (light/dark/contrast) plus a colour scheme, each previewed as a tiny app screen. */
export function AppearancePicker({ compact = false }: { compact?: boolean }) {
  const { theme, setTheme, scheme, setScheme } = useUI();
  const dark = theme === 'dark' || (theme === 'system' && typeof matchMedia !== 'undefined' && matchMedia('(prefers-color-scheme: dark)').matches);
  return (
    <div className="space-y-4">
      <div>
        <p className="label">Theme</p>
        <Segmented<Theme> label="Theme" value={theme} onChange={setTheme} options={[
          { value: 'system', label: 'Auto' }, { value: 'light', label: 'Light' }, { value: 'dark', label: 'Dark' }, { value: 'contrast', label: compact ? 'Contrast' : 'High contrast' },
        ]} />
      </div>
      <fieldset disabled={theme === 'contrast'} className="disabled:opacity-50">
        <legend className="label">Colour scheme{theme === 'contrast' ? ' (not used with high contrast)' : ''}</legend>
        <div className="grid grid-cols-3 sm:grid-cols-6 gap-2.5" role="radiogroup" aria-label="Colour scheme">
          {SCHEMES.map((s) => {
            const t = dark ? s.dark : s.light;
            const on = scheme === s.id;
            return (
              <button key={s.id} type="button" role="radio" aria-checked={on} onClick={() => setScheme(s.id)}
                className={`rounded-2xl p-1.5 border-2 text-left transition-colors ${on ? 'border-ink' : 'border-transparent hover:border-line'}`}>
                <span className="block rounded-xl overflow-hidden h-16 relative" style={{ background: rgb(t.bg) }} aria-hidden>
                  <span className="absolute left-1.5 right-1.5 top-1.5 h-6 rounded-md" style={{ background: rgb(t.surface) }}>
                    <span className="absolute left-1.5 top-1.5 h-3 w-8 rounded-sm" style={{ background: rgb(t.primary) }} />
                  </span>
                  <span className="absolute left-1.5 bottom-1.5 h-5 w-5 rounded-md grid place-items-center" style={{ background: rgb(t.primary) }}>
                    {on && <Check size={12} style={{ color: rgb(t.onprimary) }} />}
                  </span>
                  <span className="absolute right-1.5 bottom-2 h-1.5 w-8 rounded-full" style={{ background: rgb(t.sunk) }} />
                </span>
                <span className="block text-[12px] font-semibold mt-1.5 px-0.5">{s.name}</span>
              </button>
            );
          })}
        </div>
      </fieldset>
    </div>
  );
}
