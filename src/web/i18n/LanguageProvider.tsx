import {
  createContext,
  use,
  useCallback,
  useEffect,
  useMemo,
  useState,
  useSyncExternalStore,
  type ReactNode,
} from 'react';
import { CATALOGS, type Messages } from './catalog';
import { FORMATS_BY_LANGUAGE, type DisplayFormat } from './format';
import {
  applyLanguage,
  browserLanguages,
  detectLanguage,
  LANGUAGE_STORAGE_KEY,
  LANGUAGE_SWITCH_ENABLED,
  parseLanguagePreference,
  readLanguagePreference,
  resolveLanguage,
  writeLanguagePreference,
  type Language,
  type LanguagePreference,
} from './language';

interface LanguageContextValue {
  /** Choix de l'utilisateur : suivre le navigateur, ou forcer une langue. */
  preference: LanguagePreference;
  /** Langue effectivement affichée. */
  language: Language;
  setPreference: (preference: LanguagePreference) => void;
  /** Le sélecteur est proposé (faux tant que `LANGUAGE_SWITCH_ENABLED` l'est : l'interface reste en français). */
  switchEnabled: boolean;
  /** Les textes de la langue affichée. */
  t: Messages;
  /** Les formateurs de la langue affichée. */
  format: DisplayFormat;
}

/**
 * Hors de `<LanguageProvider>` (un composant rendu seul dans un test), l'interface est en français et le sélecteur absent :
 * les hooks ne lèvent pas, contrairement à `useTheme`.
 */
const FRENCH: LanguageContextValue = {
  preference: 'system',
  language: 'fr',
  setPreference: () => undefined,
  switchEnabled: false,
  t: CATALOGS.fr,
  format: FORMATS_BY_LANGUAGE.fr,
};

const LanguageContext = createContext<LanguageContextValue>(FRENCH);

function subscribeBrowserLanguages(onChange: () => void): () => void {
  window.addEventListener('languagechange', onChange);
  return () => window.removeEventListener('languagechange', onChange);
}

const detectBrowserLanguage = (): Language => detectLanguage(browserLanguages());

/**
 * La langue de l'interface : la préférence mémorisée (`lib/storage`), sinon la première langue du navigateur que l'interface connaît,
 * l'anglais à défaut ; suivie en direct (`languagechange`, autre onglet). Pose `<html lang>`.
 * `switchEnabled` ne sert qu'aux tests : l'application prend `LANGUAGE_SWITCH_ENABLED`.
 */
export function LanguageProvider({
  children,
  switchEnabled = LANGUAGE_SWITCH_ENABLED,
}: {
  children: ReactNode;
  switchEnabled?: boolean;
}) {
  const [preference, setPreferenceState] = useState<LanguagePreference>(readLanguagePreference);
  const detected = useSyncExternalStore(subscribeBrowserLanguages, detectBrowserLanguage, () => 'fr' as const);
  const language = resolveLanguage(preference, detected, switchEnabled);

  useEffect(() => {
    applyLanguage(language);
  }, [language]);

  // Un autre onglet change la langue : on la suit.
  useEffect(() => {
    const onStorage = (event: StorageEvent) => {
      if (event.key === LANGUAGE_STORAGE_KEY) {
        setPreferenceState(parseLanguagePreference(event.newValue));
      }
    };
    window.addEventListener('storage', onStorage);
    return () => window.removeEventListener('storage', onStorage);
  }, []);

  const setPreference = useCallback((next: LanguagePreference) => {
    setPreferenceState(next);
    writeLanguagePreference(next);
  }, []);

  const value = useMemo(
    () => ({ preference, language, setPreference, switchEnabled, t: CATALOGS[language], format: FORMATS_BY_LANGUAGE[language] }),
    [preference, language, setPreference, switchEnabled],
  );

  return <LanguageContext value={value}>{children}</LanguageContext>;
}

/** La langue, la préférence et le sélecteur : pour le sélecteur et ce qui dépend de la langue sans passer par le catalogue. */
export function useLanguage(): LanguageContextValue {
  return use(LanguageContext);
}

/** Les textes de la langue affichée : `const t = useT();` puis `t.<zone>.<groupe>.<clé>` (voir `catalog/index.ts`). */
export function useT(): Messages {
  return use(LanguageContext).t;
}

/** Les formateurs de nombres, durées et dates de la langue affichée (`metrics/format.ts`, `lib/relativeTime.ts`). */
export function useFormat(): DisplayFormat {
  return use(LanguageContext).format;
}
