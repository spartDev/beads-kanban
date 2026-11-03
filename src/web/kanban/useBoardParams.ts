import { useCallback } from 'react';
import { useSearchParams } from 'react-router';
import { DEFAULT_DONE_DAYS, type ColumnId } from './columns';
import { COLUMN_PARAM, DONE_PARAM, EPIC_PARAM, parseColumn, parseDoneDays } from './params';

/**
 * Les réglages du kanban qui vivent dans l'adresse (voir `params.ts`). Chaque changement remplace l'entrée de
 * l'historique au lieu d'en ajouter une : « Retour » quitte le kanban, il ne rejoue pas les filtres. Les autres
 * paramètres de l'adresse sont conservés.
 */
export function useBoardParams() {
  const [params, setParams] = useSearchParams();

  const set = useCallback(
    (name: string, value: string | null) => {
      if ((params.get(name) ?? null) === value) return;
      setParams(
        (current) => {
          const next = new URLSearchParams(current);
          if (value === null) next.delete(name);
          else next.set(name, value);
          return next;
        },
        { replace: true },
      );
    },
    [params, setParams],
  );

  return {
    /** Epic choisie ; ne dit pas qu'elle existe (voir la page). */
    epicId: params.get(EPIC_PARAM) || null,
    doneDays: parseDoneDays(params.get(DONE_PARAM)),
    /** Colonne choisie sur mobile ; null tant qu'on n'en a pas choisi. */
    column: parseColumn(params.get(COLUMN_PARAM)),
    setEpic: useCallback((epicId: string | null) => set(EPIC_PARAM, epicId), [set]),
    setDoneDays: useCallback((days: number) => set(DONE_PARAM, days === DEFAULT_DONE_DAYS ? null : String(days)), [set]),
    setColumn: useCallback((column: ColumnId) => set(COLUMN_PARAM, column), [set]),
  };
}
