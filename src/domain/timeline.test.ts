import { describe, expect, it } from 'vitest';
import type { Column } from './columns';
import { analyzeFlow, type DependencyHistory, isWork, type TicketHistory } from './flow';
import { buildTimeline, columnAt, isWorking, stepsOf, type TicketTimeline } from './timeline';

const at = (iso: string) => new Date(`${iso}Z`);
const ms = (iso: string) => at(iso).getTime();
const HOUR = 3_600_000;

function ticket(id: string, statuses: [string, string][], extra: Partial<TicketHistory> = {}): TicketHistory {
  return {
    id,
    type: 'task',
    statusSnapshots: statuses.map(([status, iso]) => ({ status, at: at(iso) })),
    dependencies: [],
    ...extra,
  };
}

const blocks = (target: string, added: string, removed?: string): DependencyHistory => ({
  type: 'blocks',
  target,
  addedAt: at(added),
  ...(removed ? { removedAt: at(removed) } : {}),
});

/** Les chronologies de tous les tickets, comme `analyzeProject` les construit ; la fonction rend celle d'un ticket. */
function timelines(tickets: TicketHistory[]): (id: string) => TicketTimeline {
  const flows = analyzeFlow(tickets);
  const steps = new Map([...flows].map(([id, flow]) => [id, stepsOf(flow.transitions)]));
  const built = new Map(tickets.map((t) => [t.id, buildTimeline(t, steps.get(t.id) ?? [], steps)]));
  return (id) => {
    const timeline = built.get(id);
    if (!timeline) throw new Error(`ticket inconnu : ${id}`);
    return timeline;
  };
}

/** Les colonnes successives d'un ticket : [instant, colonne]. */
const columns = (timeline: TicketTimeline) => timeline.segments.map((s) => [new Date(s.from).toISOString().slice(0, 16), s.column]);

describe('chronologie des colonnes', () => {
  it('met un ticket ouvert en Backlog tant qu’il dépend d’un ticket non fermé, puis en Prêt', () => {
    const t = timelines([
      ticket('b', [
        ['open', '2026-10-01T09:00'],
        ['closed', '2026-10-03T09:00'],
      ]),
      ticket('a', [['open', '2026-10-01T09:00']], { dependencies: [blocks('b', '2026-10-01T09:00')] }),
    ]);

    expect(columns(t('a'))).toEqual([
      ['2026-10-01T09:00', 'backlog'],
      ['2026-10-03T09:00', 'ready'],
    ]);
  });

  it('met en cours un ticket de travail hors Blocage, en Bloqué dès qu’une dépendance non fermée apparaît, et en Terminé à la clôture', () => {
    const t = timelines([
      ticket('c', [
        ['open', '2026-10-01T09:00'],
        ['closed', '2026-10-06T09:00'],
      ]),
      ticket(
        'a',
        [
          ['open', '2026-10-01T09:00'],
          ['in_progress', '2026-10-02T09:00'],
          ['closed', '2026-10-08T09:00'],
        ],
        { dependencies: [blocks('c', '2026-10-04T09:00')] },
      ),
    ]);

    expect(columns(t('a'))).toEqual([
      ['2026-10-01T09:00', 'ready'],
      ['2026-10-02T09:00', 'inProgress'],
      ['2026-10-04T09:00', 'blocked'],
      ['2026-10-06T09:00', 'inProgress'],
      ['2026-10-08T09:00', 'done'],
    ]);
  });

  it('traite hooked comme un statut de travail', () => {
    const t = timelines([ticket('a', [['open', '2026-10-01T09:00'], ['hooked', '2026-10-02T09:00']])]);

    expect(columns(t('a')).at(-1)).toEqual(['2026-10-02T09:00', 'inProgress']);
  });

  it('met en Bloqué le statut bloqué, même sans dépendance', () => {
    const t = timelines([
      ticket('a', [
        ['open', '2026-10-01T09:00'],
        ['in_progress', '2026-10-02T09:00'],
        ['blocked', '2026-10-03T09:00'],
        ['in_progress', '2026-10-04T09:00'],
      ]),
    ]);

    expect(columns(t('a'))).toEqual([
      ['2026-10-01T09:00', 'ready'],
      ['2026-10-02T09:00', 'inProgress'],
      ['2026-10-03T09:00', 'blocked'],
      ['2026-10-04T09:00', 'inProgress'],
    ]);
  });

  it('laisse « En pause » (différé, épinglé, statut inconnu) hors des colonnes', () => {
    const t = timelines([
      ticket('a', [
        ['open', '2026-10-01T09:00'],
        ['deferred', '2026-10-02T09:00'],
        ['open', '2026-10-03T09:00'],
        ['pinned', '2026-10-04T09:00'],
        ['mon_statut', '2026-10-05T09:00'],
      ]),
    ]);

    expect(columns(t('a'))).toEqual([
      ['2026-10-01T09:00', 'ready'],
      ['2026-10-02T09:00', null],
      ['2026-10-03T09:00', 'ready'],
      ['2026-10-04T09:00', null],
    ]);
  });

  it('lève le Blocage quand la dépendance est retirée, et le rétablit quand la cible est rouverte', () => {
    const t = timelines([
      ticket('b', [
        ['open', '2026-10-01T09:00'],
        ['closed', '2026-10-02T09:00'],
        ['open', '2026-10-04T09:00'],
      ]),
      ticket('a', [['open', '2026-10-01T09:00']], { dependencies: [blocks('b', '2026-10-01T09:00', '2026-10-06T09:00')] }),
    ]);

    expect(columns(t('a'))).toEqual([
      ['2026-10-01T09:00', 'backlog'],
      ['2026-10-02T09:00', 'ready'],
      ['2026-10-04T09:00', 'backlog'],
      ['2026-10-06T09:00', 'ready'],
    ]);
  });

  it('ignore une dépendance vers un ticket hors Projet, et un lien qui n’est pas une dépendance bloquante', () => {
    const t = timelines([
      ticket('b', [['open', '2026-10-01T09:00']]),
      ticket('a', [['open', '2026-10-01T09:00']], {
        dependencies: [blocks('ailleurs', '2026-10-01T09:00'), { type: 'relates-to', target: 'b', addedAt: at('2026-10-01T09:00') }],
      }),
    ]);

    expect(columns(t('a'))).toEqual([['2026-10-01T09:00', 'ready']]);
  });

  it('range un ticket fermé en Terminé quel que soit son Blocage', () => {
    const t = timelines([
      ticket('b', [['open', '2026-10-01T09:00']]),
      ticket(
        'a',
        [
          ['open', '2026-10-01T09:00'],
          ['closed', '2026-10-02T09:00'],
        ],
        { dependencies: [blocks('b', '2026-10-01T09:00')] },
      ),
    ]);

    expect(columns(t('a'))).toEqual([
      ['2026-10-01T09:00', 'backlog'],
      ['2026-10-02T09:00', 'done'],
    ]);
  });

  it('ne laisse jamais le temps reculer quand l’horloge d’un commit a reculé', () => {
    const t = timelines([
      ticket('a', [
        ['open', '2026-10-05T09:00'],
        ['in_progress', '2026-10-03T09:00'], // l'horloge est revenue en arrière
        ['closed', '2026-10-06T09:00'],
      ]),
    ]);

    expect(columns(t('a'))).toEqual([
      ['2026-10-05T09:00', 'inProgress'], // les deux changements ont lieu au même instant : le dernier gagne
      ['2026-10-06T09:00', 'done'],
    ]);
  });

  describe('lecture à un instant', () => {
    const t = timelines([
      ticket('a', [
        ['open', '2026-10-01T09:00'],
        ['in_progress', '2026-10-02T09:00'],
        ['closed', '2026-10-03T09:00'],
      ]),
    ]);
    const a = t('a');

    it('donne la colonne en vigueur : celle du dernier changement à cet instant ou avant', () => {
      expect(columnAt(a, ms('2026-10-01T08:59'))).toBeNull(); // avant la création
      expect(columnAt(a, ms('2026-10-01T09:00'))).toBe<Column>('ready');
      expect(columnAt(a, ms('2026-10-02T08:59'))).toBe<Column>('ready');
      expect(columnAt(a, ms('2026-10-02T09:00'))).toBe<Column>('inProgress');
      expect(columnAt(a, ms('2026-12-01T00:00'))).toBe<Column>('done');
    });

    it('dit si le ticket est en statut de travail', () => {
      expect(isWorking(a, ms('2026-10-01T12:00'))).toBe(false);
      expect(isWorking(a, ms('2026-10-02T12:00'))).toBe(true);
      expect(isWorking(a, ms('2026-10-03T09:00'))).toBe(false); // fermé à cet instant
    });
  });

  describe('cohérence avec analyzeFlow', () => {
    // Pour chaque ticket fermé : le temps en Bloqué est son temps bloqué (Blocage ∩ travail), le temps en Backlog avant
    // son premier démarrage est son Attente de dépendance. Même Blocage, calculé par deux chemins.
    const scenarios: Record<string, TicketHistory[]> = {
      'Blocage pendant le travail': [
        ticket('b', [['open', '2026-10-01T09:00'], ['closed', '2026-10-02T15:00']]),
        ticket(
          't',
          [['open', '2026-10-01T09:00'], ['in_progress', '2026-10-02T09:00'], ['closed', '2026-10-03T09:00']],
          { dependencies: [blocks('b', '2026-10-02T12:00')] },
        ),
      ],
      'attente avant le démarrage': [
        ticket('b', [['open', '2026-10-01T09:00'], ['closed', '2026-10-03T09:00']]),
        ticket(
          't',
          [['open', '2026-10-01T09:00'], ['in_progress', '2026-10-04T09:00'], ['closed', '2026-10-05T09:00']],
          { dependencies: [blocks('b', '2026-10-01T09:00')] },
        ),
      ],
      'cible rouverte': [
        ticket('b', [
          ['open', '2026-10-01T09:00'],
          ['closed', '2026-10-02T09:00'],
          ['open', '2026-10-04T09:00'],
          ['closed', '2026-10-04T15:00'],
        ]),
        ticket(
          't',
          [['open', '2026-10-01T09:00'], ['in_progress', '2026-10-03T09:00'], ['closed', '2026-10-05T09:00']],
          { dependencies: [blocks('b', '2026-10-01T09:00')] },
        ),
      ],
      'dépendance retirée': [
        ticket('b', [['open', '2026-10-01T09:00']]),
        ticket(
          't',
          [['open', '2026-10-01T09:00'], ['in_progress', '2026-10-02T09:00'], ['closed', '2026-10-03T09:00']],
          { dependencies: [blocks('b', '2026-10-01T09:00', '2026-10-01T21:00')] },
        ),
      ],
      'statut bloqué': [
        ticket('t', [
          ['open', '2026-10-01T09:00'],
          ['in_progress', '2026-10-01T10:00'],
          ['blocked', '2026-10-01T12:00'],
          ['in_progress', '2026-10-01T16:00'],
          ['closed', '2026-10-01T18:00'],
        ]),
      ],
      'ticket jamais démarré': [
        ticket('b', [['open', '2026-10-01T09:00'], ['closed', '2026-10-02T09:00']]),
        ticket('t', [['open', '2026-10-01T09:00'], ['closed', '2026-10-03T09:00']], { dependencies: [blocks('b', '2026-10-01T12:00')] }),
      ],
      'deux dépendances qui se recouvrent': [
        ticket('b1', [['open', '2026-10-01T09:00'], ['closed', '2026-10-02T09:00']]),
        ticket('b2', [['open', '2026-10-01T09:00'], ['closed', '2026-10-04T09:00']]),
        ticket(
          't',
          [['open', '2026-10-01T09:00'], ['in_progress', '2026-10-03T09:00'], ['closed', '2026-10-05T09:00']],
          { dependencies: [blocks('b1', '2026-10-01T09:00'), blocks('b2', '2026-10-01T15:00')] },
        ),
      ],
      // L'horloge d'un commit recule : les deux chemins doivent dater les Transitions de la même façon.
      'horloge qui recule pendant le travail': [
        ticket('t', [
          ['open', '2026-10-01T09:00'],
          ['in_progress', '2026-10-01T12:00'],
          ['blocked', '2026-10-01T10:00'], // bloqué à 12:00, au plus tôt : la Transition précédente
          ['in_progress', '2026-10-01T15:00'],
          ['closed', '2026-10-01T18:00'],
        ]),
      ],
      'horloge qui recule avant le démarrage, avec une dépendance': [
        ticket('b', [['open', '2026-10-01T09:00'], ['closed', '2026-10-01T14:00']]),
        ticket(
          't',
          [['open', '2026-10-01T10:00'], ['in_progress', '2026-10-01T13:00'], ['closed', '2026-10-01T11:00']],
          { dependencies: [blocks('b', '2026-10-01T10:00', '2026-10-01T13:00')] },
        ),
      ],
    };

    it.each(Object.entries(scenarios))('%s', (_, tickets) => {
      const flows = analyzeFlow(tickets);
      const timeline = timelines(tickets);
      for (const t of tickets) {
        const flow = flows.get(t.id);
        if (!flow || flow.outcome.kind !== 'delivered') continue;
        const { segments } = timeline(t.id);
        const close = flow.transitions.at(-1)?.at.getTime() ?? 0;
        const firstStart = flow.transitions.find((tr) => isWork(tr.status))?.at.getTime() ?? close;
        const spent = (column: Column, until: number) =>
          segments.reduce((total, s, i) => {
            if (s.column !== column) return total;
            const end = Math.min(segments[i + 1]?.from ?? Number.POSITIVE_INFINITY, until);
            return total + Math.max(0, end - s.from);
          }, 0);

        expect(spent('blocked', close), `${t.id} : temps bloqué`).toBe(flow.blockedTime);
        expect(spent('backlog', firstStart), `${t.id} : Attente de dépendance`).toBe(flow.dependencyWait);
      }
    });

    it('mesure bien quelque chose : le scénario du Blocage pendant le travail donne 3 h bloquées', () => {
      const [first] = Object.values(scenarios);
      expect(analyzeFlow(first ?? []).get('t')?.blockedTime).toBe(3 * HOUR);
    });
  });
});

describe('le CFD range les tickets avec la règle partagée (columnFor)', () => {
  // La table de vérité statut × Blocage est dans `columns.test.ts`, une seule fois. Ici, seulement ce que le CFD lui passe : le
  // statut d'alors, le Blocage d'alors (les dépendances `blocks` actives vers une cible non fermée), et « hors des colonnes »
  // pour ce qu'elle range en pause. Le croisement avec le tableau est dans `src/web/kanban/columns.test.ts`.

  it('lui passe son Blocage : un ticket hooked est Bloqué tant que la dépendance tient, puis retrouve En cours sans changer de statut', () => {
    const t = timelines([
      ticket('b', [
        ['open', '2026-10-01T09:00'],
        ['closed', '2026-10-05T09:00'],
      ]),
      ticket(
        'a',
        [
          ['open', '2026-10-01T09:00'],
          ['hooked', '2026-10-02T09:00'],
        ],
        { dependencies: [blocks('b', '2026-10-01T09:00')] },
      ),
    ]);

    expect(columns(t('a'))).toEqual([
      ['2026-10-01T09:00', 'backlog'],
      ['2026-10-02T09:00', 'blocked'],
      ['2026-10-05T09:00', 'inProgress'],
    ]);
  });

  it('laisse hors des colonnes un ticket différé ou d’un statut inconnu, même en Blocage', () => {
    /** Ouvert et en Blocage dès sa création (il dépend de `b`, resté ouvert), puis passé à `status` le lendemain. */
    const pausedAfter = (id: string, status: string) =>
      ticket(id, [['open', '2026-10-01T09:00'], [status, '2026-10-02T09:00']], { dependencies: [blocks('b', '2026-10-01T09:00')] });
    const t = timelines([ticket('b', [['open', '2026-10-01T09:00']]), pausedAfter('differe', 'deferred'), pausedAfter('inconnu', 'mon_statut')]);

    for (const id of ['differe', 'inconnu']) {
      expect(columns(t(id)), id).toEqual([
        ['2026-10-01T09:00', 'backlog'],
        ['2026-10-02T09:00', null],
      ]);
    }
  });
});
