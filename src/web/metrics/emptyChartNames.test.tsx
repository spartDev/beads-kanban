import { screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { bdeskIssues, mpmIssues, projectsResponse } from '../test/fixtures';
import { renderApp } from '../test/render';
import { emptyMetricsFixture, stubChartWidth, stubMetricsApi, warmUpMetricsPages } from './testing';

/**
 * Un graphique sans rien à montrer (`EmptyChart`) est une région de statut, et elle porte le nom de son graphique (bdesk-38k.65) : la phrase qu'elle dit (« Aucun ticket Prêt. ») ne dit pas de quoi,
 * et une région de statut sans nom est une région dont un lecteur d'écran ne sait pas à quoi elle se rapporte. Neuf graphiques s'en servent : chacun la nomme du titre de sa carte (`ChartCard`),
 * le même que celui de la région qui l'entoure, sans le répéter à l'écran.
 */

const api = () => stubMetricsApi({ projects: projectsResponse, issues: { bdesk: bdeskIssues, mpm: mpmIssues } }, () => emptyMetricsFixture());

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

/** Les graphiques vides de la page : leur région de statut, avec le titre de la carte qui la contient. */
const emptyCharts = () =>
  screen.getAllByRole('status').map((status) => ({ status, title: status.closest('section')?.querySelector('h3')?.textContent ?? '(hors d’une carte)' }));

describe('la Vue globale d’un flux vide', () => {
  it('nomme « Aucun ticket Prêt. » du titre de son graphique, « Prêts qui stagnent »', async () => {
    api();
    renderApp('/');
    await screen.findByRole('heading', { level: 2, name: 'Indicateurs' });

    const status = screen.getByRole('status', { name: 'Prêts qui stagnent' });

    expect(status.textContent).toBe('Aucun ticket Prêt.');
    expect(status.closest('section')?.getAttribute('aria-labelledby')).toBe(status.getAttribute('aria-labelledby'));
  });
});

describe('la page Métriques d’un Projet au flux vide', () => {
  it('nomme chaque graphique vide du titre de sa carte : aucune région de statut sans nom', async () => {
    api();
    renderApp('/p/bdesk/metrics');
    await screen.findByRole('heading', { level: 2, name: 'Indicateurs' });

    const charts = emptyCharts();

    // Les neuf graphiques, quand le Projet n'a rien livré ni rien en cours.
    expect(charts.map(({ title }) => title).sort()).toEqual(
      ['Arrivées et Débit cumulés', 'Carte d’activité', 'Cycle Time', 'Débit', 'Décomposition du Lead Time', 'Flux cumulé', 'Prêts qui stagnent', 'Répartition par type', 'Âge des tickets en cours'].sort(),
    );
    for (const { status, title } of charts) expect(screen.getAllByRole('status', { name: title }), title).toContain(status);
    expect(screen.queryAllByRole('status', { name: '' })).toEqual([]);
  });
});
