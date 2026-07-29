import type { ResolvedTheme, ThemeMode } from '../shared/types';

export const THEME_MODES: ThemeMode[] = ['system', 'dark', 'light'];

/** Type guard for persisted/IPC values. */
export function isThemeMode(value: unknown): value is ThemeMode {
  return value === 'system' || value === 'dark' || value === 'light';
}

/**
 * Resolve the effective theme. 'system' follows the OS preference; explicit
 * modes always win.
 */
export function resolveTheme(mode: ThemeMode, systemPrefersDark: boolean): ResolvedTheme {
  if (mode === 'dark') return 'dark';
  if (mode === 'light') return 'light';
  return systemPrefersDark ? 'dark' : 'light';
}
