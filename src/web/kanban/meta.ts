import { Ban, Circle, CircleCheck, CircleDashed, Contrast, type LucideIcon } from 'lucide-react';
import { kanban } from '../i18n/catalog/kanban';
import type { Language } from '../i18n/language';
import { localDateFormat } from '../lib/localDay';
import { FORMATS } from '../metrics/format';
import { COLUMN_IDS, type ColumnId } from './columns';

export interface ColumnMeta {
  id: ColumnId;
  label: string;
  /** Pictogramme : la forme distingue les colonnes sans compter sur la couleur. */
  icon: LucideIcon;
  /** Une ligne sous le titre : ce qui range un ticket ici (le Backlog n'est pas celui qu'on croit). */
  hint: (doneDays: number) => string;
  /**
   * La règle en toutes lettres, en infobulle. `since` (ms epoch) est minuit du premier jour de la fenêtre de Terminé :
   * donné, la règle l'écrit en toutes lettres.
   */
  rule: (doneDays: number, since?: number) => string;
  /** Ce que la colonne dit quand elle n'a aucune carte. */
  empty: (doneDays: number) => string;
}

/** « 1 jour », « 14 jours » : un seul est au singulier (« 1 day », « 14 days »). */
export const daysLabel = (days: number, language: Language = 'fr'): string => kanban[language].board.days(days);

/** « mardi 13 octobre », dans le fuseau du navigateur à l'instant écrit (voir `localDateFormat`). */
const weekdayAndDay = localDateFormat({ weekday: 'long', day: 'numeric', month: 'long' });

/**
 * Le premier jour de la fenêtre de Terminé, écrit dans `language` : « mardi 13 octobre », « Tue, Oct 13 ». Le jour est celui du calendrier du
 * navigateur à l'instant écrit, comme `localDateFormat` le lit ; l'anglais passe par les formateurs de la langue (`formatDay`).
 */
function firstDay(since: number, language: Language): string {
  if (language === 'fr') return weekdayAndDay(since);
  const date = new Date(since);
  const day = `${String(date.getFullYear()).padStart(4, '0')}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`;
  return FORMATS[language].formatDay(day, { weekday: true });
}

const columnMetaIn = (language: Language): Record<ColumnId, ColumnMeta> => {
  const { columns } = kanban[language];
  const noTicket = () => columns.empty;
  const plain = (id: Exclude<ColumnId, 'done'>, icon: LucideIcon): ColumnMeta => ({
    id,
    label: columns[id].label,
    icon,
    hint: () => columns[id].hint,
    rule: () => columns[id].rule,
    empty: noTicket,
  });
  return {
    backlog: plain('backlog', CircleDashed),
    ready: plain('ready', Circle),
    inProgress: plain('inProgress', Contrast),
    blocked: plain('blocked', Ban),
    done: {
      id: 'done',
      label: columns.done.label,
      icon: CircleCheck,
      hint: (days) => columns.done.hint(days),
      rule: (days, since) => columns.done.rule(days, since === undefined ? undefined : firstDay(since, language)),
      empty: (days) => columns.done.empty(days),
    },
  };
};

const COLUMN_META_BY_LANGUAGE: Record<Language, Record<ColumnId, ColumnMeta>> = { fr: columnMetaIn('fr'), en: columnMetaIn('en') };

/** Les colonnes, nommées en français ; `columnMeta(language)` pour une autre langue. */
export const COLUMN_META: Record<ColumnId, ColumnMeta> = COLUMN_META_BY_LANGUAGE.fr;

/** Les colonnes nommées dans `language`, par identifiant. */
export const columnMeta = (language: Language = 'fr'): Record<ColumnId, ColumnMeta> => COLUMN_META_BY_LANGUAGE[language];

const COLUMNS_BY_LANGUAGE: Record<Language, readonly ColumnMeta[]> = {
  fr: COLUMN_IDS.map((id) => COLUMN_META_BY_LANGUAGE.fr[id]),
  en: COLUMN_IDS.map((id) => COLUMN_META_BY_LANGUAGE.en[id]),
};

/** Les colonnes dans l'ordre du flux, nommées en français ; `columnsIn(language)` pour une autre langue. */
export const COLUMNS: readonly ColumnMeta[] = COLUMNS_BY_LANGUAGE.fr;

/** Les colonnes dans l'ordre du flux, nommées dans `language`. */
export const columnsIn = (language: Language = 'fr'): readonly ColumnMeta[] => COLUMNS_BY_LANGUAGE[language];

/** Le nom du tiroir « En pause » (« Paused »). */
export const pausedLabel = (language: Language = 'fr'): string => kanban[language].columns.paused;

/** « ticket » ou « tickets » : zéro est singulier en français, pluriel en anglais. */
export const ticketNoun = (count: number, language: Language = 'fr'): string => kanban[language].board.ticketNoun(count);

/** « 1 ticket », « 2 tickets ». */
export const countLabel = (count: number, language: Language = 'fr'): string =>
  kanban[language].board.count(FORMATS[language].formatCount(count), count);

/** Tickets fermés avant la fenêtre de Terminé, dont la date de clôture est connue. */
export const closedEarlierLabel = (count: number, language: Language = 'fr'): string =>
  kanban[language].board.closedEarlier(FORMATS[language].formatCount(count), count);

/** Tickets fermés sans date de clôture : on ne sait pas s'ils sont plus anciens que la fenêtre, on ne le prétend pas. */
export const closedUndatedLabel = (count: number, language: Language = 'fr'): string =>
  kanban[language].board.closedUndated(FORMATS[language].formatCount(count), count);

/**
 * L'état vide d'un tableau dont tous les tickets sont en pause : aucune colonne n'a de carte, et on dit pourquoi et où ils
 * sont. Accordé au nombre (un seul ticket, ou plusieurs).
 */
export function onlyPausedNotice(count: number, language: Language = 'fr'): { title: string; detail: string } {
  const { onlyPaused } = kanban[language].board;
  return { title: onlyPaused.title(FORMATS[language].formatCount(count), count), detail: onlyPaused.detail(count) };
}
