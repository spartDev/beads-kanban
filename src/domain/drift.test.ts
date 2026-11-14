import { describe, expect, it } from 'vitest';
import { driftsOf } from './drift';
import { analyzeProject, type MetricsTicket } from './metrics';

/** Vendredi 23 octobre 2026, 18:00Z. */
const NOW = new Date('2026-10-23T18:00:00Z').getTime();
const HOUR = 3_600_000;
const DAY = 24 * HOUR;
const iso = (ms: number) => new Date(ms).toISOString().slice(0, -1);
const at = (text: string) => new Date(`${text}Z`);

function ticket(id: string, statuses: [string, string][], extra: Partial<MetricsTicket> = {}): MetricsTicket {
  return {
    id,
    title: `Titre de ${id}`,
    type: 'task',
    priority: 2,
    statusSnapshots: statuses.map(([status, when]) => ({ status, at: at(when) })),
    dependencies: [],
    ...extra,
  };
}

/** Une Livraison démarrée `startedDaysAgo` jours avant NOW, au Cycle Time de `cycleDays` jours. */
function delivered(id: string, cycleDays: number, extra: Partial<MetricsTicket> = {}, startedDaysAgo = 30): MetricsTicket {
  const started = NOW - startedDaysAgo * DAY;
  return ticket(
    id,
    [
      ['open', iso(started - DAY)],
      ['in_progress', iso(started)],
      ['closed', iso(started + cycleDays * DAY)],
    ],
    extra,
  );
}

/** Dix Livraisons de Cycle Time 1 à 10 jours : P85 de 8,65 jours (Python, `quantiles(…, method='inclusive')`). */
const tenDeliveries = (prefix: string, extra: Partial<MetricsTicket> = {}) =>
  Array.from({ length: 10 }, (_, i) => delivered(`${prefix}${i + 1}`, i + 1, extra));

/** Un ticket en cours depuis `daysAgo` jours. */
const working = (id: string, daysAgo: number, extra: Partial<MetricsTicket> = {}) =>
  ticket(
    id,
    [
      ['open', iso(NOW - (daysAgo + 1) * DAY)],
      ['in_progress', iso(NOW - daysAgo * DAY)],
    ],
    extra,
  );

const driftsAt = (tickets: MetricsTicket[], now = NOW) => driftsOf(analyzeProject(tickets), now);

describe('driftsOf (Dérive)', () => {
  it('un ticket en cours au-delà du P85 du Cycle Time des Livraisons de son type dérive', () => {
    const drifts = driftsAt([...tenDeliveries('d'), working('w', 12)]);

    expect(drifts.get('w')).toEqual({ cycleTime: 12 * DAY, reference: expect.closeTo(8.65 * DAY, 3), scope: 'type' });
  });

  it('ne compte que les Livraisons des 90 derniers jours : sous 10, pas de référence', () => {
    const recent = tenDeliveries('d').slice(1);
    // Démarrée il y a 92 jours, livrée il y a 91 : hors fenêtre. Une autre, livrée il y a 89 jours, y est.
    const tooOld = delivered('old', 1, {}, 92);

    expect(driftsAt([...recent, tooOld, working('w', 30)]).has('w')).toBe(false);
    expect(driftsAt([...recent, delivered('inside', 1, {}, 90), working('w', 30)]).has('w')).toBe(true);
  });

  it('sous 10 Livraisons de son type, la référence est celle de tout le Projet', () => {
    const bugs = [1, 2, 3].map((i) => delivered(`b${i}`, 20, { type: 'bug' }));
    // Cycle Times 1 à 10 jours et trois fois 20 : le P85 des 13 tombe entre la 11ᵉ et la 12ᵉ valeur, 20 jours.
    const drifts = driftsAt([...tenDeliveries('t'), ...bugs, working('w', 25, { type: 'bug' })]);

    expect(drifts.get('w')).toEqual({ cycleTime: 25 * DAY, reference: 20 * DAY, scope: 'project' });
  });

  it('le Cycle Time en cours cumule les périodes de travail, statut bloqué compris, sans le temps revenu à ouvert', () => {
    const resumed = ticket('w', [
      ['open', iso(NOW - 40 * DAY)],
      ['in_progress', iso(NOW - 30 * DAY)], // 4 jours de travail…
      ['blocked', iso(NOW - 26 * DAY)], // … 2 jours bloqué …
      ['open', iso(NOW - 24 * DAY)], // … 20 jours rendu à ouvert, qui ne comptent pas …
      ['in_progress', iso(NOW - 4 * DAY)], // … et 4 jours de travail depuis.
    ]);

    expect(driftsAt([...tenDeliveries('d'), resumed]).get('w')?.cycleTime).toBe(10 * DAY);
  });

  it('un ticket revenu à ouvert ne dérive plus, même après un long travail', () => {
    const returned = ticket('w', [
      ['open', iso(NOW - 40 * DAY)],
      ['in_progress', iso(NOW - 30 * DAY)],
      ['open', iso(NOW - DAY)],
    ]);

    expect(driftsAt([...tenDeliveries('d'), returned]).has('w')).toBe(false);
  });

  it('un Cycle Time en cours égal à la référence ne dérive pas : il faut la dépasser', () => {
    const sameCycle = Array.from({ length: 10 }, (_, i) => delivered(`d${i}`, 5)); // P85 de 5 jours

    expect(driftsAt([...sameCycle, working('w', 5)]).has('w')).toBe(false);
    expect(driftsAt([...sameCycle, working('w', 5)], NOW + 1).get('w')?.cycleTime).toBe(5 * DAY + 1);
  });

  it('une Livraison jamais démarrée, sans Cycle Time, ne compte pas dans la référence', () => {
    const neverStarted = ticket('n', [
      ['open', iso(NOW - 10 * DAY)],
      ['closed', iso(NOW - 5 * DAY)],
    ]);

    expect(driftsAt([...tenDeliveries('d').slice(1), neverStarted, working('w', 30)]).has('w')).toBe(false);
  });
});
