import { describe, expect, it } from 'vitest';
import { longTrendOf } from './longTrend';
import { analyzeProject, type MetricsTicket } from './metrics';

/**
 * La Tendance longue : Débit, Lead Time au P85 et Taux de Réouverture, semaine par semaine sur les 12 semaines du Fuseau de
 * l'utilisateur qui finissent par la semaine en cours (voir CONTEXT.md). Les historiques sont fictifs.
 */

const PARIS = 'Europe/Paris';
/** Vendredi 23 octobre 2026, 20:00 à Paris : la semaine en cours va du lundi 19 au dimanche 25, jour du passage à l'heure d'hiver. */
const NOW = new Date('2026-10-23T18:00:00Z');
const at = (iso: string) => new Date(`${iso}Z`);

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

const trendOf = (tickets: MetricsTicket[], timeZone = PARIS) =>
  longTrendOf([{ id: 'p', name: 'Projet P', analysis: analyzeProject(tickets) }], { now: NOW, timeZone });

describe('Tendance longue', () => {
  it('découpe les 12 semaines du fuseau, du lundi au dimanche, la dernière étant la semaine en cours', () => {
    const { weeks } = trendOf([]);

    expect(weeks).toHaveLength(12);
    expect(weeks[0]).toMatchObject({ from: '2026-08-03', to: '2026-08-09', start: '2026-08-02T22:00:00.000Z', end: '2026-08-09T22:00:00.000Z' });
    // La semaine en cours dure 7 jours et une heure : le dimanche 25, les horloges reculent.
    expect(weeks[11]).toMatchObject({ from: '2026-10-19', to: '2026-10-25', start: '2026-10-18T22:00:00.000Z', end: '2026-10-25T23:00:00.000Z', partial: true });
    expect(weeks.slice(0, 11).every((week) => !week.partial)).toBe(true);
  });

  it('range une Livraison dans la semaine de sa date dans le fuseau : le lundi 00:30 à Paris est déjà la semaine suivante', () => {
    const delivery = (id: string, closed: string) => ticket(id, [['open', '2026-07-01T09:00:00'], ['closed', closed]]);
    const { weeks } = trendOf([
      delivery('dimanche', '2026-10-11T21:59:59'), // dimanche 11, 23:59:59 à Paris
      delivery('lundi', '2026-10-11T22:30:00'), // lundi 12, 00:30 à Paris
    ]);

    expect(weeks.map((week) => week.throughput)).toEqual([0, 0, 0, 0, 0, 0, 0, 0, 0, 1, 1, 0]);
  });

  it('donne le P85 du Lead Time des Livraisons de la semaine, fiable à partir de 4 Livraisons', () => {
    // Lead Times de 1, 2, 3 jours la semaine du 5 octobre ; de 1, 2, 3, 4 jours celle du 12.
    const delivery = (id: string, monday: string, days: number) => {
      const created = new Date(`${monday}T08:00:00Z`).getTime();
      return ticket(id, [
        ['open', new Date(created).toISOString().slice(0, -1)],
        ['closed', new Date(created + days * 86_400_000).toISOString().slice(0, -1)],
      ]);
    };
    const { weeks } = trendOf([
      ...[1, 2, 3].map((days) => delivery(`a${days}`, '2026-10-05', days)),
      ...[1, 2, 3, 4].map((days) => delivery(`b${days}`, '2026-10-12', days)),
    ]);
    const DAY = 86_400_000;

    expect(weeks[9]).toMatchObject({ from: '2026-10-05', throughput: 3, leadTimeP85: (270 * DAY) / 100, reliable: false });
    expect(weeks[10]).toMatchObject({ from: '2026-10-12', throughput: 4, leadTimeP85: (355 * DAY) / 100, reliable: true });
  });

  it('laisse une semaine sans Livraison sans centile, et une semaine sans clôture sans Taux de Réouverture', () => {
    const { weeks } = trendOf([ticket('ouvert', [['open', '2026-10-06T09:00:00']])]);

    expect(weeks[9]).toMatchObject({ throughput: 0, leadTimeP85: null, reliable: false, closures: 0, reopened: 0, reopeningRate: null });
  });
  it('rattache une Réouverture à la semaine de la clôture qu’elle suit, même quand elle arrive plus tard', () => {
    const { weeks } = trendOf([
      ticket('rouvert', [
        ['open', '2026-09-28T09:00:00'],
        ['closed', '2026-10-01T09:00:00'], // semaine du 28 septembre
        ['open', '2026-10-07T09:00:00'], // Réouverture, semaine du 5 octobre
        ['closed', '2026-10-08T09:00:00'],
      ]),
      ticket('livré', [
        ['open', '2026-09-28T09:00:00'],
        ['closed', '2026-09-30T09:00:00'],
      ]),
    ]);

    expect(weeks[8]).toMatchObject({ from: '2026-09-28', closures: 2, reopened: 1, reopeningRate: 0.5, throughput: 1 });
    expect(weeks[9]).toMatchObject({ from: '2026-10-05', closures: 1, reopened: 0, reopeningRate: 0, throughput: 1 });
  });

  it('compte la semaine en cours jusqu’à maintenant : ce qui est daté plus tard n’est pas encore arrivé', () => {
    const { weeks } = trendOf([
      ticket('avant', [['open', '2026-10-19T09:00:00'], ['closed', '2026-10-23T17:59:59']]),
      ticket('après', [['open', '2026-10-19T09:00:00'], ['closed', '2026-10-23T18:00:00']]), // à NOW pile
    ]);

    expect(weeks[11]).toMatchObject({ partial: true, throughput: 1, closures: 1 });
  });

  it('mesure la Vue globale sur l’union des tickets des Projets', () => {
    const closedOn = (id: string, day: string) => ticket(id, [['open', '2026-10-01T09:00:00'], ['closed', `${day}T09:00:00`]]);
    const project = (id: string, tickets: MetricsTicket[]) => ({ id, name: id, analysis: analyzeProject(tickets) });
    const { weeks } = longTrendOf(
      [project('a', [closedOn('a1', '2026-10-13'), closedOn('a2', '2026-10-14')]), project('b', [closedOn('b1', '2026-10-15'), closedOn('b2', '2026-10-16')])],
      { now: NOW, timeZone: PARIS },
    );

    expect(weeks[10]).toMatchObject({ throughput: 4, reliable: true });
  });
});
