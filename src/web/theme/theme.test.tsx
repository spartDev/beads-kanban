import { act, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { installMatchMedia } from '../test/matchMedia';
import { ThemeProvider, useTheme } from './ThemeProvider';
import {
  THEME_COLOR,
  THEME_STORAGE_KEY,
  parseThemePreference,
  readThemePreference,
  resolveTheme,
  writeThemePreference,
  type ResolvedTheme,
} from './theme';

function Probe() {
  const { preference, resolved, setPreference } = useTheme();
  return (
    <div>
      <output aria-label="état">{`${preference}/${resolved}`}</output>
      <button onClick={() => setPreference('light')}>clair</button>
      <button onClick={() => setPreference('dark')}>sombre</button>
      <button onClick={() => setPreference('system')}>système</button>
    </div>
  );
}

const html = () => document.documentElement.dataset.theme;
const state = () => screen.getByLabelText('état').textContent;

afterEach(() => {
  vi.restoreAllMocks();
});

describe('préférence de thème', () => {
  it('ne connaît que clair, sombre et système', () => {
    expect(parseThemePreference('dark')).toBe('dark');
    expect(parseThemePreference('light')).toBe('light');
    expect(parseThemePreference('system')).toBe('system');
    expect(parseThemePreference('violet')).toBe('system');
    expect(parseThemePreference(null)).toBe('system');
  });

  it('suit le système tant qu’on n’a rien forcé', () => {
    expect(resolveTheme('system', true)).toBe('dark');
    expect(resolveTheme('system', false)).toBe('light');
    expect(resolveTheme('light', true)).toBe('light');
    expect(resolveTheme('dark', false)).toBe('dark');
  });

  it('survit à un stockage indisponible', () => {
    vi.spyOn(window.localStorage, 'getItem').mockImplementation(() => {
      throw new DOMException('Accès refusé', 'SecurityError');
    });
    vi.spyOn(window.localStorage, 'setItem').mockImplementation(() => {
      throw new DOMException('Quota dépassé', 'QuotaExceededError');
    });

    expect(readThemePreference()).toBe('system');
    expect(() => writeThemePreference('dark')).not.toThrow();
  });
});

describe('ThemeProvider', () => {
  it('suit prefers-color-scheme par défaut', () => {
    installMatchMedia(true);
    render(<ThemeProvider><Probe /></ThemeProvider>);

    expect(state()).toBe('system/dark');
    expect(html()).toBe('dark');
  });

  it('reste en clair quand le système est en clair', () => {
    render(<ThemeProvider><Probe /></ThemeProvider>);

    expect(state()).toBe('system/light');
    expect(html()).toBe('light');
  });

  it('suit le système en direct tant que la préférence est « système »', () => {
    const system = installMatchMedia(false);
    render(<ThemeProvider><Probe /></ThemeProvider>);

    act(() => system.setDark(true));
    expect(html()).toBe('dark');
    act(() => system.setDark(false));
    expect(html()).toBe('light');
  });

  it('ignore le système une fois un thème forcé', async () => {
    const system = installMatchMedia(false);
    const user = userEvent.setup();
    render(<ThemeProvider><Probe /></ThemeProvider>);

    await user.click(screen.getByRole('button', { name: 'sombre' }));
    act(() => system.setDark(false));
    act(() => system.setDark(true));
    act(() => system.setDark(false));

    expect(state()).toBe('dark/dark');
    expect(html()).toBe('dark');
  });

  it('mémorise la bascule et la retrouve au rechargement', async () => {
    const user = userEvent.setup();
    const first = render(<ThemeProvider><Probe /></ThemeProvider>);
    await user.click(screen.getByRole('button', { name: 'sombre' }));
    expect(window.localStorage.getItem(THEME_STORAGE_KEY)).toBe('dark');

    first.unmount();
    document.documentElement.removeAttribute('data-theme');
    render(<ThemeProvider><Probe /></ThemeProvider>);

    // Le système est en clair : seul le choix mémorisé peut produire « sombre ».
    expect(state()).toBe('dark/dark');
    expect(html()).toBe('dark');
  });

  it('revient au système quand on le redemande, et l’écrit aussi', async () => {
    installMatchMedia(true);
    const user = userEvent.setup();
    render(<ThemeProvider><Probe /></ThemeProvider>);

    await user.click(screen.getByRole('button', { name: 'clair' }));
    expect(html()).toBe('light');
    await user.click(screen.getByRole('button', { name: 'système' }));

    expect(html()).toBe('dark');
    expect(window.localStorage.getItem(THEME_STORAGE_KEY)).toBe('system');
  });

  it('suit un changement fait dans un autre onglet', () => {
    render(<ThemeProvider><Probe /></ThemeProvider>);

    act(() => {
      window.dispatchEvent(new StorageEvent('storage', { key: THEME_STORAGE_KEY, newValue: 'dark' }));
    });

    expect(state()).toBe('dark/dark');
  });

  it('met à jour la couleur de la barre du navigateur mobile', () => {
    document.head.innerHTML = '<meta name="theme-color" content="#f3f4f6">';
    installMatchMedia(true);
    render(<ThemeProvider><Probe /></ThemeProvider>);

    expect(document.querySelector('meta[name="theme-color"]')?.getAttribute('content')).toBe('#0f1114');
    document.head.innerHTML = '';
  });
});

describe('script de index.html (thème posé avant le premier rendu)', () => {
  const source = readFileSync(join(import.meta.dirname, '../index.html'), 'utf8');
  const script = /<script>([\s\S]*?)<\/script>/.exec(source)?.[1] ?? '';

  const runScript = (systemDark: boolean, stored?: string) => {
    installMatchMedia(systemDark);
    window.localStorage.clear();
    if (stored) window.localStorage.setItem(THEME_STORAGE_KEY, stored);
    document.documentElement.removeAttribute('data-theme');
    new Function(script)();
    return html() as ResolvedTheme;
  };

  it('utilise la même clé de stockage que l’application', () => {
    expect(script).toContain(THEME_STORAGE_KEY);
  });

  it('applique la même règle que resolveTheme', () => {
    for (const systemDark of [true, false]) {
      for (const stored of [undefined, 'system', 'light', 'dark', 'n’importe quoi']) {
        const expected = resolveTheme(parseThemePreference(stored), systemDark);
        expect(runScript(systemDark, stored), `système sombre=${systemDark}, mémorisé=${stored}`).toBe(expected);
      }
    }
  });

  describe('<meta name="theme-color">', () => {
    const themeColor = () => document.querySelector('meta[name="theme-color"]')?.getAttribute('content');
    // La balise telle qu'elle est dans index.html, avant tout script.
    const meta = /<meta name="theme-color"[^>]*>/.exec(source)?.[0] ?? '';

    afterEach(() => {
      document.head.innerHTML = '';
    });

    it('suit le thème dès le premier rendu, comme ThemeProvider : la barre du navigateur mobile ne flashe pas', () => {
      for (const systemDark of [true, false]) {
        for (const stored of [undefined, 'system', 'light', 'dark', 'n’importe quoi']) {
          document.head.innerHTML = meta;
          const theme = runScript(systemDark, stored);
          expect(themeColor(), `système sombre=${systemDark}, mémorisé=${stored}`).toBe(THEME_COLOR[theme]);
        }
      }
    });

    it('n’échoue pas quand la page n’a pas cette balise', () => {
      document.head.innerHTML = '';

      expect(runScript(true)).toBe('dark');
    });
  });

  it('retombe sur le système quand le stockage est inaccessible', () => {
    installMatchMedia(true);
    vi.spyOn(window.localStorage, 'getItem').mockImplementation(() => {
      throw new DOMException('Accès refusé', 'SecurityError');
    });
    document.documentElement.removeAttribute('data-theme');

    new Function(script)();

    expect(html()).toBe('dark');
  });
});
