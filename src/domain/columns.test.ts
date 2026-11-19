import { describe, expect, expectTypeOf, it } from 'vitest';
import type { DeclaredStatuses, MetricsCfdPoint } from '../shared/api';
import { baseColumnOf, type Column, COLUMNS, columnFor, columnsOf, HANDOFF_COLUMN, HANDOFF_COLUMNS } from './columns';
import { isWork } from './flow';
import { HANDOFF_STATUSES, NO_DECLARED_STATUSES } from './statuses';

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
      expect(columnFor(status, false, NO_DECLARED_STATUSES)).toBe(free);
    });

    it(`en Blocage : ${blocked}`, () => {
      expect(columnFor(status, true, NO_DECLARED_STATUSES)).toBe(blocked);
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
    expect(columnFor('blocked', false, NO_DECLARED_STATUSES)).toBe('blocked');
    expect(columnFor('blocked', true, NO_DECLARED_STATUSES)).toBe('blocked');
  });

  it('range un ticket qui n’existe pas encore (statut indéfini) hors des colonnes', () => {
    expect(columnFor(undefined, false, NO_DECLARED_STATUSES)).toBeNull();
    expect(columnFor(undefined, true, NO_DECLARED_STATUSES)).toBeNull();
  });

  it('ne laisse le Blocage compter ni pour Terminé ni pour « En pause »', () => {
    for (const status of ['closed', 'deferred', 'pinned', 'review']) {
      expect(columnFor(status, true, NO_DECLARED_STATUSES), status).toBe(columnFor(status, false, NO_DECLARED_STATUSES));
    }
  });

  it('range en En cours ou Bloqué exactement les statuts de travail : ceux du Cycle Time et du WIP', () => {
    for (const [status] of TABLE) {
      const column = columnFor(status, false, NO_DECLARED_STATUSES);
      expect(column === 'inProgress' || column === 'blocked', status).toBe(isWork(status, NO_DECLARED_STATUSES));
    }
  });
});

describe('columnFor avec les Statuts de relais et les statuts que le Projet déclare (bdesk-pz0.3, ADR 0007)', () => {
  /** Un Projet qui déclare d'autres statuts personnalisés, de chaque catégorie, mais aucun Statut de relais : ceux-ci se reconnaissent à leur nom. */
  const DECLARED: DeclaredStatuses = {
    handoff: [],
    others: [
      { name: 'qa_testing', category: 'wip' },
      { name: 'triage', category: 'active' },
      { name: 'shipped', category: 'done' },
      { name: 'on_hold', category: 'frozen' },
      { name: 'parked', category: null },
    ],
  };

  /**
   * LA table de la règle avec une déclaration : chaque statut, hors puis en Blocage. Les statuts de base n'y changent pas ; chaque Statut de relais a sa
   * colonne, Bloqué en Blocage ; un autre statut déclaré `wip` va en En cours, Bloqué en Blocage ; toute autre catégorie, ou un statut que le Projet ne
   * déclare pas, reste « En pause ».
   */
  const TABLE: readonly (readonly [status: string, free: Column | null, blocked: Column | null])[] = [
    ['open', 'ready', 'backlog'],
    ['in_progress', 'inProgress', 'blocked'],
    ['hooked', 'inProgress', 'blocked'],
    ['in_review', 'inReview', 'blocked'],
    ['in_integration', 'inIntegration', 'blocked'],
    ['awaiting_human', 'awaitingHuman', 'blocked'],
    ['blocked', 'blocked', 'blocked'],
    ['closed', 'done', 'done'],
    ['deferred', null, null],
    ['pinned', null, null],
    ['qa_testing', 'inProgress', 'blocked'],
    ['triage', null, null],
    ['shipped', null, null],
    ['on_hold', null, null],
    ['parked', null, null],
    ['review', null, null], // non déclaré
    ['', null, null],
  ];

  describe.each(TABLE)('statut « %s »', (status, free, blocked) => {
    it(`hors Blocage : ${free}`, () => {
      expect(columnFor(status, false, DECLARED)).toBe(free);
    });

    it(`en Blocage : ${blocked}`, () => {
      expect(columnFor(status, true, DECLARED)).toBe(blocked);
    });
  });

  it('range un Statut de relais par son nom, qu’il soit déclaré ou non, et sans déclaration du tout', () => {
    const declaredHandoff: DeclaredStatuses = { handoff: [...HANDOFF_STATUSES], others: [] };
    for (const status of HANDOFF_STATUSES) {
      for (const blocked of [false, true]) {
        const expected = blocked ? 'blocked' : HANDOFF_COLUMN[status];
        expect(columnFor(status, blocked, NO_DECLARED_STATUSES), status).toBe(expected);
        expect(columnFor(status, blocked, DECLARED), status).toBe(expected);
        expect(columnFor(status, blocked, declaredHandoff), status).toBe(expected);
      }
    }
  });

  it('ne range un statut déclaré wip en En cours qu’avec la déclaration : sans elle, il reste « En pause » comme avant', () => {
    expect(columnFor('qa_testing', false, NO_DECLARED_STATUSES)).toBeNull();
    expect(columnFor('qa_testing', true, NO_DECLARED_STATUSES)).toBeNull();
  });

  it('ne laisse pas une déclaration changer la colonne d’un statut de base, même écrite à la main', () => {
    const forged: DeclaredStatuses = { handoff: [], others: ['open', 'deferred', 'pinned', 'closed'].map((name) => ({ name, category: 'wip' })) };
    for (const [status, free, blocked] of TABLE.slice(0, 10)) {
      expect(columnFor(status, false, forged), status).toBe(free);
      expect(columnFor(status, true, forged), status).toBe(blocked);
    }
  });

  it('range dans En cours, une colonne de relais ou Bloqué exactement les statuts de travail, avec la même déclaration', () => {
    const work: readonly (Column | null)[] = ['inProgress', ...HANDOFF_COLUMNS, 'blocked'];
    for (const [status] of TABLE) {
      expect(work.includes(columnFor(status, false, DECLARED)), status).toBe(isWork(status, DECLARED));
      expect(work.includes(columnFor(status, true, DECLARED)), status).toBe(isWork(status, DECLARED));
    }
  });
});

describe('columnsOf : les colonnes d’un Projet', () => {
  it('sont les cinq de tout Projet, dans le même ordre, sans Statut de relais', () => {
    expect(columnsOf([])).toEqual([...COLUMNS]);
  });

  it('gagnent les colonnes de relais entre En cours et Bloqué, dans l’ordre En relecture, En intégration, À valider, quel que soit celui reçu', () => {
    expect(columnsOf(['awaiting_human', 'in_review', 'in_integration'])).toEqual([
      'backlog',
      'ready',
      'inProgress',
      'inReview',
      'inIntegration',
      'awaitingHuman',
      'blocked',
      'done',
    ]);
    expect(columnsOf(['awaiting_human'])).toEqual(['backlog', 'ready', 'inProgress', 'awaitingHuman', 'blocked', 'done']);
  });
});

describe('baseColumnOf : le repli provisoire des écrans sans colonnes de relais (bdesk-pz0.4)', () => {
  it('montre un ticket d’une colonne de relais en En cours, et tout autre dans sa colonne', () => {
    for (const column of HANDOFF_COLUMNS) expect(baseColumnOf(column)).toBe('inProgress');
    for (const column of COLUMNS) expect(baseColumnOf(column)).toBe(column);
  });
});
