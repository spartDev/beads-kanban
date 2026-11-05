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
import { withTimeZone } from '../test/timeZone';

/**
 * La page Métriques d'un Projet, montée dans l'application entière (routes, shell, données) devant un faux serveur.
 * Les chiffres viennent du faux `GET /api/metrics` : la page n'en invente aucun.
 */

const api = (reply: (url: URL) => MetricsReply | Promise<MetricsReply> = () => metricsFixture()) =>
  stubMetricsApi({ projects: projectsResponse, issues: { bdesk: bdeskIssues, mpm: mpmIssues } }, reply);

/**
 * Un faux serveur qui compte dans le fuseau qu'on lui demande, comme le vrai quand il le connaît. Les fixtures disent `Europe/Paris` : une page à un autre
 * fuseau y verrait un serveur qui ne connaît pas le sien (voir le dernier bloc de ce fichier).
 */
const inRequestedZone = (url: URL) => metricsFixture({ timeZone: url.searchParams.get('timeZone') ?? 'Zone du serveur' });

// La vue des métriques est chargée à la demande : on lit son module une fois, hors du délai des attentes des tests.
warmUpMetricsPages();

// Le navigateur est à Paris, comme les fixtures : la page compte « aujourd'hui » dans son fuseau et le donne au serveur (`timeZone`, bdesk-38k.48).
withTimeZone('Europe/Paris');

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

    expect(metricsRequests(fetchMock)).toEqual(['/api/metrics?project=bdesk&range=30d&timeZone=Europe%2FParis']);
    expect(screen.getByRole('heading', { level: 1, name: 'Métriques' })).toBeTruthy();
    // Six indicateurs, puis cinq tuiles de santé du flux.
    expect(screen.getAllByRole('article')).toHaveLength(11);
    for (const chart of ['Flux cumulé', 'Débit', 'Cycle Time', 'Âge des tickets en cours']) {
      expect(screen.getByRole('region', { name: chart })).toBeTruthy();
    }
    expect(screen.getByRole('heading', { level: 2, name: 'Santé du flux' })).toBeTruthy();
    expect(screen.getByRole('heading', { level: 2, name: 'Analyse du flux' })).toBeTruthy();
    for (const chart of ['Arrivées et Débit cumulés', 'Décomposition du Lead Time', 'Répartition par type', 'Carte d’activité', 'Prêts qui stagnent']) {
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

  it('affiche les sept métriques de flux additionnelles de la réponse, telles quelles', async () => {
    api();
    await loaded();

    // 1. Arrivées vs Débit : 20 Arrivées pour 18 Livraisons.
    expect(plain(page().getByRole('article', { name: 'Arrivées vs Débit' }).textContent)).toContain('+2Arrivées moins Débit');
    expect(page().getByRole('region', { name: 'Arrivées et Débit cumulés' })).toBeTruthy();
    // 2. Répartition par type.
    expect(page().getByRole('region', { name: 'Répartition par type' })).toBeTruthy();
    // 3. Efficacité du flux.
    expect(plain(page().getByRole('article', { name: 'Efficacité du flux' }).textContent)).toContain('91,9 %du Cycle Time hors Blocage');
    // 4. Taux de Réouverture.
    expect(plain(page().getByRole('article', { name: 'Taux de Réouverture' }).textContent)).toContain('9,5 %2 sur 21 clôtures suivies d’une Réouverture');
    // 5. Âge des Prêts qui stagnent.
    expect(plain(page().getByRole('article', { name: 'Prêts qui stagnent' }).textContent)).toContain('3sur 5 Prêts, depuis plus de 14 j');
    expect(within(page().getByRole('list', { name: 'Prêts, du plus ancien au plus récent' })).getAllByRole('listitem')).toHaveLength(5);
    // 6. Carte d'activité.
    expect(page().getByRole('img', { name: /^Carte d’activité : 100 Transitions/ })).toBeTruthy();
    // 7. Taux d'abandon.
    expect(plain(page().getByRole('article', { name: 'Taux d’abandon' }).textContent)).toContain('10 %2 sur 20 tickets fermés');
    // Et l'Attente de dépendance, dans la décomposition du Lead Time.
    expect(page().getByText(/^6 Livraisons sur 18 ont attendu une dépendance/)).toBeTruthy();
  });

  it('dit qu’il n’y a rien à mesurer plutôt que de montrer des zéros, pour chaque métrique de flux additionnelle', async () => {
    api(() => emptyMetricsFixture());
    await loaded();

    expect(plain(page().getByRole('article', { name: 'Efficacité du flux' }).textContent)).toContain('Aucune Livraison démarrée sur la période.');
    expect(plain(page().getByRole('article', { name: 'Taux de Réouverture' }).textContent)).toContain('Aucune clôture sur la période.');
    expect(plain(page().getByRole('article', { name: 'Taux d’abandon' }).textContent)).toContain('Aucun ticket fermé sur la période.');
    expect(plain(page().getByRole('article', { name: 'Prêts qui stagnent' }).textContent)).toContain('Aucun ticket Prêt.');
    expect(screen.getByText('Aucune Arrivée ni Livraison sur cette période.')).toBeTruthy();
    expect(within(screen.getByRole('region', { name: 'Décomposition du Lead Time' })).getByText('Aucune Livraison sur la période.')).toBeTruthy();
    expect(within(screen.getByRole('region', { name: 'Décomposition du Lead Time' })).queryByText('Données du graphique')).toBeNull();
    expect(screen.getByText('Aucune Arrivée, Livraison ni ticket en cours sur cette période.')).toBeTruthy();
    expect(screen.getByText('Aucune Transition sur cette période.')).toBeTruthy();
  });

  it('lit la répartition par type dans le découpage par type, quel que soit le découpage choisi pour le tableau', async () => {
    api();
    const { user } = await loaded();

    await user.click(within(screen.getByRole('group', { name: 'Découper par' })).getByRole('radio', { name: 'Priorité' }));
    await screen.findByRole('heading', { level: 2, name: 'Découpage par priorité' });

    const mix = within(page().getByRole('region', { name: 'Répartition par type' }));
    expect(mix.getByRole('img', { name: (name) => plain(name).startsWith('Livraisons : 10 Bugs') })).toBeTruthy();
    expect(mix.queryByText('P1')).toBeNull();
  });

  it('dit à quel instant les Prêts sont mesurés : maintenant tant que la période court, sa fin quand elle est terminée', async () => {
    api();
    const running = await loaded();
    expect(page().getByText(/^Les tickets ouverts sans dépendance bloquante en suspens à 20:00,/)).toBeTruthy();
    running.unmount();

    api(() => metricsFixture({ range: 'custom', asOf: '2026-11-02T23:00:00.000Z', previousAsOf: '2026-10-26T23:00:00.000Z' }));
    await loaded('/p/bdesk/metrics?from=2026-10-27&to=2026-11-02');
    expect(page().getByText(/^Les tickets ouverts sans dépendance bloquante en suspens à la fin de la période,/)).toBeTruthy();
  });

  it('colore les Prêts selon le découpage choisi, comme les âges et le nuage', async () => {
    api();
    const { user } = await loaded();

    await user.click(within(screen.getByRole('group', { name: 'Découper par' })).getByRole('radio', { name: 'Priorité' }));

    const ready = within(page().getByRole('region', { name: 'Prêts qui stagnent' }));
    expect(await ready.findByRole('list', { name: 'Couleurs : priorité' })).toBeTruthy();
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

    await waitFor(() => expect(metricsRequests(fetchMock)).toContain('/api/metrics?project=bdesk&range=7d&timeZone=Europe%2FParis'));
    expect(pathname(router)).toBe('/p/bdesk/metrics?range=7d');
    await user.click(within(period()).getByRole('radio', { name: '30 jours' }));
    // Le préréglage par défaut n'est pas écrit dans l'adresse.
    await waitFor(() => expect(pathname(router)).toBe('/p/bdesk/metrics'));
  });

  it('reprend la période et le découpage de l’adresse : un lien les partage', async () => {
    const fetchMock = api();
    await loaded('/p/bdesk/metrics?range=90d&by=priority');

    expect(metricsRequests(fetchMock)).toEqual(['/api/metrics?project=bdesk&range=90d&timeZone=Europe%2FParis']);
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

    expect(metricsRequests(fetchMock)).toEqual(['/api/metrics?project=bdesk&from=2026-10-01&to=2026-10-15&timeZone=Europe%2FParis']);
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
    await waitFor(() => expect(metricsRequests(fetchMock)).toContain('/api/metrics?project=bdesk&from=2026-10-12&to=2026-10-15&timeZone=Europe%2FParis'));
  });

  it('prévient d’un réglage de l’adresse qu’elle ne comprend pas, et affiche la période par défaut', async () => {
    const fetchMock = api();
    await loaded('/p/bdesk/metrics?range=14d&by=status');

    expect(metricsRequests(fetchMock)).toEqual(['/api/metrics?project=bdesk&range=30d&timeZone=Europe%2FParis']);
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

  it('dit « Calculé à 20:00 » : l’heure du calcul, dans le fuseau de la réponse (celui que la page a demandé)', async () => {
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
    expect(screen.getAllByRole('article')).toHaveLength(11);
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
    await act(() => queryClient.refetchQueries({ queryKey: metricsKey({ project: 'bdesk', period: { kind: 'preset', range: '30d' }, timeZone: 'Europe/Paris' }), exact: true }).catch(() => undefined));
    await waitFor(() => expect(screen.getByText(/Actualisation impossible/)).toBeTruthy());

    expect(screen.getAllByRole('article')).toHaveLength(11);
    expect(screen.queryByText('Impossible de calculer les métriques')).toBeNull();
  });

  it('explique qu’un Projet illisible l’est, sans appeler les métriques', async () => {
    const fetchMock = api();
    renderApp('/p/legacy/metrics');

    expect(await screen.findByText('Ce Projet est illisible')).toBeTruthy();
    expect(metricsRequests(fetchMock)).toEqual([]);
  });
});

// Le moteur nomme « Etc/Unknown » le fuseau d'un navigateur lancé avec TZ vide, et `Intl` refuse ce nom (bdesk-38k.48) : `Date` y compte en UTC.
describe('la page Métriques quand le navigateur ne nomme pas son fuseau (TZ vide)', () => {
  withTimeZone('');

  it('s’affiche au lieu de planter sur « Invalid time zone specified »', async () => {
    api(inRequestedZone);
    await loaded();

    expect(screen.getByRole('heading', { level: 1, name: 'Métriques' })).toBeTruthy();
    expect(screen.getAllByRole('article')).toHaveLength(11);
  });

  it('compte « aujourd’hui » en UTC, comme Date : une plage qui finit demain en UTC est refusée avant d’être demandée', async () => {
    vi.setSystemTime(new Date('2026-11-02T23:30:00.000Z')); // le 3 à 00:30 à Paris, encore le 2 en UTC
    const fetchMock = api(inRequestedZone);
    await loaded('/p/bdesk/metrics?from=2026-10-27&to=2026-11-03');

    expect(screen.getByText(/La plage dépasse aujourd’hui \(2026-11-03 > 2026-11-02\)/)).toBeTruthy();
    expect(within(period()).getByRole('radio', { name: '30 jours' })).toHaveProperty('checked', true);
    expect(metricsRequests(fetchMock)).toEqual(['/api/metrics?project=bdesk&range=30d&timeZone=UTC']); // le serveur compte en UTC, lui aussi
  });
});

/**
 * bdesk-38k.48 : un serveur lancé en UTC et un navigateur à Paris, à 00:30 heure de Paris. La page choisit « aujourd'hui » dans le fuseau de son
 * navigateur et le donne au serveur, qui compte les jours dedans : la plage qu'elle accepte est celle qu'il sert, et « 7 jours » finit aujourd'hui.
 * Les chiffres de la réponse sont écrits dans le fuseau qu'elle porte : ici, celui que la page a demandé.
 */
describe('la page Métriques et le serveur comptent dans le même fuseau : celui du navigateur', () => {
  // 23:30 UTC le 4 novembre : déjà le 5 à Paris (00:30) et à Tokyo (08:30), encore le 4 à Honolulu (13:30).
  const LATE = new Date('2026-11-04T23:30:00.000Z');

  describe('à Paris, à 00:30', () => {
    withTimeZone('Europe/Paris');

    it('accepte la plage qui finit aujourd’hui, jeudi 5, et la demande dans le fuseau de Paris', async () => {
      vi.setSystemTime(LATE);
      const fetchMock = api(inRequestedZone);
      await loaded('/p/bdesk/metrics?from=2026-10-30&to=2026-11-05');

      expect(screen.queryByText('Réglages de l’adresse ignorés')).toBeNull();
      expect(metricsRequests(fetchMock)).toEqual(['/api/metrics?project=bdesk&from=2026-10-30&to=2026-11-05&timeZone=Europe%2FParis']);
      expect(screen.getByTitle('Fuseau Europe/Paris')).toBeTruthy();
    });

    it('demande « 7 jours » dans le fuseau de Paris : le serveur finit la période aujourd’hui pour l’utilisateur', async () => {
      vi.setSystemTime(LATE);
      const fetchMock = api(inRequestedZone);
      const { user } = await loaded();

      await user.click(within(period()).getByRole('radio', { name: '7 jours' }));

      await waitFor(() => expect(metricsRequests(fetchMock)).toContain('/api/metrics?project=bdesk&range=7d&timeZone=Europe%2FParis'));
    });
  });

  describe('à Tokyo, au même instant (jeudi 5, 08:30)', () => {
    withTimeZone('Asia/Tokyo');

    it('compte « aujourd’hui » le 5 et le dit au serveur : la même plage est acceptée, dans le fuseau de Tokyo', async () => {
      vi.setSystemTime(LATE);
      const fetchMock = api(inRequestedZone);
      await loaded('/p/bdesk/metrics?from=2026-10-30&to=2026-11-05');

      expect(screen.queryByText('Réglages de l’adresse ignorés')).toBeNull();
      expect(metricsRequests(fetchMock)).toEqual(['/api/metrics?project=bdesk&from=2026-10-30&to=2026-11-05&timeZone=Asia%2FTokyo']);
      expect(screen.getByTitle('Fuseau Asia/Tokyo')).toBeTruthy();
    });
  });

  describe('à Honolulu, au même instant (mercredi 4, 13:30)', () => {
    withTimeZone('Pacific/Honolulu');

    it('refuse la même plage, qui finit demain : elle n’est même pas demandée', async () => {
      vi.setSystemTime(LATE);
      const fetchMock = api(inRequestedZone);
      await loaded('/p/bdesk/metrics?from=2026-10-30&to=2026-11-05');

      expect(screen.getByText(/La plage dépasse aujourd’hui \(2026-11-05 > 2026-11-04\)/)).toBeTruthy();
      expect(metricsRequests(fetchMock)).toEqual(['/api/metrics?project=bdesk&range=30d&timeZone=Pacific%2FHonolulu']);
    });
  });
});

/**
 * Relecture de bdesk-38k.48, bug 1 : Chromium connaît `America/Coyhaique` (tz 2025b), Node 22.13 non. Le serveur ne refuse plus (400) un fuseau qu'il
 * ne connaît pas : il compte dans le sien et le nomme dans `timeZone`. La page compare ce nom à celui qu'elle a demandé, le dit, et compte « aujourd'hui »
 * dans le fuseau de la réponse, pour que les plages qu'elle accepte soient celles que le serveur sert.
 */
describe('la page Métriques quand le serveur ne connaît pas le fuseau du navigateur', () => {
  // 23:30 UTC le 4 novembre : le 5 à 00:30 à Paris, encore le 4 à UTC.
  const LATE = new Date('2026-11-04T23:30:00.000Z');
  /** Le serveur ne connaît pas le fuseau demandé : il compte dans le sien, UTC, et le dit. */
  const serverInUtc = () => metricsFixture({ timeZone: 'UTC' });
  const NOTICE = 'Le serveur ne connaît pas votre fuseau, Europe/Paris';
  const customTo = () => screen.getByLabelText('Au') as HTMLInputElement;

  withTimeZone('Europe/Paris');

  it('dit que le serveur ne connaît pas le fuseau du navigateur et dans quel fuseau les jours sont comptés', async () => {
    vi.setSystemTime(LATE);
    api(serverInUtc);
    await loaded();

    // Une région de statut nommée par son titre (bdesk-38k.61) : un lecteur d'écran dit de quoi elle parle.
    const notice = await screen.findByRole('status', { name: NOTICE });
    expect(plain(notice.textContent)).toContain('Les jours, les semaines et les heures de ces chiffres sont comptés en UTC, le fuseau du serveur.');
    expect(screen.getByRole('heading', { level: 2, name: 'Indicateurs' })).toBeTruthy(); // les chiffres sont là : la page n'est pas en panne
  });

  it('compte « aujourd’hui » dans le fuseau de la réponse : une plage ne dépasse pas le jour du serveur (le 4), pas celui de Paris (le 5)', async () => {
    vi.setSystemTime(LATE);
    api(serverInUtc);
    const { user } = await loaded();
    await screen.findByText(NOTICE);

    await user.click(within(period()).getByRole('radio', { name: 'Personnalisée' }));

    expect(customTo().max).toBe('2026-11-04');
    expect(customTo().max).not.toBe('2026-11-05');
  });

  it('refuse alors la plage de l’adresse qui finit le 5, jour de Paris, que le serveur compterait dans le futur : elle n’est pas redemandée', async () => {
    vi.setSystemTime(LATE);
    const fetchMock = api(serverInUtc);
    await loaded('/p/bdesk/metrics?from=2026-10-30&to=2026-11-05');

    expect(await screen.findByText(/La plage dépasse aujourd’hui \(2026-11-05 > 2026-11-04\)/)).toBeTruthy();
    await waitFor(() => expect(metricsRequests(fetchMock).at(-1)).toBe('/api/metrics?project=bdesk&range=30d&timeZone=Europe%2FParis'));
  });

  it('continue de demander le fuseau du navigateur : un serveur qui le connaîtra plus tard le comptera', async () => {
    vi.setSystemTime(LATE);
    const fetchMock = api(serverInUtc);
    const { user } = await loaded();
    await screen.findByText(NOTICE);

    await user.click(screen.getByRole('button', { name: 'Actualiser les métriques' }));

    await waitFor(() => expect(metricsRequests(fetchMock)).toHaveLength(2));
    expect(new Set(metricsRequests(fetchMock))).toEqual(new Set(['/api/metrics?project=bdesk&range=30d&timeZone=Europe%2FParis']));
  });

  it('ne dit rien et compte « aujourd’hui » à Paris quand le serveur compte dans le fuseau demandé', async () => {
    vi.setSystemTime(LATE);
    api(inRequestedZone);
    const { user } = await loaded();

    await user.click(within(period()).getByRole('radio', { name: 'Personnalisée' }));

    expect(screen.queryByText(NOTICE)).toBeNull();
    expect(customTo().max).toBe('2026-11-05');
  });

  it('ne tient pas pour la réponse à un autre fuseau demandé ce que le serveur a répondu au précédent : le navigateur change de fuseau, la page compte dans le nouveau en attendant', async () => {
    vi.setSystemTime(LATE); // le 5 à 08:30 à Tokyo, le 5 à 00:30 à Paris, le 4 à 23:30 en UTC
    let release: (() => void) | undefined;
    const fetchMock = api((url) => {
      if (url.searchParams.get('timeZone') !== 'Asia/Tokyo') return serverInUtc(); // Paris : le serveur ne le connaît pas, il compte en UTC
      return new Promise<MetricsReply>((resolve) => (release = () => resolve(metricsFixture({ timeZone: 'Asia/Tokyo' })))); // Tokyo : il le connaît, mais répond tard
    });
    const { user } = await loaded();
    await screen.findByText(NOTICE);

    try {
      process.env.TZ = 'Asia/Tokyo'; // le fuseau du navigateur change pendant que la page est ouverte ; un réglage de la période relance le rendu
      await user.click(within(period()).getByRole('radio', { name: '7 jours' }));
      await waitFor(() => expect(metricsRequests(fetchMock).at(-1)).toBe('/api/metrics?project=bdesk&range=7d&timeZone=Asia%2FTokyo'));
      // Les chiffres gardés en attendant sont ceux de la réponse en UTC, pour Paris : ils ne disent rien de Tokyo.
      expect(screen.queryByText(/Le serveur ne connaît pas votre fuseau/)).toBeNull();

      await user.click(within(period()).getByRole('radio', { name: 'Personnalisée' }));
      expect(customTo().max).toBe('2026-11-05'); // aujourd'hui à Tokyo, le nouveau fuseau demandé : ni le 4, jour d'UTC, ni attendre la réponse
      await waitFor(() => expect(metricsRequests(fetchMock).at(-1)).toContain('timeZone=Asia%2FTokyo'));

      await act(async () => release?.());
      await waitFor(() => expect(screen.getByTitle('Fuseau Asia/Tokyo')).toBeTruthy());
      expect(screen.queryByText(/Le serveur ne connaît pas votre fuseau/)).toBeNull();
    } finally {
      process.env.TZ = 'Europe/Paris';
    }
  });

  describe('et le même fuseau sous un autre nom', () => {
    withTimeZone('UTC');

    it('ne dit rien quand le serveur nomme le fuseau demandé d’un autre nom (UTC et Etc/UTC)', async () => {
      vi.setSystemTime(LATE);
      api(() => metricsFixture({ timeZone: 'Etc/UTC' }));
      await loaded();

      expect(screen.queryByText(/Le serveur ne connaît pas votre fuseau/)).toBeNull();
      expect(screen.getByTitle('Fuseau Etc/UTC')).toBeTruthy(); // les chiffres sont écrits dans le fuseau de la réponse
    });
  });
});
