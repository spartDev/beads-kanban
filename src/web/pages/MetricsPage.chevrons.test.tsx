import { screen, within } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { MetricsDurationStats, MetricsResponse } from '../../shared/api';
import {
  healthFixture,
  metricsFixture,
  plain,
  shownText,
  spokenNames,
  spokenText,
  stubChartWidth,
  stubMetricsApi,
  trendOf,
  warmUpMetricsPages,
} from '../metrics/testing';
import { bdeskIssues, mpmIssues, projectsResponse } from '../test/fixtures';
import { renderApp } from '../test/render';

/**
 * Aucun chevron n'est lu tel quel par un lecteur d'écran sur la page Métriques entière. Une durée sous 30 s s'écrit « < 1 min »
 * et une Efficacité qui arrondirait à 100 % sans l'être s'écrit « > 99,9 % » : le chevron est compact à l'œil, mais un lecteur
 * d'écran le lit tel quel (« inférieur à 1 min ») ou l'omet. Chaque endroit qui écrit une durée dit donc aussi les mots.
 *
 * Ce test ne connaît aucun composant : il monte la page avec des durées toutes sous 30 s, ouvre tous les tableaux de données, et
 * cherche un chevron dans ce que la page annonce (texte, noms et descriptions). Un graphique ou un tableau ajouté plus tard, qui
 * écrirait `formatDuration(…)` sans le dire, le ferait échouer sans qu'on pense à l'y ajouter.
 */

const HOUR = 3_600_000;
const DAY = 24 * HOUR;

const api = (data: MetricsResponse) =>
  stubMetricsApi({ projects: projectsResponse, issues: { bdesk: bdeskIssues, mpm: mpmIssues } }, () => data);

warmUpMetricsPages();

// Seule `Date` est figée (le 2 novembre 2026, 20:00 à Paris, l'instant des fixtures) : comme dans MetricsPage.test.tsx.
beforeEach(() => {
  vi.useFakeTimers({ toFake: ['Date'] });
  vi.setSystemTime(new Date('2026-11-02T19:00:15.242Z'));
  stubChartWidth(640);
});
afterEach(() => {
  vi.useRealTimers();
  vi.restoreAllMocks();
});

/** Des statistiques de durée sous 30 s : la médiane et le P85 s'écrivent « < 1 min ». */
const quickStats = (median: number, p85: number, n = 6): MetricsDurationStats => ({ median, p85, n });

/**
 * La Vue d'un Projet dont toutes les durées sont sous 30 s, partout où la page en écrit une : les trois tuiles de durée (et la
 * valeur d'avant du temps de rétablissement, sans valeur courante), l'Efficacité à « > 99,9 % » avec un Blocage de 3,5 s, la
 * décomposition du Lead Time, les âges des tickets en cours et des Prêts, le Cycle Time de chaque Livraison, le tableau du découpage.
 */
function quickMetrics(): MetricsResponse {
  const data = metricsFixture();
  const duration = (median: number | null, p85: number | null, n: number, before: [number | null, number | null]) => ({
    median,
    p85,
    n,
    trend: { median: trendOf(median, before[0]), p85: trendOf(p85, before[1]) },
  });
  const quickSlice = <T extends MetricsResponse['slices']['type'][number]>(slice: T): T => ({
    ...slice,
    leadTime: quickStats(10_000, 20_000),
    cycleTime: quickStats(8_000, 25_000, 5),
  });
  const efficiency = (2 * HOUR - 3_500) / (2 * HOUR);
  const base = healthFixture().readyAges;

  return metricsFixture({
    tiles: {
      ...data.tiles,
      leadTime: duration(10_000, 20_000, 18, [12_000, 25_000]),
      cycleTime: duration(8_000, 15_000, 15, [9_000, 14_000]),
      recoveryTime: duration(null, null, 0, [10_000, 20_000]),
    },
    cycleTimeScatter: data.cycleTimeScatter.map((point, index) => ({ ...point, cycleTime: (index + 1) * 5_000 })),
    inProgress: data.inProgress.map((ticket, index) => ({ ...ticket, age: (index + 1) * 7_000 })),
    slices: { type: data.slices.type.map(quickSlice), priority: data.slices.priority.map(quickSlice), project: data.slices.project.map(quickSlice) },
    health: healthFixture({
      efficiency: { n: 15, cycleTime: 2 * HOUR, blockedTime: 3_500, ratio: efficiency, blockedDeliveries: 3, trend: trendOf(efficiency, 1) },
      leadTimeBreakdown: {
        deliveries: 18,
        total: 90_000,
        dependencyWait: 10_000,
        readyWait: 20_000,
        work: 40_000,
        blocked: 3_000,
        otherWait: 20_000,
        waited: 6,
        waits: quickStats(10_000, 20_000),
      },
      readyAges: {
        stagnantAfter: 14 * DAY,
        tickets: base.tickets.map((ticket, index) => ({ ...ticket, age: (index + 1) * 4_000, stagnant: false })),
        stagnant: 0,
        trend: trendOf(0, 0),
      },
    }),
  });
}

/** Les passages annoncés qui portent un chevron, avec leur entourage : de quoi lire où ils se trouvent quand le test échoue. */
const chevronsIn = (text: string): string[] => [...text.matchAll(/.{0,28}[<>].{0,20}/g)].map((match) => match[0]);

async function openedPage() {
  api(quickMetrics());
  renderApp('/p/bdesk/metrics');
  await screen.findByRole('heading', { level: 2, name: 'Indicateurs' });
  // Tous les tableaux de données, ouverts : la page entière, comme la lit qui les déplie.
  const page = screen.getByRole('main');
  for (const details of page.querySelectorAll('details')) details.open = true;
  return page;
}

/** Monter la page entière, avec ses graphiques, prend plusieurs secondes sous la charge d'une suite complète. */
const SLOW = 30_000;

describe('la page Métriques : aucun chevron n’est lu tel quel', () => {
  it(
    'annonce « moins d’une minute » et « plus de 99,9 % », jamais « < » ni « > », texte comme noms et descriptions',
    async () => {
      const page = await openedPage();

      // Toutes les cartes sont montées : un chevron ne peut pas se cacher dans une carte qui n'a pas pu s'afficher.
      for (const name of ['Indicateurs', 'Santé du flux', 'Analyse du flux']) {
        expect(within(page).getByRole('heading', { level: 2, name })).toBeTruthy();
      }
      for (const name of ['Cycle Time', 'Âge des tickets en cours', 'Décomposition du Lead Time', 'Prêts qui stagnent']) {
        const card = within(page).getByRole('region', { name });
        expect(chevronsIn(plain(spokenText(card))), name).toEqual([]);
      }
      expect(within(page).getAllByRole('table').length).toBeGreaterThanOrEqual(7);

      // La page entière, texte puis noms et descriptions.
      expect(chevronsIn(plain(spokenText(page)))).toEqual([]);
      expect(spokenNames(page).filter((name) => /[<>]/.test(name))).toEqual([]);
      // C'est bien la page des durées sous 30 s : les mots sont annoncés partout où l'écran écrit le chevron.
      expect(plain(spokenText(page))).toContain('moins d’une minute');
      expect(plain(spokenText(page))).toContain('plus de 99,9 %');
    },
    SLOW,
  );

  it(
    'écrit toujours les chevrons à l’écran : seule la lecture change',
    async () => {
      const page = await openedPage();
      const shown = plain(shownText(page));

      expect(shown).toContain('> 99,9 %');
      // Les tuiles, le Blocage, les âges, les tableaux et le découpage écrivent « < 1 min » : plusieurs dizaines d’endroits.
      expect(shown.match(/< 1 min/g)!.length).toBeGreaterThanOrEqual(40);
    },
    SLOW,
  );
});
