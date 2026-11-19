import { describe, expect, it } from 'vitest';
import { analyzeProject, type MetricsTicket } from './metrics';
import { AWAITING_VALIDATION, lastVisitWindow, sinceLastVisit, WITHOUT_LAST_VISIT } from './sinceLastVisit';

/**
 * « Depuis votre dernière visite » : ce qui s'est passé dans tous les Projets entre la Dernière visite et l'instant des données (voir CONTEXT.md). Les
 * historiques sont fictifs ; chaque scénario dit les dates qu'il fabrique.
 */

const at = (iso: string) => new Date(`${iso}Z`);
const ms = (iso: string) => at(iso).getTime();

/** La fenêtre des scénarios : du 18 octobre 2026, 12:00Z (la Dernière visite), compris, au 19 octobre, 12:00Z (l'instant des données), exclu. */
const WINDOW = { start: ms('2026-10-18T12:00:00'), end: ms('2026-10-19T12:00:00') };

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

const project = (id: string, tickets: MetricsTicket[]) => ({ id, name: `Projet ${id}`, analysis: analyzeProject(tickets) });

/** Les genres d'un seul Projet, « p », sur la fenêtre. */
const groupsOf = (tickets: MetricsTicket[], window = WINDOW) => sinceLastVisit([project('p', tickets)], window);

/** Les tickets d'un genre, réduits à leur identifiant et à la date de leur événement. */
const listed = (tickets: MetricsTicket[], kind: string, window = WINDOW) =>
  groupsOf(tickets, window)
    .find((group) => group.kind === kind)
    ?.tickets.map((row) => [row.id, new Date(row.at).toISOString().slice(0, 19)]);

describe('lastVisitWindow', () => {
  const ASOF = ms('2026-10-19T12:00:00');

  it('va de la Dernière visite à l’instant des données', () => {
    expect(lastVisitWindow(ms('2026-10-17T08:00:00'), ASOF)).toEqual({ start: ms('2026-10-17T08:00:00'), end: ASOF });
  });

  it('remonte 24 heures sans Dernière visite', () => {
    expect(WITHOUT_LAST_VISIT).toBe(24 * 3_600_000);
    expect(lastVisitWindow(undefined, ASOF)).toEqual({ start: ms('2026-10-18T12:00:00'), end: ASOF });
  });

  it('est vide quand la Dernière visite est après l’instant des données (une horloge qui a reculé) : jamais de fenêtre à l’envers', () => {
    expect(lastVisitWindow(ASOF + 1, ASOF)).toEqual({ start: ASOF, end: ASOF });
  });
});

describe('sinceLastVisit', () => {
  it('rend les cinq genres d’un Projet sans Statut de relais, dans l’ordre, les mauvaises nouvelles d’abord, même vides', () => {
    expect(groupsOf([]).map((group) => [group.kind, group.tickets.length])).toEqual([
      ['reopenings', 0],
      ['escapedBugs', 0],
      ['deliveries', 0],
      ['newBlockages', 0],
      ['arrivals', 0],
    ]);
  });

  it('compte une Réouverture de la fenêtre, et pas celle d’avant ni celle qui tombe à sa fin', () => {
    const reopened = (id: string, reopenedAt: string) =>
      ticket(id, [
        ['open', '2026-10-01T09:00:00'],
        ['closed', '2026-10-10T09:00:00'],
        ['open', reopenedAt],
      ]);

    expect(
      listed([reopened('dedans', '2026-10-18T12:00:00'), reopened('avant', '2026-10-18T11:59:59'), reopened('fin', '2026-10-19T12:00:00')], 'reopenings'),
    ).toEqual([['dedans', '2026-10-18T12:00:00']]);
  });

  it('compte une Livraison de la fenêtre, mais plus celle qu’une Réouverture a annulée : elle devient une Réouverture', () => {
    const delivered = ticket('livre', [
      ['open', '2026-10-01T09:00:00'],
      ['in_progress', '2026-10-17T09:00:00'],
      ['closed', '2026-10-18T15:00:00'],
    ]);
    const cancelled = ticket('rouvert', [
      ['open', '2026-10-01T09:00:00'],
      ['closed', '2026-10-18T13:00:00'],
      ['open', '2026-10-18T16:00:00'],
    ]);

    expect(listed([delivered, cancelled], 'deliveries')).toEqual([['livre', '2026-10-18T15:00:00']]);
    expect(listed([delivered, cancelled], 'reopenings')).toEqual([['rouvert', '2026-10-18T16:00:00']]);
  });

  it('ne compte ni un Abandon ni une Epic parmi les Livraisons', () => {
    const duplicate = ticket('doublon', [['open', '2026-10-01T09:00:00'], ['closed', '2026-10-18T15:00:00']], {
      dependencies: [{ type: 'duplicates', target: 'autre', addedAt: at('2026-10-18T14:00:00') }],
    });
    const epic = ticket('epic', [['open', '2026-10-01T09:00:00'], ['closed', '2026-10-18T15:00:00']], { type: 'epic' });

    expect(listed([duplicate, epic, ticket('autre', [['open', '2026-10-01T09:00:00']])], 'deliveries')).toEqual([]);
  });

  it('compte un Bug d’origine trouvé dans la fenêtre, avec les Livraisons qu’il met en échec', () => {
    const delivery = ticket('livre', [['open', '2026-10-01T09:00:00'], ['closed', '2026-10-10T09:00:00']]);
    const bug = ticket('bug', [['open', '2026-10-18T20:00:00']], {
      type: 'bug',
      dependencies: [{ type: 'discovered-from', target: 'livre', addedAt: at('2026-10-18T20:00:00') }],
    });
    const older = ticket('vieux-bug', [['open', '2026-10-15T20:00:00']], {
      type: 'bug',
      dependencies: [{ type: 'discovered-from', target: 'livre', addedAt: at('2026-10-15T20:00:00') }],
    });

    const escaped = groupsOf([delivery, bug, older]).find((group) => group.kind === 'escapedBugs');
    expect(escaped?.tickets).toEqual([
      { project: 'p', id: 'bug', title: 'Titre de bug', type: 'bug', priority: 2, at: ms('2026-10-18T20:00:00'), deliveries: ['livre'] },
    ]);
  });

  it('ne compte pas un bug trouvé en cours de travail : il n’est l’origine d’aucun échec', () => {
    const started = ticket('en-cours', [['open', '2026-10-01T09:00:00'], ['in_progress', '2026-10-10T09:00:00']]);
    const bug = ticket('bug', [['open', '2026-10-18T20:00:00']], {
      type: 'bug',
      dependencies: [{ type: 'discovered-from', target: 'en-cours', addedAt: at('2026-10-18T20:00:00') }],
    });

    expect(listed([started, bug], 'escapedBugs')).toEqual([]);
  });

  it('compte un nouveau Blocage, par dépendance ou par statut, mais pas celui qui court depuis avant la fenêtre', () => {
    const blocker = ticket('bloquant', [['open', '2026-10-01T09:00:00']]);
    const byDependency = ticket('par-lien', [['open', '2026-10-01T09:00:00'], ['in_progress', '2026-10-10T09:00:00']], {
      dependencies: [{ type: 'blocks', target: 'bloquant', addedAt: at('2026-10-18T18:00:00') }],
    });
    const byStatus = ticket('par-statut', [['open', '2026-10-01T09:00:00'], ['blocked', '2026-10-19T08:00:00']]);
    const ongoing = ticket('ancien', [['open', '2026-10-01T09:00:00'], ['blocked', '2026-10-15T08:00:00']]);

    expect(listed([blocker, byDependency, byStatus, ongoing], 'newBlockages')).toEqual([
      ['par-statut', '2026-10-19T08:00:00'],
      ['par-lien', '2026-10-18T18:00:00'],
    ]);
  });

  it('compte un nouveau Blocage même levé avant l’instant des données : il s’est passé', () => {
    const blocked = ticket('leve', [
      ['open', '2026-10-01T09:00:00'],
      ['blocked', '2026-10-18T13:00:00'],
      ['in_progress', '2026-10-18T17:00:00'],
    ]);

    expect(listed([blocked], 'newBlockages')).toEqual([['leve', '2026-10-18T13:00:00']]);
  });

  it('compte les Arrivées de la fenêtre, hors Epics', () => {
    const arrived = ticket('nouveau', [['open', '2026-10-19T09:00:00']]);
    const epic = ticket('epic', [['open', '2026-10-19T09:00:00']], { type: 'epic' });
    const old = ticket('ancien', [['open', '2026-10-17T09:00:00']]);

    expect(listed([arrived, epic, old], 'arrivals')).toEqual([['nouveau', '2026-10-19T09:00:00']]);
  });

  it('laisse de côté un ticket À valider, que la File de décisions montre', () => {
    const awaiting = ticket('a-valider', [
      ['open', '2026-10-18T13:00:00'],
      ['in_progress', '2026-10-18T14:00:00'],
      [AWAITING_VALIDATION, '2026-10-19T10:00:00'],
    ]);
    const validatedSince = ticket('valide', [
      ['open', '2026-10-18T13:00:00'],
      [AWAITING_VALIDATION, '2026-10-18T14:00:00'],
      ['in_progress', '2026-10-19T10:00:00'],
    ]);

    expect(AWAITING_VALIDATION).toBe('awaiting_human');
    expect(listed([awaiting, validatedSince], 'arrivals')).toEqual([['valide', '2026-10-18T13:00:00']]);
  });

  it('range les tickets d’un genre du plus récent au plus ancien, puis par Projet et par identifiant, et nomme le Projet de chacun', () => {
    const arrival = (id: string, iso: string) => ticket(id, [['open', iso]]);
    const groups = sinceLastVisit(
      [
        project('b', [arrival('b-1', '2026-10-18T13:00:00'), arrival('b-2', '2026-10-19T09:00:00')]),
        project('a', [arrival('a-2', '2026-10-18T13:00:00'), arrival('a-1', '2026-10-18T13:00:00')]),
      ],
      WINDOW,
    );

    expect(groups.find((group) => group.kind === 'arrivals')?.tickets.map((row) => `${row.project}/${row.id}`)).toEqual(['b/b-2', 'a/a-1', 'a/a-2', 'b/b-1']);
  });

  it('ne compte un ticket qu’une fois par genre, daté de son dernier événement de la fenêtre', () => {
    const twice = ticket('deux-fois', [
      ['open', '2026-10-01T09:00:00'],
      ['closed', '2026-10-10T09:00:00'],
      ['open', '2026-10-18T13:00:00'],
      ['closed', '2026-10-18T14:00:00'],
      ['open', '2026-10-18T15:00:00'],
    ]);

    expect(listed([twice], 'reopenings')).toEqual([['deux-fois', '2026-10-18T15:00:00']]);
  });
});
