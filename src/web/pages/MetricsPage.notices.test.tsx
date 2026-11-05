import { screen, within } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { metricsFixture, stubChartWidth, stubMetricsApi, warmUpMetricsPages } from '../metrics/testing';
import { bdeskIssues, mpmIssues, projectsResponse } from '../test/fixtures';
import { renderApp } from '../test/render';

/**
 * Les avis de la page Métriques sont des régions de statut nommées par leur titre (bdesk-38k.61) : le réglage d'adresse que la page ne comprend pas, l'absence de Projet mesuré, et les
 * Projets illisibles qui n'entrent pas dans les chiffres (un avis écrit à la main, sur le modèle de `Notice` : il se nomme de même). Les autres avis de l'application sont dans `noticeNames.test.tsx`.
 */

const api = (data = metricsFixture()) => stubMetricsApi({ projects: projectsResponse, issues: { bdesk: bdeskIssues, mpm: mpmIssues } }, () => data);

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

describe('l’avis d’un réglage d’adresse ignoré', () => {
  it('est nommé « Réglage de l’adresse ignoré » pour un seul réglage, et dit lequel', async () => {
    api();
    renderApp('/p/bdesk/metrics?range=14d');

    const notice = await screen.findByRole('status', { name: 'Réglage de l’adresse ignoré' });

    expect(within(notice).getByText(/La période « 14d » n’existe pas/)).toBeTruthy();
  });

  it('est nommé « Réglages de l’adresse ignorés » pour plusieurs, et les dit tous', async () => {
    api();
    renderApp('/p/bdesk/metrics?range=14d&by=status');

    const notice = await screen.findByRole('status', { name: 'Réglages de l’adresse ignorés' });

    expect(within(notice).getByText(/La période « 14d » n’existe pas/)).toBeTruthy();
    expect(within(notice).getByText(/Le découpage « status » n’existe pas/)).toBeTruthy();
  });
});

describe('l’avis d’aucun Projet mesuré, et celui des Projets illisibles', () => {
  const unreadable = [
    { id: 'bdesk', name: 'beads-desktop', reason: 'Base Dolt verrouillée' },
    { id: 'mpm', name: 'My-Prompt-Manager', reason: 'Base Dolt absente' },
  ];

  it('aucun Projet n’a pu être mesuré : deux régions de statut, chacune nommée par son titre', async () => {
    api(metricsFixture({ projects: [], unreadable: [unreadable[0]!] }));
    renderApp('/p/bdesk/metrics');

    const none = await screen.findByRole('status', { name: 'Aucun Projet n’a pu être mesuré' });
    const named = screen.getByRole('status', { name: 'Un Projet illisible, absent de ces chiffres' });

    expect(none).not.toBe(named);
    expect(within(none).getByText(/Les métriques se calculent depuis l’historique Dolt/)).toBeTruthy();
    expect(within(named).getByText('beads-desktop')).toBeTruthy();
    expect(within(named).getByText(/Base Dolt verrouillée/)).toBeTruthy();
  });

  it('plusieurs Projets illisibles : le titre le dit au pluriel, et chacun est cité une fois', async () => {
    api(metricsFixture({ unreadable }));
    renderApp('/p/bdesk/metrics');

    const notice = await screen.findByRole('status', { name: '2 Projets illisibles, absents de ces chiffres' });

    expect(within(notice).getAllByRole('listitem')).toHaveLength(2);
    expect(within(notice).getAllByText('My-Prompt-Manager')).toHaveLength(1);
    expect(notice.textContent).toBe('2 Projets illisibles, absents de ces chiffresbeads-desktop : Base Dolt verrouilléeMy-Prompt-Manager : Base Dolt absente');
  });
});
