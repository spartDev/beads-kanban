import { describe, expect, expectTypeOf, it } from 'vitest';
import type { MetricsCfdPoint } from '../shared/api';
import { type Column, COLUMNS, columnFor } from './columns';
import { isWork } from './flow';

describe('les colonnes', () => {
  it('sont celles du contrat du CFD, dans l’ordre du flux : une seule définition pour le tableau et le graphique', () => {
    // Vérifié à la compilation (pnpm typecheck) : renommer ou ajouter une colonne d'un seul côté échoue ici.
    expectTypeOf<Column>().toEqualTypeOf<Exclude<keyof MetricsCfdPoint, 'date'>>();
    expect([...COLUMNS]).toEqual(['backlog', 'ready', 'inProgress', 'blocked', 'done']);
  });
});

describe('columnFor : la colonne d’un ticket selon son statut et son Blocage', () => {
  /**
   * LA table de vérité de la règle, la seule, écrite à la main : chaque statut beads, hors puis en Blocage. `null` : « En
   * pause », hors des colonnes. C'est la règle du CFD (à chaque instant de l'historique) comme du tableau (à l'état
   * présent). `timeline.test.ts` et `src/web/kanban/columns.test.ts` ne la recopient pas : chacun prouve seulement que son
   * côté s'en sert, et le second croise les deux côtés. Un statut ajouté à `columnFor` s'ajoute ici.
   */
  const TABLE: readonly (readonly [status: string, free: Column | null, blocked: Column | null])[] = [
    ['open', 'ready', 'backlog'],
    ['in_progress', 'inProgress', 'blocked'],
    ['hooked', 'inProgress', 'blocked'],
    ['blocked', 'blocked', 'blocked'],
    ['closed', 'done', 'done'],
    ['deferred', null, null],
    ['pinned', null, null],
    // Statut personnalisé de beads, et statut vide (NULL en base) : « En pause » plutôt que perdus.
    ['review', null, null],
    ['', null, null],
  ];

  describe.each(TABLE)('statut « %s »', (status, free, blocked) => {
    it(`hors Blocage : ${free}`, () => {
      expect(columnFor(status, false)).toBe(free);
    });

    it(`en Blocage : ${blocked}`, () => {
      expect(columnFor(status, true)).toBe(blocked);
    });
  });

  it('couvre tous les statuts de beads', () => {
    const covered = TABLE.map(([status]) => status);
    for (const status of ['open', 'in_progress', 'blocked', 'deferred', 'closed', 'pinned', 'hooked']) {
      expect(covered, status).toContain(status);
    }
  });

  it('lit le statut bloqué dans le statut, sans exiger que l’appelant l’ajoute au Blocage', () => {
    // Le CFD compte le statut bloqué dans le Blocage, le tableau ne passe que les dépendances (`blockedBy`) : même colonne.
    expect(columnFor('blocked', false)).toBe('blocked');
    expect(columnFor('blocked', true)).toBe('blocked');
  });

  it('range un ticket qui n’existe pas encore (statut indéfini) hors des colonnes', () => {
    expect(columnFor(undefined, false)).toBeNull();
    expect(columnFor(undefined, true)).toBeNull();
  });

  it('ne laisse le Blocage compter ni pour Terminé ni pour « En pause »', () => {
    for (const status of ['closed', 'deferred', 'pinned', 'review']) {
      expect(columnFor(status, true), status).toBe(columnFor(status, false));
    }
  });

  it('range en En cours ou Bloqué exactement les statuts de travail : ceux du Cycle Time et du WIP', () => {
    for (const [status] of TABLE) {
      const column = columnFor(status, false);
      expect(column === 'inProgress' || column === 'blocked', status).toBe(isWork(status));
    }
  });
});
