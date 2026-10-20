import { describe, expect, it } from 'vitest';
import { analyzeFlow, type TicketHistory } from './flow';

const at = (iso: string) => new Date(`${iso}Z`);
const HOUR = 3_600_000;
const DAY = 24 * HOUR;

function ticket(id: string, statuses: [string, string][], extra: Partial<TicketHistory> = {}): TicketHistory {
  return {
    id,
    type: 'task',
    statusSnapshots: statuses.map(([status, iso]) => ({ status, at: at(iso) })),
    dependencies: [],
    ...extra,
  };
}

describe('analyzeFlow', () => {
  it('réduit les instantanés répétés en Transitions', () => {
    const flow = analyzeFlow([
      ticket('t-1', [
        ['open', '2026-10-01T09:00'],
        ['open', '2026-10-01T10:00'],
        ['in_progress', '2026-10-02T09:00'],
        ['in_progress', '2026-10-02T12:00'],
        ['closed', '2026-10-03T09:00'],
      ]),
    ]).get('t-1');

    expect(flow?.transitions).toEqual([
      { status: 'open', at: at('2026-10-01T09:00') },
      { status: 'in_progress', at: at('2026-10-02T09:00') },
      { status: 'closed', at: at('2026-10-03T09:00') },
    ]);
  });

  it('compte un ticket fermé comme Livraison, avec son Lead Time', () => {
    const flow = analyzeFlow([
      ticket('t-1', [
        ['open', '2026-10-01T09:00'],
        ['in_progress', '2026-10-02T09:00'],
        ['closed', '2026-10-03T21:00'],
      ]),
    ]).get('t-1');

    expect(flow?.outcome).toEqual({ kind: 'delivered', at: at('2026-10-03T21:00') });
    expect(flow?.leadTime).toBe(2.5 * DAY);
  });

  it("laisse un ticket non fermé sans Livraison ni Lead Time", () => {
    const flow = analyzeFlow([ticket('t-1', [['open', '2026-10-01T09:00']])]).get('t-1');

    expect(flow?.outcome).toEqual({ kind: 'open' });
    expect(flow?.leadTime).toBeNull();
  });

  it('ne compte jamais une Epic fermée comme Livraison, mais mesure son Lead Time', () => {
    const flow = analyzeFlow([
      ticket(
        'e-1',
        [
          ['open', '2026-10-01T09:00'],
          ['closed', '2026-10-05T09:00'],
        ],
        { type: 'epic' },
      ),
    ]).get('e-1');

    expect(flow?.outcome).toEqual({ kind: 'closed', at: at('2026-10-05T09:00') });
    expect(flow?.leadTime).toBe(4 * DAY);
  });

  describe('Abandon', () => {
    const closedWith = (type: string) =>
      analyzeFlow([
        ticket(
          'old',
          [
            ['open', '2026-10-01T09:00'],
            ['closed', '2026-10-02T09:00'],
          ],
          { dependencies: [{ type, target: 'other', addedAt: at('2026-10-02T09:00') }] },
        ),
      ]).get('old');

    it('classe en Abandon un ticket remplacé par un autre (bd supersede)', () => {
      expect(closedWith('supersedes')?.outcome).toEqual({
        kind: 'abandoned',
        at: at('2026-10-02T09:00'),
        cause: 'superseded',
      });
    });

    it('classe en Abandon un doublon (bd duplicate)', () => {
      expect(closedWith('duplicates')?.outcome).toEqual({
        kind: 'abandoned',
        at: at('2026-10-02T09:00'),
        cause: 'duplicate',
      });
    });

    it('garde en Livraison un ticket qui n’a qu’un lien informatif', () => {
      expect(closedWith('relates-to')?.outcome.kind).toBe('delivered');
    });
  });

  describe('Cycle Time', () => {
    it('compte les statuts de travail : en cours, rattaché à un agent, bloqué', () => {
      const flow = analyzeFlow([
        ticket('t-1', [
          ['open', '2026-10-01T09:00'],
          ['hooked', '2026-10-01T10:00'],
          ['blocked', '2026-10-01T12:00'],
          ['in_progress', '2026-10-01T15:00'],
          ['closed', '2026-10-01T16:00'],
        ]),
      ]).get('t-1');

      expect(flow?.cycleTime).toBe(6 * HOUR);
    });

    it('est indéfini pour un ticket fermé sans avoir jamais été démarré', () => {
      const flow = analyzeFlow([
        ticket('t-1', [
          ['open', '2026-10-01T09:00'],
          ['closed', '2026-10-02T09:00'],
        ]),
      ]).get('t-1');

      expect(flow?.leadTime).toBe(DAY);
      expect(flow?.cycleTime).toBeNull();
    });

    it('est indéfini tant que le ticket n’est pas fermé', () => {
      const flow = analyzeFlow([
        ticket('t-1', [
          ['open', '2026-10-01T09:00'],
          ['in_progress', '2026-10-02T09:00'],
        ]),
      ]).get('t-1');

      expect(flow?.cycleTime).toBeNull();
    });
  });

  describe('Blocage', () => {
    const blocker = (statuses: [string, string][]) => ticket('b', statuses);
    const blocks = (target: string, added: string, removed?: string) => ({
      type: 'blocks',
      target,
      addedAt: at(added),
      ...(removed ? { removedAt: at(removed) } : {}),
    });

    it('mesure l’Attente de dépendance d’un ticket resté en Backlog avant son démarrage', () => {
      const flows = analyzeFlow([
        blocker([
          ['open', '2026-10-01T09:00'],
          ['closed', '2026-10-03T09:00'],
        ]),
        ticket(
          't',
          [
            ['open', '2026-10-01T09:00'],
            ['in_progress', '2026-10-04T09:00'],
            ['closed', '2026-10-05T09:00'],
          ],
          { dependencies: [blocks('b', '2026-10-01T09:00')] },
        ),
      ]);

      expect(flows.get('t')?.dependencyWait).toBe(2 * DAY);
      expect(flows.get('t')?.blockedTime).toBe(0);
    });

    it('compte en temps bloqué un Blocage survenu pendant le travail, Cycle Time inchangé', () => {
      const flows = analyzeFlow([
        blocker([
          ['open', '2026-10-01T09:00'],
          ['closed', '2026-10-02T15:00'],
        ]),
        ticket(
          't',
          [
            ['open', '2026-10-01T09:00'],
            ['in_progress', '2026-10-02T09:00'],
            ['closed', '2026-10-03T09:00'],
          ],
          { dependencies: [blocks('b', '2026-10-02T12:00')] },
        ),
      ]);

      expect(flows.get('t')?.blockedTime).toBe(3 * HOUR);
      expect(flows.get('t')?.cycleTime).toBe(DAY);
      expect(flows.get('t')?.dependencyWait).toBe(0);
    });

    it('lève le Blocage quand la dépendance est retirée', () => {
      const flows = analyzeFlow([
        blocker([['open', '2026-10-01T09:00']]),
        ticket(
          't',
          [
            ['open', '2026-10-01T09:00'],
            ['in_progress', '2026-10-02T09:00'],
            ['closed', '2026-10-03T09:00'],
          ],
          { dependencies: [blocks('b', '2026-10-01T09:00', '2026-10-01T21:00')] },
        ),
      ]);

      expect(flows.get('t')?.dependencyWait).toBe(12 * HOUR);
    });

    it('rétablit le Blocage quand la cible est rouverte', () => {
      const flows = analyzeFlow([
        blocker([
          ['open', '2026-10-01T09:00'],
          ['closed', '2026-10-02T09:00'],
          ['open', '2026-10-04T09:00'],
          ['closed', '2026-10-04T15:00'],
        ]),
        ticket(
          't',
          [
            ['open', '2026-10-01T09:00'],
            ['in_progress', '2026-10-03T09:00'],
            ['closed', '2026-10-05T09:00'],
          ],
          { dependencies: [blocks('b', '2026-10-01T09:00')] },
        ),
      ]);

      expect(flows.get('t')?.dependencyWait).toBe(DAY);
      expect(flows.get('t')?.blockedTime).toBe(6 * HOUR);
    });

    it('ignore une dépendance vers un ticket hors Projet', () => {
      const flows = analyzeFlow([
        ticket(
          't',
          [
            ['open', '2026-10-01T09:00'],
            ['closed', '2026-10-02T09:00'],
          ],
          { dependencies: [blocks('ailleurs', '2026-10-01T09:00')] },
        ),
      ]);

      expect(flows.get('t')?.dependencyWait).toBe(0);
    });

    it('compte le statut bloqué comme un Blocage', () => {
      const flows = analyzeFlow([
        ticket('t', [
          ['open', '2026-10-01T09:00'],
          ['in_progress', '2026-10-01T10:00'],
          ['blocked', '2026-10-01T12:00'],
          ['in_progress', '2026-10-01T16:00'],
          ['closed', '2026-10-01T18:00'],
        ]),
      ]);

      expect(flows.get('t')?.blockedTime).toBe(4 * HOUR);
      expect(flows.get('t')?.cycleTime).toBe(8 * HOUR);
    });
  });

  describe('Réouverture (scénario sais-42)', () => {
    const sais42: [string, string][] = [
      ['open', '2026-10-01T09:00'],
      ['in_progress', '2026-10-02T09:00'],
      ['closed', '2026-10-03T09:00'],
      ['open', '2026-10-10T09:00'],
      ['in_progress', '2026-10-11T09:00'],
      ['closed', '2026-10-12T09:00'],
    ];

    it('ne compte qu’une Livraison, datée de la dernière clôture', () => {
      const flow = analyzeFlow([ticket('sais-42', sais42)]).get('sais-42');

      expect(flow?.outcome).toEqual({ kind: 'delivered', at: at('2026-10-12T09:00') });
      expect(flow?.leadTime).toBe(11 * DAY);
      expect(flow?.reopenings).toBe(1);
    });

    it('cumule dans le Cycle Time les seules périodes de travail', () => {
      const flow = analyzeFlow([ticket('sais-42', sais42)]).get('sais-42');

      expect(flow?.cycleTime).toBe(2 * DAY);
    });

    it('annule la Livraison tant que le ticket rouvert n’est pas refermé', () => {
      const flow = analyzeFlow([ticket('sais-42', sais42.slice(0, 4))]).get('sais-42');

      expect(flow?.outcome).toEqual({ kind: 'open' });
      expect(flow?.reopenings).toBe(1);
    });
  });
});
