import { act, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { setBrowserLanguages } from '../test/languages';
import { CATALOGS } from './catalog';
import {
  browserLanguages,
  detectLanguage,
  LANGUAGE_STORAGE_KEY,
  LANGUAGE_SWITCH_ENABLED,
  parseLanguagePreference,
  readLanguagePreference,
  resolveLanguage,
  writeLanguagePreference,
} from './language';
import { LanguageProvider, useFormat, useLanguage, useT } from './LanguageProvider';

function Probe() {
  const { preference, language, setPreference } = useLanguage();
  const t = useT();
  const format = useFormat();
  return (
    <div>
      <output aria-label="état">{`${preference}/${language}`}</output>
      <output aria-label="texte">{t.shell.language.system}</output>
      <output aria-label="nombre">{format.formatDecimal(3.5)}</output>
      <button onClick={() => setPreference('fr')}>fr</button>
      <button onClick={() => setPreference('en')}>en</button>
      <button onClick={() => setPreference('system')}>système</button>
    </div>
  );
}

const state = () => screen.getByLabelText('état').textContent;
const htmlLang = () => document.documentElement.lang;

afterEach(() => {
  vi.restoreAllMocks();
});

describe('règle de la langue', () => {
  it('ne connaît que le français, l’anglais et « navigateur »', () => {
    expect(parseLanguagePreference('fr')).toBe('fr');
    expect(parseLanguagePreference('en')).toBe('en');
    expect(parseLanguagePreference('system')).toBe('system');
    expect(parseLanguagePreference('de')).toBe('system');
    expect(parseLanguagePreference('FR')).toBe('system');
    expect(parseLanguagePreference(null)).toBe('system');
  });

  it('prend la première langue du navigateur connue, d’après sa sous-étiquette principale', () => {
    expect(detectLanguage(['fr-FR', 'en-US'])).toBe('fr');
    expect(detectLanguage(['en-GB', 'fr'])).toBe('en');
    expect(detectLanguage(['de-DE', 'fr-CA', 'en'])).toBe('fr');
    expect(detectLanguage(['FR-be'])).toBe('fr');
  });

  it('retombe sur l’anglais quand le navigateur ne donne aucune langue connue', () => {
    expect(detectLanguage(['de-DE', 'es'])).toBe('en');
    expect(detectLanguage([])).toBe('en');
    expect(detectLanguage([undefined, null, ''])).toBe('en');
    // « french » n'est pas une étiquette de langue, seulement une sous-étiquette qui y ressemble.
    expect(detectLanguage(['french', 'english'])).toBe('en');
  });

  it('lit navigator.language quand navigator.languages est vide', () => {
    expect(browserLanguages({ languages: [], language: 'fr-FR' })).toEqual(['fr-FR']);
    expect(browserLanguages({ languages: ['en-US', 'fr'], language: 'en-US' })).toEqual(['en-US', 'fr']);
  });

  it('force le choix mémorisé, suit le navigateur sinon, et reste en français tant que le sélecteur est désactivé', () => {
    expect(resolveLanguage('system', 'en', true)).toBe('en');
    expect(resolveLanguage('fr', 'en', true)).toBe('fr');
    expect(resolveLanguage('en', 'fr', true)).toBe('en');
    for (const preference of ['system', 'fr', 'en'] as const) {
      expect(resolveLanguage(preference, 'en', false)).toBe('fr');
    }
  });

  it('survit à un stockage indisponible', () => {
    vi.spyOn(window.localStorage, 'getItem').mockImplementation(() => {
      throw new DOMException('Accès refusé', 'SecurityError');
    });
    vi.spyOn(window.localStorage, 'setItem').mockImplementation(() => {
      throw new DOMException('Quota dépassé', 'QuotaExceededError');
    });

    expect(readLanguagePreference()).toBe('system');
    expect(() => writeLanguagePreference('en')).not.toThrow();
  });

  it('le drapeau est encore baissé : l’activation est la tâche bdesk-ewr.7', () => {
    expect(LANGUAGE_SWITCH_ENABLED).toBe(false);
  });
});

describe('LanguageProvider, sélecteur désactivé (l’application aujourd’hui)', () => {
  it('affiche le français même pour un navigateur anglais et un choix « English » mémorisé', () => {
    setBrowserLanguages(['en-US']);
    window.localStorage.setItem(LANGUAGE_STORAGE_KEY, 'en');
    render(<LanguageProvider><Probe /></LanguageProvider>);

    expect(state()).toBe('en/fr');
    expect(screen.getByLabelText('texte').textContent).toBe('Langue du navigateur');
    expect(htmlLang()).toBe('fr');
  });

  it('hors de tout fournisseur, les hooks rendent le français sans lever', () => {
    render(<Probe />);

    expect(state()).toBe('system/fr');
    expect(screen.getByLabelText('texte').textContent).toBe('Langue du navigateur');
    expect(screen.getByLabelText('nombre').textContent).toBe('3,5');
  });
});

describe('LanguageProvider, sélecteur activé', () => {
  const renderEnabled = () => render(<LanguageProvider switchEnabled><Probe /></LanguageProvider>);

  it('suit la langue du navigateur par défaut, et pose <html lang>', () => {
    setBrowserLanguages(['en-US', 'fr']);
    renderEnabled();

    expect(state()).toBe('system/en');
    expect(htmlLang()).toBe('en');
    expect(screen.getByLabelText('texte').textContent).toBe('Browser language');
    expect(screen.getByLabelText('nombre').textContent).toBe('3.5');
  });

  it('prend l’anglais pour un navigateur dans une langue inconnue', () => {
    setBrowserLanguages(['de-DE']);
    renderEnabled();

    expect(state()).toBe('system/en');
  });

  it('suit en direct un changement des langues du navigateur', () => {
    setBrowserLanguages(['fr-FR']);
    renderEnabled();
    expect(htmlLang()).toBe('fr');

    act(() => setBrowserLanguages(['en-US'], { notify: true }));

    expect(state()).toBe('system/en');
    expect(htmlLang()).toBe('en');
  });

  it('bascule sans recharger, mémorise le choix et le retrouve au rechargement', async () => {
    const user = userEvent.setup();
    setBrowserLanguages(['fr-FR']);
    const first = renderEnabled();

    await user.click(screen.getByRole('button', { name: 'en' }));
    expect(state()).toBe('en/en');
    expect(htmlLang()).toBe('en');
    expect(window.localStorage.getItem(LANGUAGE_STORAGE_KEY)).toBe('en');

    first.unmount();
    document.documentElement.lang = 'fr';
    renderEnabled();

    // Le navigateur est en français : seul le choix mémorisé peut produire l'anglais.
    expect(state()).toBe('en/en');
    expect(htmlLang()).toBe('en');
  });

  it('ignore le navigateur une fois une langue forcée, et le suit de nouveau quand on le redemande', async () => {
    const user = userEvent.setup();
    setBrowserLanguages(['en-US']);
    renderEnabled();

    await user.click(screen.getByRole('button', { name: 'fr' }));
    act(() => setBrowserLanguages(['en-GB'], { notify: true }));
    expect(state()).toBe('fr/fr');

    await user.click(screen.getByRole('button', { name: 'système' }));
    expect(state()).toBe('system/en');
    expect(window.localStorage.getItem(LANGUAGE_STORAGE_KEY)).toBe('system');
  });

  it('suit un changement fait dans un autre onglet', () => {
    setBrowserLanguages(['fr-FR']);
    renderEnabled();

    act(() => {
      window.dispatchEvent(new StorageEvent('storage', { key: LANGUAGE_STORAGE_KEY, newValue: 'en' }));
    });

    expect(state()).toBe('en/en');

    // Le thème changé dans l'autre onglet, ou son stockage vidé (clé nulle), ne touche pas à la langue.
    act(() => {
      window.dispatchEvent(new StorageEvent('storage', { key: 'throughline:theme', newValue: 'dark' }));
      window.dispatchEvent(new StorageEvent('storage', { key: null, newValue: null }));
    });
    expect(state()).toBe('en/en');
  });
});

describe('catalogue', () => {
  /** Les chemins des clés d'un objet du catalogue, triés, et la nature de chaque feuille (le nombre de paramètres d'une fonction). */
  const shape = (value: unknown, path = ''): string[] => {
    if (typeof value === 'object' && value !== null && !Array.isArray(value)) {
      return Object.entries(value)
        .flatMap(([key, child]) => shape(child, `${path}.${key}`))
        .sort();
    }
    const kind = Array.isArray(value) ? 'array' : typeof value === 'function' ? `function/${value.length}` : typeof value;
    return [`${path}:${kind}`];
  };

  it('a les mêmes clés, de même nature, en français et en anglais', () => {
    expect(shape(CATALOGS.en)).toEqual(shape(CATALOGS.fr));
  });

  it('voit une clé en trop, une clé manquante et un paramètre oublié', () => {
    expect(shape({ a: { b: 'x' } })).not.toEqual(shape({ a: { b: 'x', c: 'y' } }));
    expect(shape({ a: (n: number) => String(n) })).not.toEqual(shape({ a: () => '' }));
    expect(shape({ a: 'x', b: 'y' })).toEqual(shape({ b: 'y', a: 'x' }));
  });
});

describe('useFormat', () => {
  function Dates() {
    const format = useFormat();
    const now = Date.parse('2026-10-23T12:00:00Z');
    return (
      <output aria-label="dates">
        {[
          format.formatAge('2026-10-23T09:00:00Z', now),
          format.formatDateTime('2026-10-05T12:00:00Z'),
          format.formatInstant('2026-10-05T12:00:00Z'),
          format.formatPercent(0.19),
        ].join(' | ')}
      </output>
    );
  }

  it('rend les formateurs liés à la langue affichée, âges et instants compris', () => {
    setBrowserLanguages(['en-US']);
    render(<LanguageProvider switchEnabled><Dates /></LanguageProvider>);

    // jsdom suit le fuseau du processus : on ne vérifie que la forme de l'heure.
    expect(screen.getByLabelText('dates').textContent).toMatch(/^3 hr ago \| October [56], 2026 at \d{2}:\d{2} \| Oct [56], 2026, \d{2}:\d{2} \| 19%$/);
  });
});
