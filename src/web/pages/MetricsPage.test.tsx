import { act, fireEvent, screen, waitFor, within } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { metricsKey } from '../metrics/api';
import {
  emptyMetricsFixture,
  httpFailure,
  metricsFixture,
  metricsRequests,
  plain,
  stubChartWidth,
  stubMetricsApi,
  warmUpMetricsPages,
  weeklyMetricsFixture,
  type MetricsReply,
} from '../metrics/testing';
import { bdeskIssues, mpmIssues, projectsResponse } from '../test/fixtures';
import { renderApp } from '../test/render';

/**
 * La page Métriques d'un Projet, montée dans l'application entière (routes, shell, données) devant un faux serveur.
 * Les chiffres viennent du faux `GET /api/metrics` : la page n'en invente aucun.
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
const pathname = (router: { state: { location: { pathname: string; search: string } } }) => router.state.location.pathname + router.state.location.search;
const period = () => screen.getByRole('group', { name: 'Période' });

async function loaded(path = '/p/bdesk/metrics') {
  const app = renderApp(path);
  await screen.findByRole('heading', { level: 2, name: 'Indicateurs' });
  return app;
}

describe('la page Métriques d’un Projet', () => {
  it('demande les 30 derniers jours du Projet et affiche tuiles, graphiques et découpage', async () => {
    const fetchMock = api();
    await loaded();

    expect(metricsRequests(fetchMock)).toEqual(['/api/metrics?project=bdesk&range=30d']);
    expect(screen.getByRole('heading', { level: 1, name: 'Métriques' })).toBeTruthy();
    expect(screen.getAllByRole('article')).toHaveLength(6);
    for (const chart of ['Flux cumulé', 'Débit', 'Cycle Time', 'Âge des tickets en cours']) {
      expect(screen.getByRole('region', { name: chart })).toBeTruthy();
    }
    expect(screen.getByRole('heading', { level: 2, name: 'Découpage par type' })).toBeTruthy();
    await waitFor(() => expect(document.title).toBe('Métriques · beads-desktop · beads-desktop'));
  });

  it('affiche les chiffres de la réponse, tels quels', async () => {
    api();
    await loaded();

    const debit = page().getByRole('article', { name: 'Débit' });
    expect(plain(debit.textContent)).toContain('18Livraisons sur la période');
    expect(plain(page().getByRole('article', { name: 'Lead Time' }).textContent)).toContain('6,9 jmédiane');
    expect(plain(page().getByRole('article', { name: 'WIP' }).textContent)).toContain('11en cours à 20:00');
  });

  it('annonce le chargement comme un statut nommé, puis le retire', async () => {
    let release: (() => void) | undefined;
    api(() => new Promise<MetricsReply>((resolve) => (release = () => resolve(metricsFixture()))));
    renderApp('/p/bdesk/metrics');

    const status = await screen.findByRole('status', { name: 'Chargement des métriques' });
    expect(status.getAttribute('aria-busy')).toBe('true');
    // Les réglages restent utilisables pendant le calcul.
    expect(period()).toBeTruthy();

    release?.();
    await screen.findByRole('heading', { level: 2, name: 'Indicateurs' });
    expect(screen.queryByRole('status', { name: 'Chargement des métriques' })).toBeNull();
  });

  it('change de période au clic : l’adresse la retient, le serveur la reçoit', async () => {
    const fetchMock = api();
    const { user, router } = await loaded();

    await user.click(within(period()).getByRole('radio', { name: '7 jours' }));

    await waitFor(() => expect(metricsRequests(fetchMock)).toContain('/api/metrics?project=bdesk&range=7d'));
    expect(pathname(router)).toBe('/p/bdesk/metrics?range=7d');
    await user.click(within(period()).getByRole('radio', { name: '30 jours' }));
    // Le préréglage par défaut n'est pas écrit dans l'adresse.
    await waitFor(() => expect(pathname(router)).toBe('/p/bdesk/metrics'));
  });

  it('reprend la période et le découpage de l’adresse : un lien les partage', async () => {
    const fetchMock = api();
    await loaded('/p/bdesk/metrics?range=90d&by=priority');

    expect(metricsRequests(fetchMock)).toEqual(['/api/metrics?project=bdesk&range=90d']);
    expect(within(period()).getByRole('radio', { name: '90 jours' })).toHaveProperty('checked', true);
    expect(screen.getByRole('heading', { level: 2, name: 'Découpage par priorité' })).toBeTruthy();
    expect(within(screen.getByRole('group', { name: 'Découper par' })).getByRole('radio', { name: 'Priorité' })).toHaveProperty('checked', true);
  });

  it('remplace l’entrée d’historique à chaque réglage : « Retour » quitte la page au lieu de rejouer les réglages', async () => {
    api();
    const { user, router } = renderApp('/p/bdesk/kanban');
    await screen.findByRole('heading', { level: 1, name: 'Kanban' });
    await act(async () => void router.navigate('/p/bdesk/metrics'));
    await screen.findByRole('heading', { level: 2, name: 'Indicateurs' });

    await user.click(within(period()).getByRole('radio', { name: '7 jours' }));
    await waitFor(() => expect(pathname(router)).toBe('/p/bdesk/metrics?range=7d'));
    expect(router.state.historyAction).toBe('REPLACE');

    await user.click(within(screen.getByRole('group', { name: 'Découper par' })).getByRole('radio', { name: 'Priorité' }));
    await waitFor(() => expect(pathname(router)).toBe('/p/bdesk/metrics?range=7d&by=priority'));
    expect(router.state.historyAction).toBe('REPLACE');

    // Deux réglages plus tard, une seule entrée a été ajoutée : « Retour » revient au kanban.
    await act(async () => void router.navigate(-1));
    await waitFor(() => expect(pathname(router)).toBe('/p/bdesk/kanban'));
  });

  it('découpe par priorité : le tableau et la légende des couleurs suivent', async () => {
    api();
    const { user } = await loaded();

    await user.click(within(screen.getByRole('group', { name: 'Découper par' })).getByRole('radio', { name: 'Priorité' }));

    expect(await screen.findByRole('heading', { level: 2, name: 'Découpage par priorité' })).toBeTruthy();
    expect(screen.getAllByRole('list', { name: 'Couleurs : priorité' }).length).toBeGreaterThan(0);
    expect(screen.getByRole('table', { name: 'Métriques de la période par priorité' })).toBeTruthy();
  });

  it('une plage personnalisée de l’adresse part au serveur en « from » et « to »', async () => {
    const fetchMock = api(() => metricsFixture({ range: 'custom' }));
    await loaded('/p/bdesk/metrics?from=2026-10-01&to=2026-10-15');

    expect(metricsRequests(fetchMock)).toEqual(['/api/metrics?project=bdesk&from=2026-10-01&to=2026-10-15']);
    expect(within(period()).getByRole('radio', { name: 'Personnalisée' })).toHaveProperty('checked', true);
    expect((screen.getByLabelText('Du') as HTMLInputElement).value).toBe('2026-10-01');
  });

  it('garde le focus dans le champ « Du » quand on le règle au clavier : chaque jour valable s’applique sans remplacer le champ', async () => {
    const fetchMock = api(() => metricsFixture({ range: 'custom' }));
    const { router } = await loaded('/p/bdesk/metrics?from=2026-10-01&to=2026-10-15');
    const from = screen.getByLabelText('Du') as HTMLInputElement;
    act(() => from.focus());
    expect(document.activeElement).toBe(from);

    // Ce que fait Chromium à chaque segment tapé au clavier (jour, mois, année) : un événement change avec une date complète.
    // Taper « 1 » puis « 2 » pour avoir le 12 donne d'abord le 1er (déjà une date valable), puis le 12.
    fireEvent.change(from, { target: { value: '2026-10-02' } });
    await waitFor(() => expect(pathname(router)).toBe('/p/bdesk/metrics?from=2026-10-02&to=2026-10-15'));

    // L'utilisateur continue de taper : le champ est resté le même, et le focus avec lui.
    expect(document.activeElement).toBe(from);
    expect(document.activeElement?.getAttribute('type')).toBe('date');
    expect(screen.getByLabelText('Du')).toBe(from);

    fireEvent.change(from, { target: { value: '2026-10-12' } });
    await waitFor(() => expect(pathname(router)).toBe('/p/bdesk/metrics?from=2026-10-12&to=2026-10-15'));
    expect(document.activeElement).toBe(from);
    expect(from.value).toBe('2026-10-12');
    await waitFor(() => expect(metricsRequests(fetchMock)).toContain('/api/metrics?project=bdesk&from=2026-10-12&to=2026-10-15'));
  });

  it('prévient d’un réglage de l’adresse qu’elle ne comprend pas, et affiche la période par défaut', async () => {
    const fetchMock = api();
    await loaded('/p/bdesk/metrics?range=14d&by=status');

    expect(metricsRequests(fetchMock)).toEqual(['/api/metrics?project=bdesk&range=30d']);
    expect(screen.getByText('Réglages de l’adresse ignorés')).toBeTruthy();
    expect(screen.getByText(/La période « 14d » n’existe pas/)).toBeTruthy();
    expect(screen.getByText(/Le découpage « status » n’existe pas/)).toBeTruthy();
  });

  it('garde les chiffres précédents, atténués, en attendant ceux de la nouvelle période', async () => {
    let release: (() => void) | undefined;
    api((url) => {
      if (url.searchParams.get('range') === '7d') return new Promise<MetricsReply>((resolve) => (release = () => resolve(metricsFixture())));
      return metricsFixture({ range: '30d' });
    });
    const { user } = await loaded();
    const throughput = () => plain(page().getByRole('article', { name: 'Débit' }).textContent);
    expect(throughput()).toContain('18');

    await user.click(within(period()).getByRole('radio', { name: '7 jours' }));

    await waitFor(() => expect(document.querySelector('[aria-busy="true"]')).not.toBeNull());
    expect(throughput()).toContain('18');
    expect(screen.queryByRole('status', { name: 'Chargement des métriques' })).toBeNull();

    await act(async () => release?.());
    await waitFor(() => expect(document.querySelector('[aria-busy="true"]')).toBeNull());
  });

  it('recalcule à la demande avec « Actualiser »', async () => {
    const fetchMock = api();
    const { user } = await loaded();
    expect(metricsRequests(fetchMock)).toHaveLength(1);

    await user.click(screen.getByRole('button', { name: 'Actualiser les métriques' }));

    await waitFor(() => expect(metricsRequests(fetchMock)).toHaveLength(2));
  });

  it('dit « Calculé à 20:00 » : l’heure du calcul, dans le fuseau du serveur', async () => {
    api();
    await loaded();
    expect(screen.getByText('Calculé à 20:00')).toBeTruthy();
  });
});

describe('états de la page Métriques', () => {
  it('signale une erreur du serveur et propose de réessayer', async () => {
    let healthy = false;
    api(() => (healthy ? metricsFixture() : new Error('database is locked')));
    const { user } = renderApp('/p/bdesk/metrics');

    expect(await screen.findByText('Impossible de calculer les métriques')).toBeTruthy();
    expect(screen.getByText('database is locked')).toBeTruthy();
    // Les réglages restent à l'écran.
    expect(period()).toBeTruthy();

    healthy = true;
    await user.click(page().getByRole('button', { name: /Réessayer/ }));
    expect(await screen.findByRole('heading', { level: 2, name: 'Indicateurs' })).toBeTruthy();
  });

  it('rend le message du serveur quand il refuse la plage (400)', async () => {
    api(() => httpFailure(400, { statusCode: 400, error: 'Bad Request', message: 'La plage est trop longue : 400 jours, au plus 366.' }));
    renderApp('/p/bdesk/metrics?from=2025-10-01&to=2026-10-31');

    expect(await screen.findByText('La plage est trop longue : 400 jours, au plus 366.')).toBeTruthy();
  });

  it('signale un Projet illisible dans la réponse, sans faire échouer le reste', async () => {
    api(() =>
      metricsFixture({
        projects: [{ id: 'bdesk', name: 'beads-desktop' }],
        unreadable: [{ id: 'mpm', name: 'My-Prompt-Manager', reason: 'Base Dolt verrouillée par un autre processus' }],
      }),
    );
    await loaded();

    const notice = screen.getByText('Un Projet illisible, absent de ces chiffres');
    expect(notice).toBeTruthy();
    expect(plain(notice.closest('[role="status"]')?.textContent)).toContain('My-Prompt-Manager : Base Dolt verrouillée par un autre processus');
    expect(screen.getAllByRole('article')).toHaveLength(6);
  });

  it('dit qu’aucun Projet n’a pu être mesuré, au lieu de montrer des zéros', async () => {
    api(() =>
      metricsFixture({
        projects: [],
        unreadable: [{ id: 'bdesk', name: 'beads-desktop', reason: 'Base Dolt verrouillée' }],
      }),
    );
    renderApp('/p/bdesk/metrics');

    expect(await screen.findByText('Aucun Projet n’a pu être mesuré')).toBeTruthy();
    expect(screen.getByText('Un Projet illisible, absent de ces chiffres')).toBeTruthy();
    expect(screen.queryByRole('article')).toBeNull();
  });

  it('dit « aucune Livraison » partout quand le Projet n’a rien livré sur la période', async () => {
    api(() => emptyMetricsFixture());
    await loaded();

    expect(page().getAllByText(/Aucune Livraison/).length).toBeGreaterThanOrEqual(3);
    expect(screen.getByText('Aucun ticket en cours.')).toBeTruthy();
    expect(screen.getByText('Aucun ticket sur cette période.')).toBeTruthy();
    expect(screen.getByText('Aucune Livraison sur cette période.')).toBeTruthy();
  });

  it('indique la tuile non significative : le Taux d’échec, avec la raison de l’API', async () => {
    api();
    await loaded();

    const failure = page().getByRole('article', { name: 'Taux d’échec' });
    expect(failure.hasAttribute('data-indicative')).toBe(true);
    expect(plain(failure.textContent)).toContain('Non significatif');
    expect(plain(failure.textContent)).toContain('Couverture insuffisante : 19 % des bugs ont une origine renseignée (minimum 50 %).');
  });

  it('explique la comparaison à la période précédente, période en cours comprise', async () => {
    api();
    await loaded();

    expect(plain(page().getByText(/^Période en cours/).textContent)).toBe(
      'Période en cours (27 oct. – 2 nov. 2026), comptée jusqu’au 2 nov. à 20:00. ' +
        'Les tendances la comparent à la période précédente (20 oct. – 26 oct. 2026) à durée écoulée égale, c’est-à-dire jusqu’au 26 oct. à 19:00.',
    );
  });

  it('signale les tranches incomplètes de l’histogramme sur 90 jours', async () => {
    api(() => weeklyMetricsFixture());
    await loaded('/p/bdesk/metrics?range=90d');

    expect(within(screen.getByRole('list', { name: 'Légende du Débit' })).getByText('Semaine incomplète ou en cours')).toBeTruthy();
  });

  it('ne montre pas les chiffres d’un autre Projet en attendant ceux du Projet ouvert', async () => {
    let release: (() => void) | undefined;
    api((url) => {
      if (url.searchParams.get('project') === 'mpm') return new Promise<MetricsReply>((resolve) => (release = () => resolve(metricsFixture())));
      return metricsFixture();
    });
    const { router } = await loaded('/p/bdesk/metrics');

    await act(async () => void router.navigate('/p/mpm/metrics'));

    expect(await screen.findByRole('status', { name: 'Chargement des métriques' })).toBeTruthy();
    expect(screen.queryByRole('article')).toBeNull();
    await act(async () => release?.());
    await screen.findByRole('heading', { level: 2, name: 'Indicateurs' });
  });

  it('garde les chiffres à l’écran quand un rafraîchissement échoue, et le bandeau du shell le dit', async () => {
    let fail = false;
    api(() => (fail ? new Error('database is locked') : metricsFixture()));
    const { queryClient } = await loaded();

    fail = true;
    await act(() => queryClient.refetchQueries({ queryKey: metricsKey({ project: 'bdesk', period: { kind: 'preset', range: '30d' } }), exact: true }).catch(() => undefined));
    await waitFor(() => expect(screen.getByText(/Actualisation impossible/)).toBeTruthy());

    expect(screen.getAllByRole('article')).toHaveLength(6);
    expect(screen.queryByText('Impossible de calculer les métriques')).toBeNull();
  });

  it('explique qu’un Projet illisible l’est, sans appeler les métriques', async () => {
    const fetchMock = api();
    renderApp('/p/legacy/metrics');

    expect(await screen.findByText('Ce Projet est illisible')).toBeTruthy();
    expect(metricsRequests(fetchMock)).toEqual([]);
  });
});
