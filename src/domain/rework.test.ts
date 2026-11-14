import { describe, expect, it } from 'vitest';
import type { PeriodSpec } from './calendar';
import { computeHealth } from './health';
import { analyzeProject, type MetricsTicket } from './metrics';

/**
 * Le Retravail : les tickets qui, sur la période, ont subi une Réouverture, une Prise rendue, ou dont une Livraison a reçu un Bug d'origine créé sur la
 * période (voir CONTEXT.md). Les historiques sont fictifs ; chaque scénario dit les dates qu'il fabrique.
 */

const PARIS = 'Europe/Paris';
/** Vendredi 23 octobre 2026, 20:00 à Paris. */
const NOW = new Date('2026-10-23T18:00:00Z');
const at = (iso: string) => new Date(`${iso}Z`);

/** Période passée du 19 au 21 octobre à Paris : de 22:00Z le 18 à 22:00Z le 21. */
const PAST: PeriodSpec = { from: '2026-10-19', to: '2026-10-21' };

function ticket(id: string, statuses: [string, string][], extra: Partial<MetricsTicket> = {}): MetricsTicket {
  return {
    id,
    title: `Titre de ${id}`,
    type: 'task',
    priority: 2,
    statusSnapshots: statuses.map(([status, iso]) => ({ status, at: at(iso) })),
    dependencies: [],
    ...extra,
  };
}

const reworkOf = (tickets: MetricsTicket[], period: PeriodSpec = PAST) =>
  computeHealth([{ id: 'p', name: 'Projet P', analysis: analyzeProject(tickets) }], { period, now: NOW, timeZone: PARIS }).rework;

describe('Retravail', () => {
  it('liste un ticket rouvert pendant la période, avec son nombre de Réouvertures et la date du dernier événement', () => {
    const reopened = ticket('r', [
      ['open', '2026-10-10T09:00:00'],
      ['closed', '2026-10-17T09:00:00'],
      ['open', '2026-10-20T10:00:00'], // Réouverture, dans la période
      ['closed', '2026-10-21T09:00:00'],
    ]);

    expect(reworkOf([reopened]).tickets).toEqual([
      {
        id: 'r',
        title: 'Titre de r',
        type: 'task',
        priority: 2,
        project: 'p',
        reopenings: 1,
        returns: 0,
        originBugs: [],
        lastAt: '2026-10-20T10:00:00.000Z',
      },
    ]);
  });

  it('compte une Prise rendue (un retour de travail à ouvert), même suivie d’une clôture', () => {
    const returned = ticket('t', [
      ['open', '2026-10-10T09:00:00'],
      ['hooked', '2026-10-19T09:00:00'],
      ['open', '2026-10-19T15:00:00'], // Prise rendue
      ['in_progress', '2026-10-20T09:00:00'],
      ['closed', '2026-10-21T09:00:00'],
    ]);

    expect(reworkOf([returned]).tickets).toMatchObject([{ id: 't', reopenings: 0, returns: 1, lastAt: '2026-10-19T15:00:00.000Z' }]);
  });

  it('ne compte que les événements de la période : ni avant son début, ni à sa fin', () => {
    const before = ticket('b', [
      ['open', '2026-10-10T09:00:00'],
      ['closed', '2026-10-15T09:00:00'],
      ['open', '2026-10-18T21:59:59'], // une seconde avant le début de la période
    ]);
    const atEnd = ticket('e', [
      ['open', '2026-10-10T09:00:00'],
      ['in_progress', '2026-10-20T09:00:00'],
      ['open', '2026-10-21T22:00:00'], // le premier instant qui suit la période
    ]);
    const atStart = ticket('s', [
      ['open', '2026-10-10T09:00:00'],
      ['closed', '2026-10-15T09:00:00'],
      ['open', '2026-10-18T22:00:00'], // le premier instant de la période
    ]);

    expect(reworkOf([before, atEnd, atStart]).tickets.map((t) => t.id)).toEqual(['s']);
  });

  it('range du plus d’événements au moins, puis du plus récent au plus ancien', () => {
    const twice = ticket('twice', [
      ['open', '2026-10-10T09:00:00'],
      ['closed', '2026-10-15T09:00:00'],
      ['open', '2026-10-19T09:00:00'],
      ['in_progress', '2026-10-19T10:00:00'],
      ['open', '2026-10-19T11:00:00'],
    ]);
    const recent = ticket('recent', [
      ['open', '2026-10-10T09:00:00'],
      ['closed', '2026-10-15T09:00:00'],
      ['open', '2026-10-21T09:00:00'],
    ]);
    const older = ticket('older', [
      ['open', '2026-10-10T09:00:00'],
      ['closed', '2026-10-15T09:00:00'],
      ['open', '2026-10-20T09:00:00'],
    ]);

    expect(reworkOf([older, recent, twice]).tickets.map((t) => t.id)).toEqual(['twice', 'recent', 'older']);
  });

  it('nomme les Bugs d’origine d’une Livraison créés pendant la période, pas ceux d’avant', () => {
    const delivery = ticket('d', [
      ['open', '2026-10-01T09:00:00'],
      ['in_progress', '2026-10-02T09:00:00'],
      ['closed', '2026-10-05T09:00:00'],
    ]);
    const bug = (id: string, created: string) =>
      ticket(id, [['open', created]], { type: 'bug', dependencies: [{ type: 'discovered-from', target: 'd', addedAt: at(created) }] });

    const rework = reworkOf([delivery, bug('old', '2026-10-10T09:00:00'), bug('b2', '2026-10-20T09:00:00'), bug('b1', '2026-10-19T09:00:00')]);

    expect(rework.tickets).toEqual([
      expect.objectContaining({ id: 'd', reopenings: 0, returns: 0, originBugs: ['b1', 'b2'], lastAt: '2026-10-20T09:00:00.000Z' }),
    ]);
  });
});
