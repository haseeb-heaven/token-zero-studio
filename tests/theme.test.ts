import { describe, expect, it } from 'vitest';
import { defaultConfig, mergeConfig } from '../src/core/config';
import { isThemeMode, resolveTheme, THEME_MODES } from '../src/core/theme';

describe('isThemeMode', () => {
  it('accepts the three supported modes', () => {
    expect(isThemeMode('system')).toBe(true);
    expect(isThemeMode('dark')).toBe(true);
    expect(isThemeMode('light')).toBe(true);
    expect(THEME_MODES.length).toBe(3);
  });

  it('rejects anything else', () => {
    expect(isThemeMode('blue')).toBe(false);
    expect(isThemeMode('')).toBe(false);
    expect(isThemeMode(undefined)).toBe(false);
    expect(isThemeMode(null)).toBe(false);
    expect(isThemeMode(3)).toBe(false);
  });
});

describe('resolveTheme', () => {
  it('explicit dark always wins', () => {
    expect(resolveTheme('dark', true)).toBe('dark');
    expect(resolveTheme('dark', false)).toBe('dark');
  });

  it('explicit light always wins', () => {
    expect(resolveTheme('light', true)).toBe('light');
    expect(resolveTheme('light', false)).toBe('light');
  });

  it('system follows the OS preference', () => {
    expect(resolveTheme('system', true)).toBe('dark');
    expect(resolveTheme('system', false)).toBe('light');
  });
});

describe('theme in config', () => {
  it('defaults to light', () => {
    expect(defaultConfig().theme).toBe('light');
  });

  it('mergeConfig keeps a valid persisted theme', () => {
    expect(mergeConfig({ theme: 'dark' }).theme).toBe('dark');
    expect(mergeConfig({ theme: 'light' }).theme).toBe('light');
    expect(mergeConfig({ theme: 'system' }).theme).toBe('system');
  });

  it('mergeConfig rejects an invalid theme and falls back to light', () => {
    expect(mergeConfig({ theme: 'neon' }).theme).toBe('light');
    expect(mergeConfig({ theme: 42 }).theme).toBe('light');
  });
});
