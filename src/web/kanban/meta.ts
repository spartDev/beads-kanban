import { Ban, Circle, CircleCheck, CircleDashed, Contrast, type LucideIcon } from 'lucide-react';
import { localDateFormat } from '../lib/localDay';
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

/** « 1 jour », « 14 jours » : un seul est au singulier. */
export const daysLabel = (days: number): string => `${days} ${days > 1 ? 'jours' : 'jour'}`;

/** « mardi 13 octobre », dans le fuseau du navigateur à l'instant écrit (voir `localDateFormat`). */
const weekdayAndDay = localDateFormat({ weekday: 'long', day: 'numeric', month: 'long' });

const noTicket = () => 'Aucun ticket';

export const COLUMN_META: Record<ColumnId, ColumnMeta> = {
  backlog: {
    id: 'backlog',
    label: 'Backlog',
    icon: CircleDashed,
    hint: () => 'Ouvert, en Blocage',
    rule: () => 'Ticket ouvert en Blocage : il dépend d’au moins un ticket qui n’est pas fermé.',
    empty: noTicket,
  },
  ready: {
    id: 'ready',
    label: 'Prêt',
    icon: Circle,
    hint: () => 'Ouvert, hors Blocage',
    rule: () => 'Ticket ouvert dont aucune dépendance n’est en suspens (le « ready » de beads).',
    empty: noTicket,
  },
  inProgress: {
    id: 'inProgress',
    label: 'En cours',
    icon: Contrast,
    hint: () => 'En cours, hors Blocage',
    rule: () => 'Ticket en cours ou rattaché à un agent, sans dépendance en suspens.',
    empty: noTicket,
  },
  blocked: {
    id: 'blocked',
    label: 'Bloqué',
    icon: Ban,
    hint: () => 'Blocage ou statut bloqué',
    rule: () =>
      'Ticket au statut bloqué, ou en cours (ou rattaché à un agent) mais en Blocage : il dépend d’un ticket qui n’est pas fermé.',
    empty: noTicket,
  },
  done: {
    id: 'done',
    label: 'Terminé',
    icon: CircleCheck,
    // Des jours calendaires, aujourd'hui compris (voir `doneSince`) : une seule journée se dit « aujourd'hui ».
    hint: (days) => (days === 1 ? 'Fermé aujourd’hui' : `Fermé ces ${days} derniers jours`),
    rule: (days, since) => {
      const window = days === 1 ? 'aujourd’hui' : `ces ${days} derniers jours, aujourd’hui compris`;
      const from = since === undefined ? '' : `, soit depuis le ${weekdayAndDay(since)} à minuit`;
      return `Ticket fermé ${window}${from} (jours calendaires, heure de votre navigateur).`;
    },
    empty: (days) => (days === 1 ? 'Aucun ticket fermé aujourd’hui' : `Aucun ticket fermé ces ${days} derniers jours`),
  },
};

/** Les colonnes dans l'ordre du flux. */
export const COLUMNS: readonly ColumnMeta[] = COLUMN_IDS.map((id) => COLUMN_META[id]);

/** « ticket » ou « tickets » : zéro est singulier en français. */
export const ticketNoun = (count: number): string => (count > 1 ? 'tickets' : 'ticket');

/** « 1 ticket », « 2 tickets ». */
export const countLabel = (count: number): string => `${count} ${ticketNoun(count)}`;

/** Tickets fermés avant la fenêtre de Terminé, dont la date de clôture est connue. */
export const closedEarlierLabel = (count: number): string =>
  `${count} ${count > 1 ? 'autres fermés' : 'autre fermé'} plus tôt`;

/** Tickets fermés sans date de clôture : on ne sait pas s'ils sont plus anciens que la fenêtre, on ne le prétend pas. */
export const closedUndatedLabel = (count: number): string =>
  `${count} ${count > 1 ? 'fermés' : 'fermé'} sans date de clôture`;

/**
 * L'état vide d'un tableau dont tous les tickets sont en pause : aucune colonne n'a de carte, et on dit pourquoi et où ils
 * sont. Accordé au nombre (un seul ticket, ou plusieurs).
 */
export function onlyPausedNotice(count: number): { title: string; detail: string } {
  return count > 1
    ? {
        title: `Les ${count} tickets du tableau sont tous en pause`,
        detail: 'Reportés, épinglés ou d’un statut inconnu, ils ne sont dans aucune colonne : ils attendent dans le tiroir « En pause ».',
      }
    : {
        title: 'Le seul ticket du tableau est en pause',
        detail: 'Reporté, épinglé ou d’un statut inconnu, il n’est dans aucune colonne : il attend dans le tiroir « En pause ».',
      };
}
