import type { Zone } from './zone';

/**
 * Zone « shell » (bdesk-ewr.2) : `shell/`, `palette/`, `shortcuts/`, `live/`, `ui/`, `data/`, `lib/` (dont `signals.ts`), `theme/`, titres d'onglet, et les pages
 * qui n'appartiennent à aucune autre zone (Vue globale, À regarder, page introuvable, erreur de route). Le sélecteur de langue
 * (`LanguageToggle`, entrées de la palette) y a ses textes.
 */
const fr = {
  language: {
    /** Nom du groupe de boutons du sélecteur. */
    group: 'Langue',
    /** La position « suivre le navigateur ». Les autres portent le nom de la langue écrit dans cette langue (`LANGUAGE_NAMES`). */
    system: 'Langue du navigateur',
    /** Mots qui trouvent les entrées de langue dans la palette, en plus de leur libellé. */
    keywords: ['langue', 'language', 'traduction', 'français', 'anglais', 'english', 'french'],
  },
};

const en: typeof fr = {
  language: {
    group: 'Language',
    system: 'Browser language',
    keywords: ['language', 'langue', 'translation', 'english', 'french', 'français'],
  },
};

export const shell: Zone<typeof fr> = { fr, en };
