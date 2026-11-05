import { afterEach, describe, expect, it } from 'vitest';
import { MAX_ZONE_FORMATTERS } from '../../domain/time-zone';
import type { StatusSnapshot, TicketHistory } from '../../domain/flow';
import type { Issue, Project } from '../../shared/api';
import type { ProjectService } from '../projects/service';
import { createMetricsService } from './service';

/**
 * bdesk-38k.48, relecture : le fuseau d'une requête vient du client, et le domaine gardait un formateur `Intl` par nom reçu, dans deux `Map`
 * (`calendar.ts` pour les jours, `health.ts` pour la Carte d'activité) que rien ne vidait. Mesuré avant la correction, en rejouant la route : 4 000 requêtes,
 * chacune avec une autre casse d'un même fuseau, laissaient 4 098 formateurs vivants après un ramasse-miettes, environ 20 Ko de mémoire native chacun
 * (hors du tas JS, que `heapUsed` ne voit pas), soit 84 Mo. Les formateurs sont désormais bornés (`lruMemo`) : on le voit à ce que le service en recrée.
 */

const at = (iso: string) => new Date(`${iso}Z`);
const NOW = at('2026-11-04T23:30');

const project: Project = { id: 'p', name: 'P', path: '/p', prefix: 'p', mode: 'embedded', status: 'ok' };
const issue: Issue = {
  id: 'p-1',
  title: 'Titre de p-1',
  type: 'task',
  status: 'closed',
  priority: 2,
  assignee: null,
  parentId: null,
  createdAt: '2026-11-02T08:00:00.000Z',
  updatedAt: '2026-11-04T23:10:00.000Z',
  closedAt: '2026-11-04T23:10:00.000Z',
  blockedBy: [],
};

/** Un Projet dont la Livraison est dans la fenêtre : la Carte d'activité lit un fuseau pour chacune de ses Transitions. */
function delivered(): ProjectService {
  const statuses: StatusSnapshot[] = [
    { status: 'open', at: at('2026-11-02T08:00') },
    { status: 'in_progress', at: at('2026-11-03T09:00') },
    { status: 'closed', at: at('2026-11-04T23:10') },
  ];
  const history: TicketHistory = { id: 'p-1', type: 'task', statusSnapshots: statuses, dependencies: [] };
  return {
    list: async () => ({ projects: [project], ignored: [] }),
    head: async () => 'h1',
    issues: async () => [issue],
    histories: async () => [history],
    issue: async () => {
      throw new Error('inutile ici');
    },
  };
}

/**
 * Compte les `new Intl.DateTimeFormat` à partir de maintenant. Une sous-classe, pas un espion : un espion rendrait des objets qui ne sont pas de vrais
 * formateurs, et `formatToParts` les refuserait.
 */
function countFormatters() {
  const Original = Intl.DateTimeFormat;
  let created = 0;
  class Counted extends Original {
    constructor(...args: ConstructorParameters<typeof Original>) {
      super(...args);
      created++;
    }
  }
  Intl.DateTimeFormat = Counted as typeof Intl.DateTimeFormat;
  return {
    created: () => created,
    restore: () => {
      Intl.DateTimeFormat = Original;
    },
  };
}

describe('service de métriques : les formateurs gardés par fuseau sont bornés', () => {
  let counter: ReturnType<typeof countFormatters> | undefined;
  afterEach(() => {
    counter?.restore();
    counter = undefined;
  });

  const week = { projects: [], period: { range: '7d' as const } };
  const metrics = () => createMetricsService(delivered(), { now: () => NOW, timeZone: 'UTC' });
  /** Des fuseaux que le moteur connaît, tous distincts : plus que le domaine n'en garde. */
  const manyZones = (count: number) => Intl.supportedValuesOf('timeZone').slice(0, count);

  it('ne recrée pas les formateurs d’un fuseau déjà servi : un client qui revient n’y coûte rien', async () => {
    const service = metrics();
    await service.compute({ ...week, timeZone: 'Asia/Tokyo' });
    counter = countFormatters();

    for (let i = 0; i < 5; i++) await service.compute({ ...week, timeZone: 'Asia/Tokyo' });

    expect(counter.created()).toBe(0);
  });

  it('jette les formateurs du fuseau le moins récemment servi quand il y en a plus que la taille : ils sont recréés si on le redemande', async () => {
    const service = metrics();
    const zones = manyZones(MAX_ZONE_FORMATTERS + 1);
    expect(zones.length).toBe(MAX_ZONE_FORMATTERS + 1);
    for (const zone of zones) await service.compute({ ...week, timeZone: zone });
    counter = countFormatters();

    await service.compute({ ...week, timeZone: zones.at(-1) }); // le dernier servi : ses formateurs sont encore là
    expect(counter.created()).toBe(0);

    await service.compute({ ...week, timeZone: zones[0] }); // le premier : jeté, un formateur pour les jours et un pour la Carte d'activité
    expect(counter.created()).toBe(2);
  });

  it('ne grossit pas avec le nombre de fuseaux servis : une fois la taille atteinte, chaque fuseau nouveau en fait jeter un', async () => {
    const service = metrics();
    const zones = manyZones(MAX_ZONE_FORMATTERS * 3);
    for (const zone of zones.slice(0, MAX_ZONE_FORMATTERS)) await service.compute({ ...week, timeZone: zone });

    // Les `MAX_ZONE_FORMATTERS` derniers servis sont gardés, quels que soient les autres qui ont défilé.
    for (const zone of zones.slice(MAX_ZONE_FORMATTERS)) await service.compute({ ...week, timeZone: zone });
    counter = countFormatters();
    for (const zone of zones.slice(-MAX_ZONE_FORMATTERS)) await service.compute({ ...week, timeZone: zone });
    expect(counter.created()).toBe(0);

    await service.compute({ ...week, timeZone: zones[0] }); // l'un des premiers, il y a longtemps : jeté
    expect(counter.created()).toBe(2);
  });
});
