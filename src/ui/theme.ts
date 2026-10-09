// Appearance on this device: theme (system / dark / light) and reading text size
// and spacing. Stored in localStorage (a per-device convenience); defaults apply
// if storage is unavailable.

export type ThemeChoice = 'system' | 'dark' | 'light';
export interface Appearance {
  theme: ThemeChoice;
  textSize: 1 | 2 | 3 | 4;
  spacing: 'normal' | 'roomy';
}

const KEY = 'noteable.appearance';
const DEFAULTS: Appearance = { theme: 'dark', textSize: 2, spacing: 'normal' };
const SIZES = { 1: '0.95rem', 2: '1.05rem', 3: '1.2rem', 4: '1.4rem' } as const;

export function loadAppearance(): Appearance {
  try {
    return { ...DEFAULTS, ...(JSON.parse(localStorage.getItem(KEY) ?? '{}') as Partial<Appearance>) };
  } catch {
    return DEFAULTS;
  }
}

export function saveAppearance(a: Appearance): void {
  try {
    localStorage.setItem(KEY, JSON.stringify(a));
  } catch {
    // Private mode etc.: still applies for this session.
  }
  applyAppearance(a);
}

export function applyAppearance(a: Appearance = loadAppearance()): void {
  const root = document.documentElement;
  const light = a.theme === 'light' || (a.theme === 'system' && matchMedia('(prefers-color-scheme: light)').matches);
  root.dataset.theme = light ? 'light' : 'dark';
  root.style.setProperty('--reader-size', SIZES[a.textSize]);
  root.style.setProperty('--reader-line', a.spacing === 'roomy' ? '1.9' : '1.65');
  document.querySelector('meta[name="theme-color"]')?.setAttribute('content', light ? '#f6f4ef' : '#0b0d10');
}

/** Follow the system setting live when "system" is chosen. */
export function watchSystemTheme(): void {
  matchMedia('(prefers-color-scheme: light)').addEventListener('change', () => {
    if (loadAppearance().theme === 'system') applyAppearance();
  });
}
