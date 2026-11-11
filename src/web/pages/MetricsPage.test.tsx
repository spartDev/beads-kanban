import type { QueryClient } from '@tanstack/react-query';
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

  it('garde les chiffres précédents à l’écran en attendant ceux de la nouvelle période', async () => {
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

  /**
   * bdesk-38k.80 : les chiffres gardés étaient atténués (`opacity-60`), et axe relevait `color-contrast` sur eux (29 nœuds à 1280 px, 133 à 375 px, en clair et en sombre).
   * Un texte à 60 % d'opacité n'atteint plus 4,5:1, ni un graphique 3:1 (WCAG 1.4.3 et 1.4.11) : ni `ink-3` ni les contours des graphiques, que `design/contrast.test.ts` et
   * `metrics/palette.test.ts` règlent au plus juste. Aucun voile, donc, sur eux ni sur ce qui les enveloppe : le chargement se dit autrement (le test suivant).
   */
  describe('pendant qu’une période se calcule', () => {
    /** Les 7 jours sont retenus, les 30 jours répondent : les chiffres des 30 jours sont gardés tant qu'on n'a pas libéré la réponse. */
    function holdSevenDays() {
      const held = { release: () => undefined as void };
      api((url) =>
        url.searchParams.get('range') === '7d'
          ? new Promise<MetricsReply>((resolve) => (held.release = () => resolve(metricsFixture())))
          : metricsFixture({ range: '30d' }),
      );
      return held;
    }
    const keptFigures = () => document.querySelector<HTMLElement>('[aria-busy="true"]');
    /** Ce qui voile un nœud : une classe d'opacité (avec ou sans variante : `md:opacity-50`, `hover:opacity-80`) ou une opacité écrite dans son style. */
    const veilOf = (node: HTMLElement) => (/(?:^|\s)(?:[^\s:]+:)*opacity-/.test(node.getAttribute('class') ?? '') || node.style.opacity !== '' ? (node.getAttribute('class') ?? '') : null);

    it('n’atténue pas les chiffres gardés : aucun voile d’opacité sur eux ni sur ce qui les enveloppe, ils gardent le contraste qu’ils ont au repos', async () => {
      const held = holdSevenDays();
      const { user } = await loaded();
      expect(plain(page().getByRole('article', { name: 'Débit' }).textContent)).toContain('18');

      await user.click(within(period()).getByRole('radio', { name: '7 jours' }));
      await waitFor(() => expect(keptFigures()).not.toBeNull());

      const kept = keptFigures() as HTMLElement;
      expect(kept.contains(page().getByRole('article', { name: 'Débit' }))).toBe(true); // ce sont bien les chiffres de l'écran
      const veils: string[] = [];
      for (let node: HTMLElement | null = kept; node; node = node.parentElement) {
        const veil = veilOf(node);
        if (veil !== null) veils.push(`<${node.tagName.toLowerCase()} class="${veil}">`);
      }
      expect(veils).toEqual([]);

      await act(async () => held.release());
      await waitFor(() => expect(keptFigures()).toBeNull());
    });

    it('dit le chargement autrement : `aria-busy`, un trait d’accent au-dessus des chiffres gardés et « Calcul en cours » dans la barre d’outils, plus l’annonce du lecteur d’écran', async () => {
      const held = holdSevenDays();
      const { user } = await loaded();
      expect(document.querySelector('.metrics-busy')).toBeNull();
      expect(screen.getByText('Calculé à 20:00')).toBeTruthy();

      await user.click(within(period()).getByRole('radio', { name: '7 jours' }));
      await waitFor(() => expect(keptFigures()).not.toBeNull());
      const kept = keptFigures() as HTMLElement;
      // Le lecteur d'écran n'attend pas : la zone `aria-live` le dit aussitôt (c'est l'annonce de bdesk-38k.48, inchangée).
      expect(document.querySelector('p[aria-live="polite"]')?.textContent).toBe('Calcul des métriques en cours…');

      // Les autres, passé un court délai (le test suivant dit pourquoi).
      const label = await screen.findByText('Calcul en cours');
      expect(label.closest('.sr-only')).toBeNull(); // à l'écran, pas réservé aux lecteurs d'écran
      expect(label.getAttribute('title')).toBe('Fuseau Europe/Paris'); // l'infobulle du fuseau reste celle de l'heure qu'il remplace
      expect(screen.queryByText(/^Calculé à/)).toBeNull();
      const bar = document.querySelector('.metrics-busy');
      expect(bar).not.toBeNull();
      expect(bar?.getAttribute('aria-hidden')).toBe('true'); // décoratif : l'annonce est celle de la zone `aria-live`, qu'il ne double pas
      // Juste avant les chiffres, et pas dedans : enfant du conteneur à écart (`gap-6`), il y ajouterait un écart de plus et la page descendrait de 24 px quand il paraît.
      expect(bar?.nextElementSibling).toBe(kept);
      expect(kept.contains(bar)).toBe(false);

      await act(async () => held.release());
      await waitFor(() => expect(keptFigures()).toBeNull());
      expect(document.querySelector('.metrics-busy')).toBeNull();
      expect(screen.queryByText('Calcul en cours')).toBeNull();
      expect(screen.getByText('Calculé à 20:00')).toBeTruthy();
    });

    it('ne les montre pas pour une réponse rapide : ni le trait ni le texte ne clignotent', async () => {
      api(() => metricsFixture());
      const { user } = await loaded();
      // À chaque changement du DOM, ce qui est à l'écran à cet instant : les chiffres gardés (le chargement a eu lieu), le trait, le texte.
      const seen = { busy: false, trait: false, text: false };
      const note = () => {
        seen.busy ||= keptFigures() !== null;
        seen.trait ||= document.querySelector('.metrics-busy') !== null;
        seen.text ||= document.body.textContent?.includes('Calcul en cours') === true;
      };
      const watch = new MutationObserver(note);
      watch.observe(document.body, { childList: true, subtree: true, characterData: true, attributes: true, attributeFilter: ['aria-busy'] });

      try {
        await user.click(within(period()).getByRole('radio', { name: '7 jours' }));
        await waitFor(() => expect(seen.busy).toBe(true)); // le test ne vaut que si les chiffres des 30 jours ont bien été gardés un instant
        await waitFor(() => expect(keptFigures()).toBeNull());
        await new Promise((resolve) => setTimeout(resolve, 400)); // le délai passé, rien ne vient plus
        note();
      } finally {
        watch.disconnect();
      }

      expect(seen).toEqual({ busy: true, trait: false, text: false });
      expect(screen.getByText('Calculé à 20:00')).toBeTruthy();
    });

    it('ne les montre pas quand « Actualiser » recalcule la même période : ses chiffres sont ceux que l’on a demandés, et le tourniquet dit l’attente', async () => {
      let release: (() => void) | undefined;
      let calls = 0;
      api(() => (++calls === 2 ? new Promise<MetricsReply>((resolve) => (release = () => resolve(metricsFixture()))) : metricsFixture()));
      const { user } = await loaded();

      await user.click(screen.getByRole('button', { name: 'Actualiser les métriques' }));
      await waitFor(() => expect(release).toBeDefined());
      await new Promise((resolve) => setTimeout(resolve, 400)); // plus que le délai du trait et du texte

      expect(keptFigures()).toBeNull(); // pas provisoires : le même cache, la même période
      expect(document.querySelector('.metrics-busy')).toBeNull();
      expect(screen.queryByText('Calcul en cours')).toBeNull();
      expect(screen.getByRole('button', { name: 'Actualiser les métriques' }).querySelector('svg')?.getAttribute('class')).toContain('animate-spin');
      await act(async () => release?.());
    });
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
 * ne connaît pas : il compte dans le sien, le nomme dans `timeZone` et dit qu'il n'a pas honoré celui qu'on lui demandait (`timeZoneHonoured`, bdesk-38k.71).
 * La page lit ce drapeau, sans comparer de noms, le dit, et compte « aujourd'hui » dans le fuseau de la réponse, pour que les plages qu'elle accepte soient
 * celles que le serveur sert.
 */
describe('la page Métriques quand le serveur ne connaît pas le fuseau du navigateur', () => {
  // 23:30 UTC le 4 novembre : le 5 à 00:30 à Paris, encore le 4 à UTC.
  const LATE = new Date('2026-11-04T23:30:00.000Z');
  /** Le serveur ne connaît pas le fuseau demandé : il compte dans le sien, UTC, et dit qu'il n'a pas honoré celui de la page. */
  const serverInUtc = () => metricsFixture({ timeZone: 'UTC', timeZoneHonoured: false });
  const NOTICE = 'Le serveur ne connaît pas votre fuseau, Europe/Paris';
  const customTo = () => screen.getByLabelText('Au') as HTMLInputElement;
  /** Une navigation de l'application, sans recharger la page : le cache des requêtes, lui, reste. */
  const go = (router: { navigate: (to: string) => Promise<void> }, to: string) =>
    act(async () => {
      await router.navigate(to);
    });

  withTimeZone('Europe/Paris');

  it('dit que le serveur ne connaît pas le fuseau du navigateur et dans quel fuseau les jours sont comptés', async () => {
    vi.setSystemTime(LATE);
    api(serverInUtc);
    await loaded();

    // Une région de statut nommée par son titre (bdesk-38k.61) : un lecteur d'écran dit de quoi elle parle.
    const notice = await screen.findByRole('status', { name: NOTICE });
    expect(plain(notice.textContent)).toContain('Les jours, les semaines et les heures des métriques sont comptés en UTC, le fuseau du serveur.');
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

  // bdesk-38k.79 (R-a) : et les chiffres de cette réponse ne sont pas gardés non plus. Ils sont comptés en UTC (le fuseau du serveur, qui ne connaissait pas Paris), ils ne disent
  // rien de Tokyo, et aucun avis n'est là pour le dire : l'avis suit la réponse au fuseau du navigateur, qui est maintenant celui de Tokyo. Le squelette tient leur place.
  it('ne tient pas pour la réponse à un autre fuseau demandé ce que le serveur a répondu au précédent, ni ses chiffres : le navigateur change de fuseau, la page compte dans le nouveau en attendant', async () => {
    vi.setSystemTime(LATE); // le 5 à 08:30 à Tokyo, le 5 à 00:30 à Paris, le 4 à 23:30 en UTC
    let release: (() => void) | undefined;
    const fetchMock = api((url) => {
      if (url.searchParams.get('timeZone') !== 'Asia/Tokyo') return serverInUtc(); // Paris : le serveur ne le connaît pas, il compte en UTC
      return new Promise<MetricsReply>((resolve) => (release = () => resolve(metricsFixture({ timeZone: 'Asia/Tokyo' })))); // Tokyo : il le connaît, mais répond tard
    });
    const { user } = await loaded();
    await screen.findByText(NOTICE);
    expect(screen.getByTitle('Fuseau UTC')).toBeTruthy(); // les chiffres de Paris sont à l'écran, comptés en UTC

    try {
      process.env.TZ = 'Asia/Tokyo'; // le fuseau du navigateur change pendant que la page est ouverte ; un réglage de la période relance le rendu
      await user.click(within(period()).getByRole('radio', { name: '7 jours' }));
      await waitFor(() => expect(metricsRequests(fetchMock).at(-1)).toBe('/api/metrics?project=bdesk&range=7d&timeZone=Asia%2FTokyo'));
      // La réponse en UTC, pour Paris, ne dit rien de Tokyo : pas d'avis. Et ses chiffres, comptés autrement que ceux que Tokyo aura, ne restent pas à l'écran sans lui.
      expect(screen.queryByText(/Le serveur ne connaît pas votre fuseau/)).toBeNull();
      expect(screen.queryByRole('heading', { level: 2, name: 'Indicateurs' })).toBeNull();
      expect(screen.queryByTitle('Fuseau UTC')).toBeNull();
      expect(screen.getByRole('status', { name: 'Chargement des métriques' })).toBeTruthy();

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

  /**
   * bdesk-38k.71 (R1) : l'avis disait où les jours sont comptés, et disparaissait pendant que la période suivante se calculait (la page garde alors les chiffres de
   * la précédente, qui étaient atténués, ils ne le sont plus depuis bdesk-38k.80 : ils sont comptés dans le même fuseau du serveur, et passaient sans lui) pour revenir
   * avec la réponse. Il suit la dernière réponse du serveur, tant que le fuseau du navigateur est le même.
   */
  it('garde l’avis pendant que la période suivante se calcule : les chiffres gardés à l’écran sont comptés dans le fuseau du serveur, ils ne passent pas sans lui', async () => {
    vi.setSystemTime(LATE);
    let release: (() => void) | undefined;
    const fetchMock = api((url) =>
      url.searchParams.get('range') === '7d'
        ? new Promise<MetricsReply>((resolve) => (release = () => resolve(serverInUtc())))
        : serverInUtc(),
    );
    const { user } = await loaded();
    const notice = await screen.findByRole('status', { name: NOTICE });

    await user.click(within(period()).getByRole('radio', { name: '7 jours' }));
    await waitFor(() => expect(metricsRequests(fetchMock).at(-1)).toBe('/api/metrics?project=bdesk&range=7d&timeZone=Europe%2FParis'));
    // Les chiffres des 30 jours sont gardés en attendant ceux des 7 jours : l'avis les accompagne toujours.
    expect(document.querySelector('[aria-busy="true"]')).not.toBeNull();
    expect(screen.getByRole('status', { name: NOTICE })).toBe(notice);

    await act(async () => release?.());
    await waitFor(() => expect(document.querySelector('[aria-busy="true"]')).toBeNull());
    expect(screen.getByRole('status', { name: NOTICE })).toBe(notice); // le même nœud : ni retiré ni remis, la page ne saute pas
    expect(notice.isConnected).toBe(true);
  });

  it('ne retire l’avis à aucun moment d’une suite de changements de période : il reste le même nœud du début à la fin', async () => {
    vi.setSystemTime(LATE);
    const fetchMock = api(serverInUtc);
    const { user } = await loaded();
    const notice = await screen.findByRole('status', { name: NOTICE });
    const removals: string[] = [];
    const note = (records: MutationRecord[]) => {
      for (const record of records) for (const node of record.removedNodes) if (node.contains(notice)) removals.push(node.nodeName);
    };
    const watch = new MutationObserver(note);
    watch.observe(document.body, { childList: true, subtree: true });

    try {
      for (const [label, range] of [['7 jours', '7d'], ['90 jours', '90d']] as const) {
        await user.click(within(period()).getByRole('radio', { name: label }));
        await waitFor(() => expect(metricsRequests(fetchMock).at(-1)).toBe(`/api/metrics?project=bdesk&range=${range}&timeZone=Europe%2FParis`));
        await waitFor(() => expect(document.querySelector('[aria-busy="true"]')).toBeNull());
      }
      await user.click(within(period()).getByRole('radio', { name: 'Personnalisée' }));
      await waitFor(() => expect(metricsRequests(fetchMock).at(-1)).toContain('from='));
      await waitFor(() => expect(document.querySelector('[aria-busy="true"]')).toBeNull());
      note(watch.takeRecords());
    } finally {
      watch.disconnect();
    }

    expect(removals).toEqual([]);
    expect(screen.getByRole('status', { name: NOTICE })).toBe(notice);
  });

  it('retire l’avis quand la réponse suivante honore le fuseau demandé : il suit la dernière réponse du serveur, pas la première', async () => {
    vi.setSystemTime(LATE);
    let serverKnowsTheZone = false;
    api((url) => (serverKnowsTheZone ? inRequestedZone(url) : serverInUtc()));
    const { user } = await loaded();
    await screen.findByRole('status', { name: NOTICE });

    serverKnowsTheZone = true; // le serveur a été mis à jour : un fuseau plus récent que son ICU lui est maintenant connu
    await user.click(screen.getByRole('button', { name: 'Actualiser les métriques' }));

    await waitFor(() => expect(screen.queryByRole('status', { name: NOTICE })).toBeNull());
    await user.click(within(period()).getByRole('radio', { name: 'Personnalisée' }));
    expect(customTo().max).toBe('2026-11-05'); // et « aujourd'hui » est de nouveau celui de Paris
  });

  it('garde l’avis quand la période suivante échoue : le fuseau du serveur n’a pas changé, et « Réessayer » rendra des chiffres qui en dépendent', async () => {
    vi.setSystemTime(LATE);
    let healthy = false;
    api((url) => (url.searchParams.get('range') === '7d' && !healthy ? new Error('database is locked') : serverInUtc()));
    const { user } = await loaded();
    const notice = await screen.findByRole('status', { name: NOTICE });

    await user.click(within(period()).getByRole('radio', { name: '7 jours' }));
    expect(await screen.findByText('Impossible de calculer les métriques')).toBeTruthy();
    expect(screen.getByRole('status', { name: NOTICE })).toBe(notice);

    healthy = true;
    await user.click(page().getByRole('button', { name: /Réessayer/ }));
    expect(await screen.findByRole('heading', { level: 2, name: 'Indicateurs' })).toBeTruthy();
    expect(screen.getByRole('status', { name: NOTICE })).toBe(notice);
  });

  /**
   * bdesk-38k.71 (M4) : « ces chiffres » suppose des chiffres à l'écran. L'avis, lui, reste quand la période suivante échoue et sous le squelette d'une page qui s'ouvre :
   * il parle des métriques, avec ou sans chiffres, et d'une seule phrase (un texte qui change dans une région de statut peut être relu par un lecteur d'écran).
   */
  it('parle des métriques, et non de « ces chiffres », qu’aucun chiffre ne soit à l’écran ou que d’autres reviennent : une période qui échoue', async () => {
    vi.setSystemTime(LATE);
    let healthy = false;
    api((url) => (url.searchParams.get('range') === '7d' && !healthy ? new Error('database is locked') : serverInUtc()));
    const { user } = await loaded();
    const notice = await screen.findByRole('status', { name: NOTICE });
    const sentence = 'Les jours, les semaines et les heures des métriques sont comptés en UTC, le fuseau du serveur.';
    expect(plain(notice.textContent)).toContain(sentence);

    await user.click(within(period()).getByRole('radio', { name: '7 jours' }));
    expect(await screen.findByText('Impossible de calculer les métriques')).toBeTruthy(); // aucun chiffre à l'écran

    const alone = screen.getByRole('status', { name: NOTICE });
    expect(alone).toBe(notice);
    expect(plain(alone.textContent)).toContain(sentence);
    expect(plain(alone.textContent)).not.toContain('ces chiffres');

    healthy = true;
    await user.click(page().getByRole('button', { name: /Réessayer/ }));
    expect(await screen.findByRole('heading', { level: 2, name: 'Indicateurs' })).toBeTruthy();
    expect(plain(screen.getByRole('status', { name: NOTICE }).textContent)).toContain(sentence); // la même phrase : le texte de la région de statut ne change pas
  });

  /**
   * bdesk-38k.71 (M1) : la dernière réponse du serveur vit dans le cache des requêtes, pas dans la vue. De la page d'un Projet à la Vue globale, l'avis est là dès que la
   * nouvelle page s'affiche, sous son squelette, au lieu de ne revenir qu'avec la réponse.
   */
  it('garde l’avis de la page d’un Projet à la Vue globale : il est là sous son squelette, et reste le même nœud quand les chiffres arrivent', async () => {
    vi.setSystemTime(LATE);
    let release: (() => void) | undefined;
    const fetchMock = api((url) =>
      url.searchParams.has('project') ? serverInUtc() : new Promise<MetricsReply>((resolve) => (release = () => resolve(serverInUtc()))),
    );
    const { router } = await loaded();
    await screen.findByRole('status', { name: NOTICE });

    await go(router, '/');
    expect(await screen.findByRole('heading', { level: 1, name: 'Vue globale' })).toBeTruthy();
    await waitFor(() => expect(metricsRequests(fetchMock).at(-1)).toBe('/api/metrics?range=30d&timeZone=Europe%2FParis'));
    // La Vue globale attend ses chiffres : l'avis est déjà là, et ne parle pas de « ces chiffres » faute d'en montrer.
    expect(screen.queryByRole('heading', { level: 2, name: 'Indicateurs' })).toBeNull();
    const notice = screen.getByRole('status', { name: NOTICE });
    expect(plain(notice.textContent)).toContain('Les jours, les semaines et les heures des métriques sont comptés en UTC, le fuseau du serveur.');

    await act(async () => release?.());
    expect(await screen.findByRole('heading', { level: 2, name: 'Indicateurs' })).toBeTruthy();
    expect(screen.getByRole('status', { name: NOTICE })).toBe(notice); // le même nœud, et la même phrase
    expect(plain(notice.textContent)).toContain('Les jours, les semaines et les heures des métriques sont comptés en UTC, le fuseau du serveur.');
  });

  it('garde l’avis au retour de la Vue globale à la page d’un Projet, dès le premier affichage', async () => {
    vi.setSystemTime(LATE);
    api(serverInUtc);
    const { router } = await loaded();
    await screen.findByRole('status', { name: NOTICE });
    await go(router, '/');
    await screen.findByRole('heading', { level: 2, name: 'Indicateurs' });
    await screen.findByRole('status', { name: NOTICE });

    await go(router, '/p/bdesk/metrics');

    expect(screen.getByRole('status', { name: NOTICE })).toBeTruthy(); // dans le même rendu que la page : sans attendre la réponse
  });

  it('ne garde pas l’avis d’un navigateur qui a changé de fuseau en passant à la Vue globale : la dernière réponse est celle du fuseau demandé', async () => {
    vi.setSystemTime(LATE);
    let release: (() => void) | undefined;
    api((url) =>
      url.searchParams.get('timeZone') === 'Europe/Paris'
        ? serverInUtc() // Paris : le serveur ne le connaît pas, il compte en UTC
        : new Promise<MetricsReply>((resolve) => (release = () => resolve(inRequestedZone(url)))), // Tokyo : il le connaît, mais répond tard
    );
    const { router } = await loaded();
    await screen.findByRole('status', { name: NOTICE });

    try {
      process.env.TZ = 'Asia/Tokyo'; // le navigateur change de fuseau pendant que la page est ouverte
      await go(router, '/');
      expect(await screen.findByRole('heading', { level: 1, name: 'Vue globale' })).toBeTruthy();
      await waitFor(() => expect(release).toBeDefined());
      // En attendant la réponse de Tokyo, la réponse en UTC, pour Paris, ne dit rien du fuseau de Tokyo.
      expect(screen.queryByText(/Le serveur ne connaît pas votre fuseau/)).toBeNull();

      await act(async () => release?.());
      expect(await screen.findByRole('heading', { level: 2, name: 'Indicateurs' })).toBeTruthy();
      expect(screen.queryByText(/Le serveur ne connaît pas votre fuseau/)).toBeNull();
    } finally {
      process.env.TZ = 'Europe/Paris';
    }
  });

  /**
   * bdesk-38k.79 (R-b) : tant que sa propre requête n'a pas abouti, la page lit l'avis dans la réponse d'une requête qu'elle a quittée (la période précédente, la page d'un Projet).
   * Le cache retire une requête cinq minutes après que plus aucune vue ne l'observe (`gcTime`) : si celle de la page échoue plus longtemps, l'avis ne s'en va pas pour autant, car
   * rien n'a dit que le serveur connaît le fuseau. Les minuteries du cache sont celles de la page : le temps de ces tests ne passe que quand ils le disent.
   */
  describe('quand la requête de la page échoue plus de cinq minutes', () => {
    const FIVE_MINUTES = 5 * 60_000;
    /** `Date` et les minuteries du cache (`gcTime`), posées avant tout rendu : une requête qui perd son dernier observateur y programme son retrait. Les attentes de Testing Library suivent le temps réel. */
    const clockAt = (instant: Date) => {
      vi.useRealTimers();
      vi.useFakeTimers({ toFake: ['Date', 'setTimeout', 'clearTimeout'], shouldAdvanceTime: true });
      vi.setSystemTime(instant);
    };
    const inCache = (client: QueryClient, ...key: string[]) => client.getQueryCache().findAll({ queryKey: ['metrics', ...key] }).length;
    /** Combien de fois cette requête a échoué : le « Réessayer » est fini quand il augmente. */
    const failures = (client: QueryClient, ...key: Parameters<typeof metricsKey>) => client.getQueryCache().find({ queryKey: metricsKey(...key) })?.state.errorUpdateCount;

    it('Vue globale : l’avis tient quand la réponse du Projet, seule à dire ce que le serveur sait du fuseau, quitte le cache', async () => {
      clockAt(LATE);
      api((url) => (url.searchParams.has('project') ? serverInUtc() : new Error('database is locked')));
      const { router, queryClient, user } = await loaded();
      await screen.findByRole('status', { name: NOTICE });

      await go(router, '/');
      expect(await screen.findByText('Impossible de calculer les métriques')).toBeTruthy(); // la Vue globale n'a jamais abouti
      expect(screen.getByRole('status', { name: NOTICE })).toBeTruthy(); // l'avis vient de la réponse du Projet
      const overall = { period: { kind: 'preset', range: '30d' }, timeZone: 'Europe/Paris' } as const;
      expect(failures(queryClient, overall)).toBe(1);

      act(() => void vi.advanceTimersByTime(FIVE_MINUTES + 1_000));
      expect(inCache(queryClient, 'bdesk')).toBe(0); // plus aucune vue n'observait la réponse du Projet : le cache l'a retirée
      await user.click(page().getByRole('button', { name: /Réessayer/ })); // le rendu suivant
      await waitFor(() => expect(failures(queryClient, overall)).toBe(2));

      expect(await screen.findByText('Impossible de calculer les métriques')).toBeTruthy();
      expect(screen.getByRole('status', { name: NOTICE })).toBeTruthy();
    });

    it('période suivante : l’avis tient quand la réponse de la période précédente quitte le cache', async () => {
      clockAt(LATE);
      api((url) => (url.searchParams.get('range') === '7d' ? new Error('database is locked') : serverInUtc()));
      const { queryClient, user } = await loaded();
      await screen.findByRole('status', { name: NOTICE });

      await user.click(within(period()).getByRole('radio', { name: '7 jours' }));
      expect(await screen.findByText('Impossible de calculer les métriques')).toBeTruthy(); // les 7 jours n'ont jamais abouti
      const week = { project: 'bdesk', period: { kind: 'preset', range: '7d' }, timeZone: 'Europe/Paris' } as const;
      expect(failures(queryClient, week)).toBe(1);

      act(() => void vi.advanceTimersByTime(FIVE_MINUTES + 1_000));
      expect(inCache(queryClient, 'bdesk', '30d')).toBe(0); // les 30 jours, qui portaient l'avis, ne sont plus observés depuis cinq minutes
      await user.click(page().getByRole('button', { name: /Réessayer/ }));
      await waitFor(() => expect(failures(queryClient, week)).toBe(2));

      expect(await screen.findByText('Impossible de calculer les métriques')).toBeTruthy();
      expect(screen.getByRole('status', { name: NOTICE })).toBeTruthy();
    });

    // bdesk-38k.79 (relecture, R3) : la retenue ne vaut que tant que le serveur n'a pas pu changer. Le flux en direct ne suit ni la Vue globale ni les pages de métriques, donc un redémarrage
    // (une mise à jour de Node, un autre `TZ`) n'est pas vu : la page oublie cinq minutes après la dernière page de métriques, comme le cache, au lieu d'afficher l'ancien avis sous le squelette.
    it('ne le rend plus à une page de métriques qui s’ouvre plus de cinq minutes après la dernière : le serveur a pu être mis à jour (la Vue globale après le kanban)', async () => {
      clockAt(LATE);
      const fetchMock = api((url) => (url.searchParams.has('project') ? serverInUtc() : new Error('database is locked')));
      const { router, queryClient } = await loaded();
      await screen.findByRole('status', { name: NOTICE });
      await go(router, '/p/bdesk/kanban');
      await screen.findByRole('heading', { level: 1, name: 'Kanban' });

      act(() => void vi.advanceTimersByTime(FIVE_MINUTES + 1_000));
      expect(inCache(queryClient, 'bdesk')).toBe(0);
      const before = metricsRequests(fetchMock).length;
      await go(router, '/');

      expect(await screen.findByText('Impossible de calculer les métriques')).toBeTruthy();
      expect(metricsRequests(fetchMock)).toHaveLength(before + 1);
      expect(screen.queryByRole('status', { name: NOTICE })).toBeNull(); // rien n'est connu du serveur : l'erreur parle seule, comme à l'ouverture
    });

    it('le rend encore à une page de métriques qui s’ouvre moins de cinq minutes après la dernière : la Vue globale après le kanban', async () => {
      clockAt(LATE);
      api((url) => (url.searchParams.has('project') ? serverInUtc() : new Error('database is locked')));
      const { router } = await loaded();
      await screen.findByRole('status', { name: NOTICE });
      await go(router, '/p/bdesk/kanban');
      await screen.findByRole('heading', { level: 1, name: 'Kanban' });

      act(() => void vi.advanceTimersByTime(2 * 60_000));
      await go(router, '/');

      expect(await screen.findByText('Impossible de calculer les métriques')).toBeTruthy();
      expect(screen.getByRole('status', { name: NOTICE })).toBeTruthy();
    });
  });

  /**
   * bdesk-38k.79 (relecture, B1) : l'ordre des réponses ne dépend pas de l'horloge. L'horloge du système recule (une correction NTP, un réglage manuel, une machine virtuelle qu'on reprend) :
   * la requête relue répond avec une date antérieure à celle de la réponse qu'elle remplace. Elle dit pourtant la vérité du moment, et l'avis doit s'en aller avec les chiffres qu'elle apporte.
   */
  it('retire l’avis quand la requête relue répond honoré après un recul de l’horloge du système', async () => {
    vi.setSystemTime(LATE);
    let serverKnowsTheZone = false;
    api((url) => (serverKnowsTheZone ? inRequestedZone(url) : serverInUtc()));
    const { user } = await loaded();
    await screen.findByRole('status', { name: NOTICE });

    vi.setSystemTime(new Date(LATE.getTime() - 10 * 60_000)); // l'horloge recule de dix minutes
    serverKnowsTheZone = true; // et le serveur a été mis à jour
    await user.click(screen.getByRole('button', { name: 'Actualiser les métriques' }));

    await waitFor(() => expect(screen.getByTitle('Fuseau Europe/Paris')).toBeTruthy()); // la réponse honorée est à l'écran…
    expect(screen.queryByRole('status', { name: NOTICE })).toBeNull(); // … et l'avis ne la contredit pas
    await user.click(within(period()).getByRole('radio', { name: 'Personnalisée' }));
    expect(customTo().max).toBe('2026-11-05'); // et « aujourd'hui » est de nouveau celui de Paris
  });

  /**
   * bdesk-38k.79 (relecture, remarque 3) : au changement de fuseau, le squelette remplace les chiffres. Le focus qu'ils tenaient (une puce de tendance, un lien, le résumé d'une table de données)
   * ne tombe pas sur le corps de la page : il revient au contenu principal, comme celui d'un avis d'erreur que le squelette remplace (`keepFocusInZone`). Le changement de fuseau n'est vu qu'au
   * rendu suivant, et celui-ci peut venir de n'importe où (un autre réglage de l'adresse, la liste des Projets relue au retour sur l'onglet) : rien ne dit que le focus a quitté les chiffres.
   */
  it('rend le focus au contenu principal quand le squelette remplace les chiffres qui le tenaient (le fuseau du navigateur change)', async () => {
    vi.setSystemTime(LATE);
    let release: (() => void) | undefined;
    api((url) =>
      url.searchParams.get('timeZone') === 'Asia/Tokyo'
        ? new Promise<MetricsReply>((resolve) => (release = () => resolve(metricsFixture({ timeZone: 'Asia/Tokyo' }))))
        : serverInUtc(),
    );
    const { router } = await loaded();
    await screen.findByRole('status', { name: NOTICE });
    const trend = document.querySelector<HTMLElement>('[data-trend]'); // la puce de tendance d'une tuile : focalisable au clavier
    expect(trend).not.toBeNull();
    act(() => trend?.focus());
    expect(document.activeElement).toBe(trend);

    try {
      process.env.TZ = 'Asia/Tokyo'; // le navigateur change de fuseau ; un rendu que rien dans les chiffres n'a demandé le fait voir
      await go(router, '/p/bdesk/metrics?range=7d');

      expect(await screen.findByRole('status', { name: 'Chargement des métriques' })).toBeTruthy();
      expect(trend?.isConnected).toBe(false); // les chiffres qui tenaient le focus sont partis…
      expect(document.activeElement).toBe(screen.getByRole('main')); // … il est au contenu principal, pas sur le corps de la page
      await act(async () => release?.());
      expect(await screen.findByRole('heading', { level: 2, name: 'Indicateurs' })).toBeTruthy();
    } finally {
      process.env.TZ = 'Europe/Paris';
    }
  });

  // bdesk-38k.71 : la page ne compare plus de noms. Le serveur sait s'il a compté dans le fuseau demandé, quel que soit le nom qu'il lui donne.
  it('lit le drapeau du serveur, pas les noms : un fuseau honoré sous un autre nom ne fait rien dire, et « aujourd’hui » reste celui du navigateur', async () => {
    vi.setSystemTime(LATE);
    // Un nom qui n'a rien à voir avec Paris, pour qu'aucune comparaison de noms ne puisse donner le même résultat : c'est le drapeau qui parle.
    api(() => metricsFixture({ timeZone: 'Pacific/Honolulu', timeZoneHonoured: true }));
    const { user } = await loaded();

    expect(screen.getByTitle('Fuseau Pacific/Honolulu')).toBeTruthy(); // les chiffres de la réponse sont à l'écran, écrits dans son fuseau
    expect(screen.queryByText(/Le serveur ne connaît pas votre fuseau/)).toBeNull();
    await user.click(within(period()).getByRole('radio', { name: 'Personnalisée' }));
    expect(customTo().max).toBe('2026-11-05'); // le fuseau demandé, honoré : le jour de Paris, pas celui de Honolulu (le 4)
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
