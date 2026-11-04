import { screen, waitFor, within } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { metricsFixture, metricsRequests, plain, stubChartWidth, stubMetricsApi, warmUpMetricsPages, type MetricsReply } from '../metrics/testing';
import { bdeskIssues, mpmIssues, projectsResponse } from '../test/fixtures';
import { renderApp } from '../test/render';

/**
 * La Vue globale : les métriques de tous les Projets, recalculées sur l'union de leurs tickets (le serveur le fait, la
 * page n'additionne rien), puis la liste des Projets suivis qui existait avant.
 */

const api = (reply: (url: URL) => MetricsReply | Promise<MetricsReply> = () => metricsFixture()) =>
  stubMetricsApi({ projects: projectsResponse, issues: { bdesk: bdeskIssues, mpm: mpmIssues } }, reply);

// La vue des métriques est chargée à la demande : on lit son module une fois, hors du délai des attentes des tests.
warmUpMetricsPages();

// Seule `Date` est figée (le 2 novembre 2026, 20:00 à Paris, l'instant des fixtures) : les minuteries de React Query et de
// Radix restent réelles. La page lit la date du jour pour refuser une plage qui la dépasse.
beforeEach(() => {
  vi.useFakeTimers({ toFake: ['Date'] });
  vi.setSystemTime(new Date('2026-11-02T19:00:15.242Z'));
  stubChartWidth(640);
});
afterEach(() => {
  vi.useRealTimers();
  vi.restoreAllMocks();
});

const page = () => within(screen.getByRole('main'));

async function loaded(path = '/') {
  const app = renderApp(path);
  await screen.findByRole('heading', { level: 2, name: 'Indicateurs' });
  return app;
}

describe('la Vue globale', () => {
  it('demande les métriques sans Projet : tous les Projets lisibles', async () => {
    const fetchMock = api();
    await loaded();

    expect(metricsRequests(fetchMock)).toEqual(['/api/metrics?range=30d']);
    expect(screen.getByRole('heading', { level: 1, name: 'Vue globale' })).toBeTruthy();
    expect(screen.getAllByRole('article')).toHaveLength(11);
    expect(plain(page().getByRole('article', { name: 'Débit' }).textContent)).toContain('18Livraisons sur la période');
    await waitFor(() => expect(document.title).toBe('Vue globale · beads-desktop'));
  });

  it('montre la santé du flux de l’ensemble des Projets, et nomme le Projet de chaque Prêt', async () => {
    api();
    await loaded();

    expect(screen.getByRole('heading', { level: 2, name: 'Santé du flux' })).toBeTruthy();
    for (const tile of ['Arrivées vs Débit', 'Efficacité du flux', 'Taux de Réouverture', 'Taux d’abandon', 'Prêts qui stagnent']) {
      expect(page().getByRole('article', { name: tile })).toBeTruthy();
    }
    const ready = within(page().getByRole('list', { name: 'Prêts, du plus ancien au plus récent' }));
    // Les Prêts de deux Projets dans une même liste : on dit lequel est lequel.
    expect(ready.getAllByRole('listitem').map((item) => /My-Prompt-Manager|beads-desktop/.exec(plain(item.textContent))?.[0])).toEqual([
      'My-Prompt-Manager',
      'My-Prompt-Manager',
      'beads-desktop',
      'My-Prompt-Manager',
      'beads-desktop',
    ]);
  });

  it('découpe par Projet par défaut, avec une ligne par Projet mesuré', async () => {
    api();
    await loaded();

    expect(screen.getByRole('heading', { level: 2, name: 'Découpage par projet' })).toBeTruthy();
    const table = screen.getByRole('table', { name: 'Métriques de la période par projet' });
    expect(within(table).getAllByRole('rowheader').map((header) => header.textContent)).toEqual(['beads-desktop', 'My-Prompt-Manager', 'Ensemble']);
    expect(within(screen.getByRole('group', { name: 'Découper par' })).getByRole('radio', { name: 'Projet' })).toHaveProperty('checked', true);
  });

  it('propose les trois découpages, et colore les graphiques par Projet', async () => {
    api();
    await loaded();

    const options = within(screen.getByRole('group', { name: 'Découper par' })).getAllByRole('radio');
    expect(options.map((option) => option.parentElement?.textContent)).toEqual(['Type', 'Priorité', 'Projet']);
    expect(screen.getAllByRole('list', { name: 'Couleurs : projet' }).length).toBeGreaterThan(0);
  });

  it('mène chaque Projet du tableau à sa page Métriques, période conservée', async () => {
    api();
    const { user, router } = await loaded('/?range=7d');

    const table = screen.getByRole('table', { name: 'Métriques de la période par projet' });
    const link = within(table).getByRole('link', { name: 'My-Prompt-Manager' });
    expect(link.getAttribute('href')).toBe('/p/mpm/metrics?range=7d');

    await user.click(link);
    await waitFor(() => expect(router.state.location.pathname + router.state.location.search).toBe('/p/mpm/metrics?range=7d'));
  });

  it('signale un Projet illisible de la réponse sans faire échouer la Vue globale', async () => {
    api(() => metricsFixture({ unreadable: [{ id: 'hcpportal-front-web', name: 'hcpportal-front-web', reason: 'Base Dolt absente de ce poste' }] }));
    await loaded();

    expect(screen.getByText('Un Projet illisible, absent de ces chiffres')).toBeTruthy();
    expect(screen.getAllByRole('article')).toHaveLength(11);
  });

  it('garde la liste des Projets suivis, avec leur état et les dossiers ignorés', async () => {
    api();
    const { user } = await loaded();

    expect(await page().findByRole('heading', { level: 2, name: 'Projets suivis' })).toBeTruthy();
    const tracked = within(page().getByRole('region', { name: 'Projets suivis' }));
    expect(tracked.getByRole('link', { name: /My-Prompt-Manager/ })).toBeTruthy();
    expect(tracked.getByText('Base Dolt verrouillée par un autre processus')).toBeTruthy();
    await user.click(page().getByText('1 dossier ignoré'));
    expect(page().getByText('/dev/notes')).toBeTruthy();
  });

  it('affiche la liste des Projets même quand le calcul des métriques échoue', async () => {
    api(() => new Error('database is locked'));
    renderApp('/');

    expect(await screen.findByText('Impossible de calculer les métriques')).toBeTruthy();
    expect(await within(page().getByRole('region', { name: 'Projets suivis' })).findByRole('link', { name: /My-Prompt-Manager/ })).toBeTruthy();
  });

  it('reprend la période de l’adresse', async () => {
    const fetchMock = api();
    await loaded('/?range=90d&by=type');

    expect(metricsRequests(fetchMock)).toEqual(['/api/metrics?range=90d']);
    expect(screen.getByRole('heading', { level: 2, name: 'Découpage par type' })).toBeTruthy();
  });

  it('ne propose pas, en Vue globale, un découpage inconnu : retombe sur celui par Projet, en le disant', async () => {
    api();
    await loaded('/?by=status');

    expect(screen.getByText(/Le découpage « status » n’existe pas/)).toBeTruthy();
    expect(screen.getByRole('heading', { level: 2, name: 'Découpage par projet' })).toBeTruthy();
  });
});
