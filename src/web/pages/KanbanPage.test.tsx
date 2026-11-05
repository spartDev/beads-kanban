import { act, screen, waitFor, within } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { queryKeys } from '../data/hooks';
import type { Issue } from '../data/types';
import { withAsyncTimeout } from '../test/asyncTimeout';
import { issue, projectsResponse } from '../test/fixtures';
import { httpFailure, renderApp, stubApi } from '../test/render';
import { withTimeZone } from '../test/timeZone';

// Monter toute l'application prend plus d'une seconde quand la machine est chargée : voir `withAsyncTimeout`.
withAsyncTimeout(5_000);

const DAY = 86_400_000;
const ago = (days: number) => new Date(Date.now() - days * DAY).toISOString();

/**
 * Fige l'heure (seule `Date` : les minuteries restent réelles) et le fuseau du navigateur le temps d'un bloc de tests.
 * Terminé compte en jours calendaires de ce fuseau : la machine qui lance les tests ne doit pas décider du résultat.
 */
function freezeClock(now: string, timeZone = 'Europe/Paris') {
  withTimeZone(timeZone);
  beforeEach(() => {
    vi.useFakeTimers({ toFake: ['Date'], now: new Date(now) });
  });
  afterEach(() => {
    vi.useRealTimers();
  });
}

const SHELL = issue({ id: 'bdesk-e1', title: 'Shell UI : thèmes, navigation et raccourcis', type: 'epic', priority: 1 });
const DETAIL = issue({ id: 'bdesk-e2', title: 'Détail de ticket : panneau latéral', type: 'epic', priority: 2 });

/** Un Projet qui remplit chaque colonne, avec deux Epics, un ticket différé et un épinglé. */
const TICKETS: Issue[] = [
  SHELL,
  DETAIL,
  issue({ id: 'bdesk-a1', title: 'Palette ⌘K', priority: 1, parentId: 'bdesk-e1' }),
  issue({ id: 'bdesk-a2', title: 'Thèmes clair et sombre', priority: 0 }),
  issue({ id: 'bdesk-b1', title: 'Raccourcis clavier', blockedBy: ['bdesk-a1'], parentId: 'bdesk-e1' }),
  issue({ id: 'bdesk-c1', title: 'Barre latérale', status: 'in_progress', parentId: 'bdesk-e1', assignee: 'spartDev' }),
  issue({ id: 'bdesk-c2', title: 'Revue automatique', status: 'hooked', assignee: 'agent-7' }),
  issue({ id: 'bdesk-d1', title: 'Panneau en attente du spike', status: 'in_progress', blockedBy: ['bdesk-a1', 'bdesk-a2', 'bdesk-b1'], parentId: 'bdesk-e2' }),
  issue({ id: 'bdesk-d2', title: 'Attente d’un retour', status: 'blocked' }),
  issue({ id: 'bdesk-f1', title: 'Fermé hier', status: 'closed', closedAt: ago(1), updatedAt: ago(1), parentId: 'bdesk-e2' }),
  issue({ id: 'bdesk-f2', title: 'Fermé il y a vingt jours', status: 'closed', closedAt: ago(20), updatedAt: ago(20) }),
  issue({ id: 'bdesk-g1', title: 'Reporté à plus tard', status: 'deferred' }),
  issue({ id: 'bdesk-g2', title: 'Idée épinglée', status: 'pinned' }),
];

const stubTickets = (issues: Issue[] = TICKETS) => stubApi({ projects: projectsResponse, issues: { bdesk: issues } });
const search = (router: { state: { location: { search: string } } }) => router.state.location.search;

/**
 * Pose une règle de style le temps d'un bloc de tests. jsdom ne charge pas le CSS de l'application (Tailwind) : on y
 * reproduit la seule règle dont dépend le comportement testé, celle que la requête de conteneur décide dans un navigateur.
 */
function withStyle(css: string) {
  let style: HTMLStyleElement | undefined;
  beforeEach(() => {
    style = document.createElement('style');
    style.textContent = css;
    document.head.append(style);
  });
  afterEach(() => style?.remove());
}

/**
 * Panneau large (60 rem et plus) : le sélecteur de colonne est caché et les cinq colonnes sont affichées. Le raccourci
 * lit l'état du sélecteur à chaque touche pour savoir s'il y a une colonne « affichée » ou toutes.
 */
const withWideLayout = () => withStyle('[data-column-selector] { display: none; }');

/**
 * Panneau étroit : une seule colonne est affichée, les autres sont `display: none`, et le navigateur refuse le focus à
 * ce qu'elles contiennent : le raccourci doit d'abord faire apparaître la colonne (en écrivant `?col=`), puis y mettre le focus.
 */
const withNarrowLayout = () => withStyle('section[data-column]:not([data-shown="true"]) { display: none; }');

async function openBoard(path = '/p/bdesk/kanban') {
  const app = renderApp(path);
  await screen.findByRole('region', { name: 'Prêt' });
  return app;
}

const column = (name: string) => screen.getByRole('region', { name });
/** Les régions des colonnes, dans l'ordre du DOM (la barre latérale a aussi sa région « Projets »). */
const columns = () => screen.getAllByRole('region').filter((region) => region.hasAttribute('data-column'));
const titlesIn = (region: HTMLElement) =>
  within(region)
    .queryAllByRole('listitem')
    .map((card) => within(card).getAllByRole('link')[0]?.textContent);
/** « 3 tickets » : ce que la colonne annonce de son contenu (aria-describedby). */
const announcedCount = (region: HTMLElement) =>
  document.getElementById(region.getAttribute('aria-describedby') ?? '')?.textContent;

describe('les colonnes', () => {
  it('sont cinq, dans l’ordre du flux, avec le nombre de cartes de chacune', async () => {
    stubTickets();
    await openBoard();

    expect(columns().map((region) => region.querySelector('h2')?.textContent)).toEqual([
      'Backlog',
      'Prêt',
      'En cours',
      'Bloqué',
      'Terminé',
    ]);
    expect(announcedCount(column('Backlog'))).toBe('1 ticket');
    expect(announcedCount(column('Prêt'))).toBe('2 tickets');
    expect(announcedCount(column('En cours'))).toBe('2 tickets');
    expect(announcedCount(column('Bloqué'))).toBe('2 tickets');
    expect(announcedCount(column('Terminé'))).toBe('1 ticket');
  });

  it('rangent chaque ticket selon son statut et son Blocage', async () => {
    stubTickets();
    await openBoard();

    expect(titlesIn(column('Backlog'))).toEqual(['Raccourcis clavier']);
    expect(titlesIn(column('Prêt'))).toEqual(['Thèmes clair et sombre', 'Palette ⌘K']);
    expect(titlesIn(column('En cours'))).toEqual(['Barre latérale', 'Revue automatique']);
    expect(titlesIn(column('Bloqué'))).toEqual(['Panneau en attente du spike', 'Attente d’un retour']);
    expect(titlesIn(column('Terminé'))).toEqual(['Fermé hier']);
  });

  it('ordonnent les cartes par priorité, puis par mise à jour la plus récente', async () => {
    stubTickets([
      issue({ id: 'bdesk-1', title: 'Minimale récente', priority: 4, updatedAt: ago(0) }),
      issue({ id: 'bdesk-2', title: 'Haute ancienne', priority: 1, updatedAt: ago(9) }),
      issue({ id: 'bdesk-3', title: 'Haute récente', priority: 1, updatedAt: ago(2) }),
      issue({ id: 'bdesk-4', title: 'Critique', priority: 0, updatedAt: ago(30) }),
    ]);
    await openBoard();

    expect(titlesIn(column('Prêt'))).toEqual(['Critique', 'Haute récente', 'Haute ancienne', 'Minimale récente']);
  });

  it('ne montrent pas les Epics comme cartes', async () => {
    stubTickets();
    await openBoard();

    expect(screen.queryByRole('link', { name: /Shell UI : thèmes/ })).toBeNull();
    expect(screen.queryByRole('link', { name: 'Détail de ticket : panneau latéral' })).toBeNull();
  });

  it('gardent un message pour une colonne vide', async () => {
    stubTickets([issue({ id: 'bdesk-1', title: 'Seul ticket' })]);
    await openBoard();

    expect(within(column('Bloqué')).getByText('Aucun ticket')).toBeTruthy();
    expect(announcedCount(column('Bloqué'))).toBe('0 ticket');
  });

  it('comptent les tickets du tableau, et disent où sont les Epics : dans le filtre, pas en cartes', async () => {
    stubTickets();
    await openBoard();

    const summary = screen.getByText('10 tickets').closest('p') as HTMLElement;
    expect(summary.textContent).toBe('10 tickets · 2 Epics dans le filtre');
  });

  it('n’ont rien à dire des Epics quand le tableau est déjà filtré, ni quand le Projet n’en a pas', async () => {
    stubTickets();
    const first = await openBoard('/p/bdesk/kanban?epic=bdesk-e1');
    expect((screen.getByText('3 tickets').closest('p') as HTMLElement).textContent).toBe('3 tickets');
    first.unmount();

    stubTickets([issue({ id: 'bdesk-1', title: 'Seul ticket' })]);
    await openBoard();
    expect((screen.getByText('1 ticket').closest('p') as HTMLElement).textContent).toBe('1 ticket');
  });

  it('n’offrent aucun glisser-déposer : le kanban est en lecture seule', async () => {
    stubTickets();
    await openBoard();

    expect(document.querySelector('[draggable="true"]')).toBeNull();
    expect(document.querySelector('[draggable]')).toBeNull();
  });
});

describe('une carte', () => {
  it('ouvre le ticket du Projet : /p/<projet>/t/<id>', async () => {
    stubTickets();
    const { user, router } = await openBoard();

    const link = within(column('Prêt')).getByRole('link', { name: 'Palette ⌘K' });
    expect(link.getAttribute('href')).toBe('/p/bdesk/t/bdesk-a1');
    await user.click(link);

    await waitFor(() => expect(router.state.location.pathname).toBe('/p/bdesk/t/bdesk-a1'));
  });

  it('porte le type, l’identifiant et la priorité', async () => {
    stubTickets([issue({ id: 'bdesk-9', title: 'Un bug urgent', type: 'bug', priority: 0 })]);
    await openBoard();

    const card = within(column('Prêt')).getByRole('listitem');
    expect(within(card).getByText('bdesk-9')).toBeTruthy();
    expect(within(card).getByText('P0')).toBeTruthy();
  });

  it('montre le badge « agent » d’un ticket rattaché à un agent, et lui seul', async () => {
    stubTickets();
    await openBoard();

    const inProgress = column('En cours');
    const [barre, revue] = within(inProgress).getAllByRole('listitem');
    expect(within(revue!).getByText('agent')).toBeTruthy();
    expect(within(barre!).queryByText('agent')).toBeNull();
    expect(screen.getAllByText('agent')).toHaveLength(1);
  });

  it('nomme ce qui bloque un ticket en Blocage, et le statut bloqué qui n’a pas de dépendance', async () => {
    stubTickets();
    await openBoard();

    const backlog = within(column('Backlog')).getByRole('listitem');
    expect(backlog.textContent).toContain('Attend bdesk-a1');

    const [stuck, flagged] = within(column('Bloqué')).getAllByRole('listitem');
    // Trois dépendances en suspens : les deux premières sont nommées, la troisième comptée.
    expect(stuck!.textContent).toContain('Attend bdesk-a1, bdesk-a2');
    expect(stuck!.textContent).toContain('+1');
    expect(flagged!.textContent).toContain('Statut bloqué');
  });

  it('porte la pastille de son Epic : titre court, lien vers l’Epic', async () => {
    stubTickets();
    await openBoard();

    const card = within(column('Prêt')).getByText('Palette ⌘K').closest('li') as HTMLElement;
    const pill = within(card).getByRole('link', { name: 'Epic : Shell UI' });
    expect(pill.getAttribute('href')).toBe('/p/bdesk/epics?epic=bdesk-e1');
    expect(pill.getAttribute('title')).toBe('Shell UI : thèmes, navigation et raccourcis');

    const orphan = within(column('Prêt')).getByText('Thèmes clair et sombre').closest('li') as HTMLElement;
    expect(within(orphan).queryByRole('link', { name: /^Epic/ })).toBeNull();
  });

  describe('le mercredi 4 novembre 2026, 10:00 à Paris', () => {
    freezeClock('2026-11-04T09:00:00Z');

    it('dit son âge, et l’assigné quand il y en a un', async () => {
      // Aucun titre ne dit « hier » ni « avant-hier » : seule l'étiquette d'âge de la carte peut les écrire. Le ticket fermé a été mis à
      // jour après sa clôture : la carte de Terminé doit dire l'âge de la clôture, pas celui de la dernière mise à jour.
      stubTickets([
        issue({ id: 'bdesk-1', title: 'Livraison de la veille', status: 'closed', closedAt: '2026-11-03T09:00:00Z', updatedAt: '2026-11-04T08:30:00Z' }),
        issue({ id: 'bdesk-2', title: 'Chantier confié', status: 'in_progress', assignee: 'spartDev', updatedAt: '2026-11-02T09:00:00Z' }),
        issue({ id: 'bdesk-3', title: 'Chantier libre', status: 'in_progress', updatedAt: '2026-11-03T09:00:00Z' }),
      ]);
      await openBoard();

      const card = (region: string, title: string) => within(column(region)).getByText(title).closest('li') as HTMLElement;
      const ageOf = (item: HTMLElement) => within(item).getByRole('time').textContent;

      const done = card('Terminé', 'Livraison de la veille');
      expect(ageOf(done)).toBe('Fermé hier');
      expect(within(done).queryByText('spartDev')).toBeNull();

      const assigned = card('En cours', 'Chantier confié');
      expect(ageOf(assigned)).toBe('Mis à jour avant-hier');
      expect(within(assigned).getByText('spartDev')).toBeTruthy();

      const unassigned = card('En cours', 'Chantier libre');
      expect(ageOf(unassigned)).toBe('Mis à jour hier');
      expect(within(unassigned).queryByText('spartDev')).toBeNull();
    });
  });
});

describe('le tiroir « En pause »', () => {
  it('reste fermé tant qu’on ne l’ouvre pas, et dit combien de tickets il contient', async () => {
    stubTickets();
    await openBoard();

    const toggle = screen.getByRole('button', { name: /^En pause/ });
    expect(toggle.getAttribute('aria-expanded')).toBe('false');
    expect(toggle.textContent).toContain('2');
    expect(screen.queryByText('Reporté à plus tard')).toBeNull();
  });

  it('montre, une fois ouvert, les tickets différés et épinglés avec leur statut', async () => {
    stubTickets();
    const { user } = await openBoard();

    const toggle = screen.getByRole('button', { name: /^En pause/ });
    await user.click(toggle);

    expect(toggle.getAttribute('aria-expanded')).toBe('true');
    const drawer = screen.getByRole('region', { name: 'En pause' });
    expect(titlesIn(drawer)).toEqual(['Reporté à plus tard', 'Idée épinglée']);
    expect(within(drawer).getByText('reporté')).toBeTruthy();
    expect(within(drawer).getByText('épinglé')).toBeTruthy();

    await user.click(toggle);
    expect(screen.queryByRole('region', { name: 'En pause' })).toBeNull();
  });

  it('sert à ranger aussi un statut personnalisé de beads, qui garde son nom', async () => {
    stubTickets([issue({ id: 'bdesk-1', title: 'En relecture', status: 'review' })]);
    const { user } = await openBoard();

    await user.click(screen.getByRole('button', { name: /^En pause/ }));

    expect(within(screen.getByRole('region', { name: 'En pause' })).getByText('review')).toBeTruthy();
  });

  it('existe même vide, pour qu’on sache où irait un ticket différé', async () => {
    stubTickets([issue({ id: 'bdesk-1', title: 'Seul ticket' })]);
    const { user } = await openBoard();

    await user.click(screen.getByRole('button', { name: /^En pause/ }));

    expect(within(screen.getByRole('region', { name: 'En pause' })).getByText('Aucun ticket en pause')).toBeTruthy();
  });

  it('donne une pastille lisible, « inconnu », à un ticket dont le statut est vide', async () => {
    stubTickets([issue({ id: 'bdesk-1', title: 'Sans statut', status: '' })]);
    const { user } = await openBoard();

    await user.click(screen.getByRole('button', { name: /^En pause/ }));

    const drawer = screen.getByRole('region', { name: 'En pause' });
    const card = within(drawer).getByText('Sans statut').closest('li') as HTMLElement;
    expect(within(card).getByText('inconnu')).toBeTruthy();
  });

  it('dit dans son sous-titre qu’il reçoit aussi les statuts inconnus', async () => {
    stubTickets();
    await openBoard();

    const toggle = screen.getByRole('button', { name: /^En pause/ });
    expect(toggle.textContent).toContain('Reportés');
    expect(toggle.textContent).toContain('épinglés');
    expect(toggle.textContent).toContain('statut inconnu');
  });
});

describe('un Projet dont tous les tickets sont en pause', () => {
  const PAUSED = [
    issue({ id: 'bdesk-1', title: 'Reporté à plus tard', status: 'deferred' }),
    issue({ id: 'bdesk-2', title: 'Idée épinglée', status: 'pinned' }),
    issue({ id: 'bdesk-3', title: 'En relecture', status: 'review' }),
  ];
  const notice = () => screen.getByText('Les 3 tickets du tableau sont tous en pause').closest('[role="status"]') as HTMLElement;
  const OPEN = 'Ouvrir « En pause »';

  it('dit que tout est en pause et renvoie au tiroir, au lieu d’un Prêt vide sans explication', async () => {
    stubTickets(PAUSED);
    await openBoard();

    expect(notice().textContent).toContain('ils attendent dans le tiroir « En pause »');
    expect(within(notice()).getByRole('button', { name: OPEN })).toBeTruthy();
    // Le tiroir reste fermé tant qu'on ne l'ouvre pas.
    expect(screen.queryByRole('region', { name: 'En pause' })).toBeNull();
    expect(screen.getByRole('button', { name: /^En pause/ }).getAttribute('aria-expanded')).toBe('false');
  });

  it('ouvre le tiroir depuis l’état vide, y amène le focus, et n’offre plus le bouton', async () => {
    stubTickets(PAUSED);
    const { user } = await openBoard();

    await user.click(within(notice()).getByRole('button', { name: OPEN }));

    const toggle = screen.getByRole('button', { name: /^En pause/ });
    expect(toggle.getAttribute('aria-expanded')).toBe('true');
    expect(titlesIn(screen.getByRole('region', { name: 'En pause' }))).toEqual(['Reporté à plus tard', 'Idée épinglée', 'En relecture']);
    expect(document.activeElement).toBe(toggle);
    expect(within(notice()).queryByRole('button', { name: OPEN })).toBeNull();
  });

  it('le tiroir ouvert à la main se referme à la main, l’état vide n’y touche pas', async () => {
    stubTickets(PAUSED);
    const { user } = await openBoard();
    const toggle = screen.getByRole('button', { name: /^En pause/ });

    await user.click(toggle);
    expect(within(notice()).queryByRole('button', { name: OPEN })).toBeNull();
    await user.click(toggle);

    expect(screen.queryByRole('region', { name: 'En pause' })).toBeNull();
    expect(within(notice()).getByRole('button', { name: OPEN })).toBeTruthy();
  });

  it('parle au singulier d’un seul ticket en pause', async () => {
    stubTickets([PAUSED[0]!]);
    await openBoard();

    const text = screen.getByText('Le seul ticket du tableau est en pause').closest('[role="status"]')?.textContent;
    expect(text).toContain('il attend dans le tiroir « En pause »');
  });

  it('ne dit rien dès qu’une colonne a une carte : le tableau s’ouvre sur cette colonne', async () => {
    stubTickets([...PAUSED, issue({ id: 'bdesk-4', title: 'Prêt à démarrer' })]);
    await openBoard();

    expect(screen.queryByText(/sont tous en pause/)).toBeNull();
    expect(screen.queryByRole('button', { name: OPEN })).toBeNull();
    expect(titlesIn(column('Prêt'))).toEqual(['Prêt à démarrer']);
    expect(columns().filter((region) => region.getAttribute('data-shown') === 'true').map((region) => region.getAttribute('data-column'))).toEqual(['ready']);
  });

  it('ne dit rien quand rien n’est en pause, même si le tableau n’a aucune carte', async () => {
    stubTickets([issue({ id: 'bdesk-1', title: 'Ancien', status: 'closed', closedAt: ago(90) })]);
    await openBoard();

    expect(screen.queryByRole('button', { name: OPEN })).toBeNull();
    expect(screen.queryByText(/sont tous en pause|est en pause/)).toBeNull();
  });

  it('suit le filtre Epic : les Enfants de l’Epic choisie sont tous en pause, le reste du Projet non', async () => {
    stubTickets([
      issue({ id: 'bdesk-e1', title: 'Livraison', type: 'epic' }),
      issue({ id: 'bdesk-1', title: 'Enfant reporté', status: 'deferred', parentId: 'bdesk-e1' }),
      issue({ id: 'bdesk-2', title: 'Prêt, hors de l’Epic' }),
    ]);
    const { user } = await openBoard();
    expect(screen.queryByRole('button', { name: OPEN })).toBeNull();

    await user.selectOptions(screen.getByRole('combobox', { name: 'Epic' }), 'bdesk-e1');

    expect(await screen.findByText('Le seul ticket du tableau est en pause')).toBeTruthy();
    expect(screen.getByRole('button', { name: OPEN })).toBeTruthy();
  });
});

describe('Terminé', () => {
  it('garde les 14 derniers jours, et dit combien de tickets fermés plus tôt restent de côté', async () => {
    stubTickets();
    await openBoard();

    const done = column('Terminé');
    expect(titlesIn(done)).toEqual(['Fermé hier']);
    expect(done.textContent).toContain('1 autre fermé plus tôt');
    expect(within(done).getByRole('combobox', { name: 'Durée de Terminé' })).toHaveProperty('value', '14');
  });

  it('prend sa durée dans l’adresse : ?done=30', async () => {
    stubTickets();
    await openBoard('/p/bdesk/kanban?done=30');

    expect(titlesIn(column('Terminé'))).toEqual(['Fermé hier', 'Fermé il y a vingt jours']);
    expect(within(column('Terminé')).getByRole('combobox', { name: 'Durée de Terminé' })).toHaveProperty('value', '30');
  });

  it('se règle depuis la colonne, et l’adresse s’en souvient', async () => {
    stubTickets();
    const { user, router } = await openBoard();

    await user.selectOptions(within(column('Terminé')).getByRole('combobox', { name: 'Durée de Terminé' }), '30');

    await waitFor(() => expect(search(router)).toBe('?done=30'));
    expect(titlesIn(column('Terminé'))).toEqual(['Fermé hier', 'Fermé il y a vingt jours']);

    await user.selectOptions(within(column('Terminé')).getByRole('combobox', { name: 'Durée de Terminé' }), '14');
    await waitFor(() => expect(search(router)).toBe(''));
  });

  it('retombe sur 14 jours quand l’adresse porte une durée invalide', async () => {
    stubTickets();
    await openBoard('/p/bdesk/kanban?done=beaucoup');

    expect(titlesIn(column('Terminé'))).toEqual(['Fermé hier']);
  });

  it('montre la durée de l’adresse dans le réglage, même hors des durées proposées', async () => {
    stubTickets();
    await openBoard('/p/bdesk/kanban?done=21');

    const select = within(column('Terminé')).getByRole('combobox', { name: 'Durée de Terminé' }) as HTMLSelectElement;
    expect(select.value).toBe('21');
    expect([...select.options].map((option) => option.value)).toEqual(['7', '14', '21', '30', '90']);
  });
});

describe('Terminé, en jours calendaires du navigateur', () => {
  // Lundi 26 octobre 2026, 10:00 à Paris. Les 14 jours commencent le mardi 13 octobre, à minuit (heure d'été).
  freezeClock('2026-10-26T09:00:00Z');

  const closedTicket = (id: string, closedAt: string | null, extra: Partial<Issue> = {}) =>
    issue({ id: `bdesk-${id}`, title: `Fermé ${id}`, status: 'closed', closedAt, updatedAt: closedAt ?? '2026-10-01T09:00:00Z', ...extra });

  it('garde les 14 derniers jours calendaires, aujourd’hui compris : pas une fenêtre glissante de 14 × 24 h', async () => {
    stubTickets([
      closedTicket('aujourdhui', '2026-10-26T07:30:00Z'),
      closedTicket('premier-jour', '2026-10-12T22:00:00Z'), // 13 octobre, 00:00 heure locale
      closedTicket('veille-du-premier-jour', '2026-10-12T21:59:59.999Z'), // 12 octobre, 23:59:59.999
      closedTicket('quatorze-jours-avant', '2026-10-12T15:00:00Z'), // 12 octobre, 17:00 : la fenêtre glissante le gardait
      closedTicket('ancien', '2026-09-01T10:00:00Z'),
    ]);
    await openBoard();

    const done = column('Terminé');
    expect(titlesIn(done)).toEqual(['Fermé aujourdhui', 'Fermé premier-jour']);
    expect(announcedCount(done)).toBe('2 tickets');
    expect(done.textContent).toContain('3 autres fermés plus tôt');
  });

  it('dit la règle réelle : « ces 14 derniers jours », avec le premier jour et « aujourd’hui compris » en infobulle', async () => {
    stubTickets([closedTicket('aujourdhui', '2026-10-26T07:30:00Z')]);
    await openBoard();

    const hint = within(column('Terminé')).getByText('Fermé ces 14 derniers jours');
    expect(hint.getAttribute('title')).toContain('aujourd’hui compris');
    expect(hint.getAttribute('title')).toContain('mardi 13 octobre');
    expect(hint.getAttribute('title')).not.toContain('moins de');
  });

  it('se limite à aujourd’hui avec ?done=1, et le dit au singulier', async () => {
    stubTickets([
      closedTicket('aujourdhui', '2026-10-25T23:00:00Z'), // 26 octobre, 00:00 heure locale
      closedTicket('hier', '2026-10-25T22:59:59Z'), // 25 octobre, 23:59:59
    ]);
    await openBoard('/p/bdesk/kanban?done=1');

    const done = column('Terminé');
    expect(titlesIn(done)).toEqual(['Fermé aujourdhui']);
    expect(within(done).getByText('Fermé aujourd’hui')).toBeTruthy();
    const select = within(done).getByRole('combobox', { name: 'Durée de Terminé' }) as HTMLSelectElement;
    expect(select.value).toBe('1');
    expect(select.selectedOptions[0]?.textContent).toBe('1 jour');
  });

  it('dit « Aucun ticket fermé aujourd’hui » quand rien ne l’a été aujourd’hui', async () => {
    stubTickets([closedTicket('hier', '2026-10-25T10:00:00Z')]);
    await openBoard('/p/bdesk/kanban?done=1');

    expect(within(column('Terminé')).getByText('Aucun ticket fermé aujourd’hui')).toBeTruthy();
  });

  it('range Terminé par date de clôture, la plus récente d’abord, quelles que soient priorité et mise à jour', async () => {
    stubTickets([
      closedTicket('p0-ancien', '2026-10-20T09:00:00Z', { priority: 0, updatedAt: '2026-10-26T08:00:00Z' }),
      closedTicket('p3-recent', '2026-10-26T08:30:00Z', { priority: 3, updatedAt: '2026-10-01T09:00:00Z' }),
      closedTicket('p2-milieu', '2026-10-23T09:00:00Z', { priority: 2 }),
    ]);
    await openBoard();

    expect(titlesIn(column('Terminé'))).toEqual(['Fermé p3-recent', 'Fermé p2-milieu', 'Fermé p0-ancien']);
  });

  it('garde priorité puis mise à jour pour les autres colonnes', async () => {
    stubTickets([
      issue({ id: 'bdesk-b', title: 'Basse récente', priority: 3, updatedAt: '2026-10-26T08:00:00Z' }),
      issue({ id: 'bdesk-a', title: 'Critique ancienne', priority: 0, updatedAt: '2026-10-01T08:00:00Z' }),
    ]);
    await openBoard();

    expect(titlesIn(column('Prêt'))).toEqual(['Critique ancienne', 'Basse récente']);
  });

  it('ne compte pas les fermés sans date de clôture parmi « les autres fermés plus tôt » : ils ont leur propre ligne', async () => {
    stubTickets([
      closedTicket('recent', '2026-10-26T07:30:00Z'),
      closedTicket('ancien-1', '2026-08-01T10:00:00Z'),
      closedTicket('ancien-2', '2026-07-01T10:00:00Z'),
      closedTicket('sans-date', null),
    ]);
    await openBoard();

    const done = column('Terminé');
    expect(within(done).getByText('2 autres fermés plus tôt')).toBeTruthy();
    expect(within(done).getByText('1 fermé sans date de clôture')).toBeTruthy();
    expect(done.textContent).not.toContain('3 autres');
  });

  it('n’écrit « plus tôt » que pour des tickets datés : un seul ticket sans date n’est pas « fermé plus tôt »', async () => {
    stubTickets([closedTicket('sans-date', null), issue({ id: 'bdesk-1', title: 'Ouvert' })]);
    await openBoard();

    const done = column('Terminé');
    expect(within(done).getByText('1 fermé sans date de clôture')).toBeTruthy();
    expect(done.textContent).not.toContain('plus tôt');
  });

  it('n’écrit rien quand aucun ticket fermé n’est laissé de côté', async () => {
    stubTickets([closedTicket('recent', '2026-10-26T07:30:00Z')]);
    await openBoard();

    expect(column('Terminé').textContent).not.toContain('plus tôt');
    expect(column('Terminé').textContent).not.toContain('sans date');
  });
});

describe('l’âge d’une carte suit les jours calendaires du navigateur, comme Terminé', () => {
  const closedAt = (id: string, closed: string) =>
    issue({ id: `bdesk-${id}`, title: `Fermé ${id}`, status: 'closed', closedAt: closed, updatedAt: closed });
  /** ICU met une espace insécable fine entre le nombre et l'unité (« 10 h ») : on compare avec des espaces ordinaires. */
  const clean = (text: string | null | undefined) => (text ?? '').replace(/[\u202f\u00a0]/g, ' ');
  /** Ce que la première carte dit de son âge : « Fermé » (lu par les lecteurs d'écran) puis l'âge. */
  const ageOf = (region: HTMLElement) => clean(region.querySelector('li time')?.textContent);
  /** Titre et âge de chaque carte, dans l'ordre. */
  const agesIn = (region: HTMLElement) =>
    within(region)
      .getAllByRole('listitem')
      .map((card) => [clean(card.querySelector('a')?.textContent), clean(card.querySelector('time')?.textContent)]);

  describe('le mercredi 4 novembre 2026, 10:00 à Paris', () => {
    freezeClock('2026-11-04T09:00:00Z');

    it('une clôture d’avant-hier à 23:00 (35 h) dit « avant-hier », pas « hier »', async () => {
      stubTickets([closedAt('soir', '2026-11-02T22:00:00Z')]);
      await openBoard('/p/bdesk/kanban?done=3');

      const done = column('Terminé');
      expect(titlesIn(done)).toEqual(['Fermé soir']);
      expect(ageOf(done)).toBe('Fermé avant-hier');
    });

    it('dit « hier » dès 24 h, et une durée tant que moins de 24 h ont passé', async () => {
      stubTickets([closedAt('hier', '2026-11-03T09:00:00Z'), closedAt('nuit', '2026-11-03T22:30:00Z')]);
      await openBoard('/p/bdesk/kanban?done=2');

      // Triées par clôture, la plus récente d'abord : 23:30 hier soir (10 h 30 min), puis 10:00 hier (24 h).
      expect(agesIn(column('Terminé'))).toEqual([
        ['Fermé nuit', 'Fermé il y a 10 h'],
        ['Fermé hier', 'Fermé hier'],
      ]);
    });
  });

  describe('le dimanche 25 octobre 2026, à 23:59 : le jour a duré 25 h', () => {
    freezeClock('2026-10-25T22:59:00Z');

    it('un ticket fermé à 00:00:30 est dans « Fermé aujourd’hui », et sa carte dit « aujourd’hui », pas « hier »', async () => {
      stubTickets([closedAt('apres-minuit', '2026-10-24T22:00:30Z'), closedAt('veille', '2026-10-24T21:59:30Z')]);
      await openBoard('/p/bdesk/kanban?done=1');

      const done = column('Terminé');
      expect(within(done).getByText('Fermé aujourd’hui')).toBeTruthy();
      expect(titlesIn(done)).toEqual(['Fermé apres-minuit']);
      expect(ageOf(done)).toBe('Fermé aujourd’hui');
    });

    it('une clôture de la veille à 23:59:30 reste « hier » : sur la fenêtre de deux jours, elle est la deuxième', async () => {
      stubTickets([closedAt('apres-minuit', '2026-10-24T22:00:30Z'), closedAt('veille', '2026-10-24T21:59:30Z')]);
      await openBoard('/p/bdesk/kanban?done=2');

      expect(agesIn(column('Terminé'))).toEqual([
        ['Fermé apres-minuit', 'Fermé aujourd’hui'],
        ['Fermé veille', 'Fermé hier'],
      ]);
    });
  });
});

describe('le filtre Epic', () => {
  it('liste les Epics du Projet, et rien quand il n’y en a pas', async () => {
    stubTickets();
    await openBoard();
    const select = screen.getByRole('combobox', { name: 'Epic' }) as HTMLSelectElement;
    expect([...select.options].map((option) => option.textContent)).toEqual([
      'Toutes les Epics',
      'Shell UI : thèmes, navigation et raccourcis',
      'Détail de ticket : panneau latéral',
    ]);
  });

  it('ne s’affiche pas dans un Projet sans Epic', async () => {
    stubTickets([issue({ id: 'bdesk-1', title: 'Seul ticket' })]);
    await openBoard();

    expect(screen.queryByRole('combobox', { name: 'Epic' })).toBeNull();
  });

  it('limite le tableau aux Enfants de l’Epic choisie, et le dit dans l’adresse (?epic=)', async () => {
    stubTickets();
    const { user, router } = await openBoard();

    await user.selectOptions(screen.getByRole('combobox', { name: 'Epic' }), 'bdesk-e1');

    await waitFor(() => expect(search(router)).toBe('?epic=bdesk-e1'));
    expect(titlesIn(column('Prêt'))).toEqual(['Palette ⌘K']);
    expect(titlesIn(column('Backlog'))).toEqual(['Raccourcis clavier']);
    expect(titlesIn(column('En cours'))).toEqual(['Barre latérale']);
    expect(titlesIn(column('Bloqué'))).toEqual([]);
    expect(titlesIn(column('Terminé'))).toEqual([]);
    expect(screen.getByText('3 tickets')).toBeTruthy();
  });

  it('ne répète pas, sur chaque carte, la pastille de l’Epic choisie', async () => {
    stubTickets();
    const { user } = await openBoard();
    expect(screen.getAllByRole('link', { name: 'Epic : Shell UI' }).length).toBeGreaterThan(0);

    await user.selectOptions(screen.getByRole('combobox', { name: 'Epic' }), 'bdesk-e1');

    await waitFor(() => expect(screen.queryByRole('link', { name: 'Epic : Shell UI' })).toBeNull());
    expect(titlesIn(column('Prêt'))).toEqual(['Palette ⌘K']);
  });

  it('garde la pastille d’une Epic imbriquée : elle dit où la carte se range dans l’Epic choisie', async () => {
    stubTickets([
      issue({ id: 'bdesk-e1', title: 'Livraison V1', type: 'epic' }),
      issue({ id: 'bdesk-e2', title: 'Détail : panneau latéral', type: 'epic', parentId: 'bdesk-e1' }),
      issue({ id: 'bdesk-1', title: 'Directe', parentId: 'bdesk-e1' }),
      issue({ id: 'bdesk-2', title: 'Imbriquée', parentId: 'bdesk-e2' }),
    ]);
    await openBoard('/p/bdesk/kanban?epic=bdesk-e1');

    const ready = column('Prêt');
    expect(within(within(ready).getByText('Directe').closest('li') as HTMLElement).queryByRole('link', { name: /^Epic/ })).toBeNull();
    expect(within(within(ready).getByText('Imbriquée').closest('li') as HTMLElement).getByRole('link', { name: 'Epic : Détail' })).toBeTruthy();
  });

  it('s’ouvre déjà filtré quand l’adresse porte ?epic=<id>', async () => {
    stubTickets();
    await openBoard('/p/bdesk/kanban?epic=bdesk-e2');

    expect((screen.getByRole('combobox', { name: 'Epic' }) as HTMLSelectElement).value).toBe('bdesk-e2');
    expect(titlesIn(column('Bloqué'))).toEqual(['Panneau en attente du spike']);
    expect(titlesIn(column('Terminé'))).toEqual(['Fermé hier']);
    expect(titlesIn(column('Prêt'))).toEqual([]);
  });

  it('se retire en revenant à « Toutes les Epics »', async () => {
    stubTickets();
    const { user, router } = await openBoard('/p/bdesk/kanban?epic=bdesk-e1');

    await user.selectOptions(screen.getByRole('combobox', { name: 'Epic' }), '');

    await waitFor(() => expect(search(router)).toBe(''));
    expect(titlesIn(column('Prêt'))).toHaveLength(2);
  });

  it('garde les autres réglages de l’adresse en changeant d’Epic', async () => {
    stubTickets();
    const { user, router } = await openBoard('/p/bdesk/kanban?done=30&col=ready');

    await user.selectOptions(screen.getByRole('combobox', { name: 'Epic' }), 'bdesk-e1');

    await waitFor(() => expect(new URLSearchParams(search(router)).get('epic')).toBe('bdesk-e1'));
    expect(new URLSearchParams(search(router)).get('done')).toBe('30');
    expect(new URLSearchParams(search(router)).get('col')).toBe('ready');
  });

  it('prévient quand l’Epic de l’adresse n’existe pas, et montre tout le tableau', async () => {
    stubTickets();
    const { user, router } = await openBoard('/p/bdesk/kanban?epic=fantome');

    expect(await screen.findByText(/Aucune Epic « fantome »/)).toBeTruthy();
    expect(titlesIn(column('Prêt'))).toHaveLength(2);

    await user.click(screen.getByRole('button', { name: 'Retirer le filtre' }));
    await waitFor(() => expect(search(router)).toBe(''));
    expect(screen.queryByText(/Aucune Epic « fantome »/)).toBeNull();
  });

  it('ne prend pas un ticket ordinaire pour une Epic', async () => {
    stubTickets();
    await openBoard('/p/bdesk/kanban?epic=bdesk-a1');

    expect(await screen.findByText(/Aucune Epic « bdesk-a1 »/)).toBeTruthy();
  });

  describe('deux Epics qui portent le même titre', () => {
    const options = () =>
      [...(screen.getByRole('combobox', { name: 'Epic' }) as HTMLSelectElement).options].map((option) => option.textContent);

    it('se distinguent par leur identifiant, les autres gardent leur seul titre', async () => {
      stubTickets([
        issue({ id: 'bdesk-e1', title: 'Refonte', type: 'epic', priority: 1 }),
        issue({ id: 'bdesk-e2', title: 'Refonte', type: 'epic', priority: 2 }),
        issue({ id: 'bdesk-e3', title: 'Distribution', type: 'epic', priority: 3 }),
      ]);
      await openBoard();

      expect(options()).toEqual(['Toutes les Epics', 'Refonte (bdesk-e1)', 'Refonte (bdesk-e2)', 'Distribution']);
    });

    it('se distinguent aussi quand l’une est ouverte et l’autre fermée, sans tenir compte de la casse', async () => {
      stubTickets([
        issue({ id: 'bdesk-e1', title: 'Refonte', type: 'epic' }),
        issue({ id: 'bdesk-e2', title: 'refonte', type: 'epic', status: 'closed' }),
      ]);
      await openBoard();

      expect(options()).toEqual(['Toutes les Epics', 'Refonte (bdesk-e1)', 'refonte (bdesk-e2)']);
    });

    it('filtrent chacune leurs propres Enfants', async () => {
      stubTickets([
        issue({ id: 'bdesk-e1', title: 'Refonte', type: 'epic', priority: 1 }),
        issue({ id: 'bdesk-e2', title: 'Refonte', type: 'epic', priority: 2 }),
        issue({ id: 'bdesk-1', title: 'Enfant de la première', parentId: 'bdesk-e1' }),
        issue({ id: 'bdesk-2', title: 'Enfant de la seconde', parentId: 'bdesk-e2' }),
      ]);
      const { user } = await openBoard();

      await user.selectOptions(screen.getByRole('combobox', { name: 'Epic' }), 'bdesk-e2');

      await waitFor(() => expect(titlesIn(column('Prêt'))).toEqual(['Enfant de la seconde']));
    });
  });
});

describe('le sélecteur de colonne (mobile)', () => {
  const selector = () => screen.getByRole('group', { name: 'Colonne affichée' });
  const shown = () =>
    columns()
      .filter((region) => region.getAttribute('data-shown') === 'true')
      .map((region) => region.getAttribute('data-column'));

  it('propose les cinq colonnes avec leur nombre de cartes', async () => {
    stubTickets();
    await openBoard();

    const buttons = within(selector()).getAllByRole('button');
    expect(buttons.map((button) => button.textContent)).toEqual([
      'Backlog1 ticket',
      'Prêt2 tickets',
      'En cours2 tickets',
      'Bloqué2 tickets',
      'Terminé1 ticket',
    ]);
  });

  it('ouvre sur En cours quand elle a des cartes', async () => {
    stubTickets();
    await openBoard();

    expect(shown()).toEqual(['inProgress']);
    expect(within(selector()).getByRole('button', { name: /^En cours/ }).getAttribute('aria-pressed')).toBe('true');
    expect(within(selector()).getByRole('button', { name: /^Prêt/ }).getAttribute('aria-pressed')).toBe('false');
  });

  it('ouvre sur la première colonne qui a des cartes quand En cours est vide', async () => {
    stubTickets([issue({ id: 'bdesk-1', title: 'Seul ticket' })]);
    await openBoard();

    expect(shown()).toEqual(['ready']);
  });

  it('change de colonne au toucher, et retient le choix dans l’adresse (?col=) sans empiler l’historique', async () => {
    stubTickets();
    const { user, router } = await openBoard();

    await user.click(within(selector()).getByRole('button', { name: /^Backlog/ }));

    await waitFor(() => expect(search(router)).toBe('?col=backlog'));
    expect(shown()).toEqual(['backlog']);
    expect(within(selector()).getByRole('button', { name: /^Backlog/ }).getAttribute('aria-pressed')).toBe('true');
    // Changer de colonne ne s'ajoute pas à l'historique : « Retour » quitte le kanban au lieu de rejouer les choix.
    expect(router.state.historyAction).toBe('REPLACE');
  });

  it('rouvre la colonne de l’adresse', async () => {
    stubTickets();
    await openBoard('/p/bdesk/kanban?col=done');

    expect(shown()).toEqual(['done']);
  });

  it('ignore une colonne inconnue', async () => {
    stubTickets();
    await openBoard('/p/bdesk/kanban?col=nimporte');

    expect(shown()).toEqual(['inProgress']);
  });

  describe('sans ?col=, la colonne est choisie au premier chargement et gardée', () => {
    const working = (extra: Partial<Issue> = {}) => issue({ id: 'bdesk-1', title: 'En travail', status: 'in_progress', ...extra });
    const todo = issue({ id: 'bdesk-2', title: 'À faire' });

    it('ne saute pas ailleurs quand un rafraîchissement des données vide la colonne affichée', async () => {
      stubTickets([working(), todo]);
      const { queryClient } = await openBoard();
      expect(shown()).toEqual(['inProgress']);

      // Le ticket en cours a été fermé depuis : au rafraîchissement, En cours est vide.
      stubTickets([working({ status: 'closed', closedAt: ago(0) }), todo]);
      await queryClient.invalidateQueries({ queryKey: queryKeys.issues('bdesk') });

      await waitFor(() => expect(titlesIn(column('En cours'))).toEqual([]));
      expect(shown()).toEqual(['inProgress']);
      expect(within(column('En cours')).getByText('Aucun ticket')).toBeTruthy();
      expect(within(selector()).getByRole('button', { name: /^En cours/ }).getAttribute('aria-pressed')).toBe('true');
    });

    it('ne saute pas non plus quand une autre colonne se remplit', async () => {
      stubTickets([todo]);
      const { queryClient } = await openBoard();
      expect(shown()).toEqual(['ready']);

      // Un ticket passe en cours : l'ancienne règle aurait suivi En cours, la colonne a priorité à l'ouverture.
      stubTickets([working(), todo]);
      await queryClient.invalidateQueries({ queryKey: queryKeys.issues('bdesk') });

      await waitFor(() => expect(titlesIn(column('En cours'))).toEqual(['En travail']));
      expect(shown()).toEqual(['ready']);
    });

    it('reste celle que l’utilisateur a choisie, et l’adresse la retient', async () => {
      stubTickets([working(), todo]);
      const { user, router, queryClient } = await openBoard();

      await user.click(within(selector()).getByRole('button', { name: /^Prêt/ }));
      await waitFor(() => expect(search(router)).toBe('?col=ready'));
      stubTickets([todo]);
      await queryClient.invalidateQueries({ queryKey: queryKeys.issues('bdesk') });

      await waitFor(() => expect(titlesIn(column('En cours'))).toEqual([]));
      expect(shown()).toEqual(['ready']);
    });

    it('reste la même quand on change d’Epic, même si elle n’y a plus de carte', async () => {
      stubTickets([
        issue({ id: 'bdesk-e1', title: 'Epic', type: 'epic' }),
        working(),
        issue({ id: 'bdesk-3', title: 'Dans l’Epic', parentId: 'bdesk-e1' }),
      ]);
      const { user } = await openBoard();
      expect(shown()).toEqual(['inProgress']);

      await user.selectOptions(screen.getByRole('combobox', { name: 'Epic' }), 'bdesk-e1');

      await waitFor(() => expect(titlesIn(column('Prêt'))).toEqual(['Dans l’Epic']));
      expect(shown()).toEqual(['inProgress']);
      expect(within(column('En cours')).getByText('Aucun ticket')).toBeTruthy();
    });

    it('est rechoisie en changeant de Projet, même quand les tickets de l’autre sont déjà en mémoire', async () => {
      stubApi({
        projects: projectsResponse,
        issues: { bdesk: [working(), todo], mpm: [issue({ id: 'mpm-1', title: 'Seul ticket de l’autre Projet' })] },
      });
      const { router } = await openBoard('/p/mpm/kanban');
      expect(shown()).toEqual(['ready']);

      await act(() => router.navigate('/p/bdesk/kanban'));
      await waitFor(() => expect(screen.getByText('En travail')).toBeTruthy());
      expect(shown()).toEqual(['inProgress']);

      // Les tickets de mpm sont en mémoire : le tableau s'affiche d'emblée, sans passer par le chargement.
      await act(() => router.navigate('/p/mpm/kanban'));
      await waitFor(() => expect(screen.getByText('Seul ticket de l’autre Projet')).toBeTruthy());
      expect(shown()).toEqual(['ready']);
    });
  });

  describe('un Projet qui n’a que de vieux tickets fermés', () => {
    it('ouvre sur Terminé, qui dit combien sont fermés plus tôt, au lieu d’un « Aucun ticket » sans contexte', async () => {
      stubTickets([
        issue({ id: 'bdesk-1', title: 'Ancien 1', status: 'closed', closedAt: ago(40) }),
        issue({ id: 'bdesk-2', title: 'Ancien 2', status: 'closed', closedAt: ago(90) }),
        issue({ id: 'bdesk-3', title: 'Ancien 3', status: 'closed', closedAt: ago(200) }),
      ]);
      await openBoard();

      expect(shown()).toEqual(['done']);
      const done = column('Terminé');
      expect(within(done).getByText('Aucun ticket fermé ces 14 derniers jours')).toBeTruthy();
      expect(within(done).getByText('3 autres fermés plus tôt')).toBeTruthy();
    });

    it('ouvre aussi sur Terminé quand les seuls tickets fermés n’ont pas de date de clôture', async () => {
      stubTickets([issue({ id: 'bdesk-1', title: 'Sans date', status: 'closed', closedAt: null })]);
      await openBoard();

      expect(shown()).toEqual(['done']);
      expect(within(column('Terminé')).getByText('1 fermé sans date de clôture')).toBeTruthy();
    });

    it('laisse le choix de l’adresse (?col=) l’emporter', async () => {
      stubTickets([issue({ id: 'bdesk-1', title: 'Ancien', status: 'closed', closedAt: ago(40) })]);
      await openBoard('/p/bdesk/kanban?col=backlog');

      expect(shown()).toEqual(['backlog']);
    });
  });
});

describe('les raccourcis du kanban', () => {
  const link = (name: string) => screen.getByRole('link', { name });

  it('« j » et « k » se déplacent de carte en carte, sans dépasser les bords', async () => {
    stubTickets();
    const { user } = await openBoard();

    await user.keyboard('j');
    expect(document.activeElement).toBe(link('Barre latérale'));
    await user.keyboard('j');
    expect(document.activeElement).toBe(link('Revue automatique'));
    await user.keyboard('j');
    expect(document.activeElement).toBe(link('Revue automatique'));
    await user.keyboard('k');
    expect(document.activeElement).toBe(link('Barre latérale'));
    await user.keyboard('k');
    expect(document.activeElement).toBe(link('Barre latérale'));
  });

  it('« k » sans sélection va à la dernière carte de la colonne', async () => {
    stubTickets();
    const { user } = await openBoard();

    await user.keyboard('k');

    expect(document.activeElement).toBe(link('Revue automatique'));
  });

  it('« Entrée » ouvre le ticket sélectionné', async () => {
    stubTickets();
    const { user, router } = await openBoard();

    await user.keyboard('jj{Enter}');

    await waitFor(() => expect(router.state.location.pathname).toBe('/p/bdesk/t/bdesk-c2'));
  });

  it('« Échap » désélectionne', async () => {
    stubTickets();
    const { user } = await openBoard();

    await user.keyboard('j');
    expect(document.activeElement).toBe(link('Barre latérale'));
    await user.keyboard('{Escape}');

    expect(document.activeElement).toBe(document.body);
  });

  it('« l » et « h » (ou les flèches) changent de colonne, à la même hauteur ou au plus près', async () => {
    stubTickets();
    const { user } = await openBoard();

    await user.keyboard('jj');
    expect(document.activeElement).toBe(link('Revue automatique'));

    // Bloqué : même rang (2e carte).
    await user.keyboard('l');
    expect(document.activeElement).toBe(link('Attente d’un retour'));
    await user.keyboard('{ArrowRight}');
    // Terminé n'a qu'une carte : la plus proche.
    expect(document.activeElement).toBe(link('Fermé hier'));
    await user.keyboard('l');
    expect(document.activeElement).toBe(link('Fermé hier'));
    await user.keyboard('h');
    expect(document.activeElement).toBe(link('Panneau en attente du spike'));
    await user.keyboard('{ArrowLeft}');
    expect(document.activeElement).toBe(link('Barre latérale'));
  });

  it('saute les colonnes vides et suit la colonne dans l’adresse', async () => {
    stubTickets([
      issue({ id: 'bdesk-1', title: 'Prêt', status: 'open' }),
      issue({ id: 'bdesk-2', title: 'Fini', status: 'closed', closedAt: ago(1) }),
    ]);
    const { user, router } = await openBoard();

    await user.keyboard('j');
    expect(document.activeElement).toBe(link('Prêt'));
    await user.keyboard('l');
    expect(document.activeElement).toBe(link('Fini'));
    await waitFor(() => expect(search(router)).toBe('?col=done'));
    await user.keyboard('h');
    expect(document.activeElement).toBe(link('Prêt'));
  });

  it('« l » sans sélection passe à la colonne suivante qui a des cartes et sélectionne sa première carte', async () => {
    stubTickets();
    const { user } = await openBoard();

    await user.keyboard('l');

    expect(document.activeElement).toBe(link('Panneau en attente du spike'));
  });

  it('ne fait rien quand le tableau est vide', async () => {
    stubTickets([issue({ id: 'bdesk-1', title: 'Fermé trop tôt', status: 'closed', closedAt: ago(90) })]);
    const { user } = await openBoard();

    await user.keyboard('jklh');

    expect(document.activeElement).toBe(document.body);
  });

  /**
   * Note si le registre a détourné la touche (`preventDefault`). Écoutée après lui, sur la même cible (window), elle
   * lit l'événement une fois que le registre l'a vu. À arrêter en fin de test : window survit aux tests.
   */
  function watchKeyDefaults() {
    const prevented: boolean[] = [];
    const controller = new AbortController();
    window.addEventListener('keydown', (event) => prevented.push(event.defaultPrevented), { signal: controller.signal });
    return { prevented, stop: () => controller.abort() };
  }

  it('laisse « Entrée » à un bouton qui a le focus hors d’une carte : le bouton agit, pas le kanban', async () => {
    stubTickets();
    const { user, router } = await openBoard();
    const keys = watchKeyDefaults();

    const toggle = screen.getByRole('button', { name: /^En pause/ });
    toggle.focus();
    await user.keyboard('{Enter}');
    keys.stop();

    // Une seule activation : le kanban qui aurait cliqué en plus l'aurait refermé.
    expect(toggle.getAttribute('aria-expanded')).toBe('true');
    // Le registre n'a pas détourné la touche : c'est l'action native du bouton qui a eu lieu.
    expect(keys.prevented).toEqual([false]);
    expect(router.state.location.pathname).toBe('/p/bdesk/kanban');
  });

  it('laisse « Entrée » à un lien hors d’une carte : celui de la barre latérale se suit tout seul', async () => {
    stubTickets();
    const { user, router } = await openBoard();
    const keys = watchKeyDefaults();

    const link = within(screen.getByRole('navigation', { name: 'Navigation principale' })).getByRole('link', { name: /Vue globale/ });
    link.focus();
    await user.keyboard('{Enter}');
    keys.stop();

    expect(keys.prevented).toEqual([false]);
    await waitFor(() => expect(router.state.location.pathname).toBe('/'));
  });

  it('« Entrée » sur une carte sélectionnée ouvre le ticket par son lien, sans que le kanban détourne la touche', async () => {
    stubTickets();
    const { user, router } = await openBoard();
    const keys = watchKeyDefaults();

    await user.keyboard('jj{Enter}');
    keys.stop();

    await waitFor(() => expect(router.state.location.pathname).toBe('/p/bdesk/t/bdesk-c2'));
    // j, j, Entrée : les deux premières sont des raccourcis, la dernière revient à l'élément qui a le focus.
    expect(keys.prevented).toEqual([true, true, false]);
  });

  it('laisse les flèches à la liste d’Epics et à la durée de Terminé : la colonne et le choix ne bougent pas', async () => {
    stubTickets();
    const { user, router } = await openBoard();
    const keys = watchKeyDefaults();

    const epics = screen.getByRole('combobox', { name: 'Epic' });
    epics.focus();
    await user.keyboard('{ArrowRight}{ArrowLeft}');
    const doneDays = within(column('Terminé')).getByRole('combobox', { name: 'Durée de Terminé' });
    doneDays.focus();
    await user.keyboard('{ArrowRight}{ArrowLeft}');
    keys.stop();

    expect(keys.prevented).toEqual([false, false, false, false]);
    expect(search(router)).toBe('');
    expect(document.activeElement).toBe(doneDays);
  });

  it('s’éteignent quand le curseur est dans un champ : la liste d’Epics garde ses flèches', async () => {
    stubTickets();
    const { user } = await openBoard();

    screen.getByRole('combobox', { name: 'Epic' }).focus();
    await user.keyboard('j');

    expect(document.activeElement).toBe(screen.getByRole('combobox', { name: 'Epic' }));
  });

  it('« Échap » sans carte sélectionnée n’est pas consommé : le navigateur et les autres écouteurs la gardent', async () => {
    stubTickets();
    const { user } = await openBoard();
    const keys = watchKeyDefaults();

    await user.keyboard('{Escape}');
    keys.stop();

    expect(keys.prevented).toEqual([false]);
  });

  it('« Échap » sur une carte sélectionnée la désélectionne et est consommé, une seule fois', async () => {
    stubTickets();
    const { user } = await openBoard();
    const keys = watchKeyDefaults();

    await user.keyboard('j');
    expect(document.activeElement).toBe(link('Barre latérale'));
    await user.keyboard('{Escape}');
    expect(document.activeElement).toBe(document.body);
    // Plus rien à désélectionner : la deuxième touche n'est plus consommée.
    await user.keyboard('{Escape}');
    keys.stop();

    // j, Échap (désélectionne), Échap (rien à faire).
    expect(keys.prevented).toEqual([true, true, false]);
  });

  it('« Échap » est consommé aussi quand la carte sélectionnée est dans le tiroir « En pause »', async () => {
    stubTickets();
    const { user } = await openBoard();
    await user.click(screen.getByRole('button', { name: /^En pause/ }));
    const keys = watchKeyDefaults();

    link('Reporté à plus tard').focus();
    await user.keyboard('{Escape}');
    keys.stop();

    expect(keys.prevented).toEqual([true]);
    expect(document.activeElement).toBe(document.body);
  });

  it('« Échap » dans un champ n’est pas consommé non plus : la liste d’Epics garde sa touche', async () => {
    stubTickets();
    const { user } = await openBoard();
    const keys = watchKeyDefaults();

    screen.getByRole('combobox', { name: 'Epic' }).focus();
    await user.keyboard('{Escape}');
    keys.stop();

    expect(keys.prevented).toEqual([false]);
    expect(document.activeElement).toBe(screen.getByRole('combobox', { name: 'Epic' }));
  });

  it('figurent dans l’aide « ? », sous la rubrique Kanban', async () => {
    stubTickets();
    const { user } = await openBoard();

    await user.keyboard('?');
    const help = await screen.findByRole('dialog', { name: 'Raccourcis clavier' });
    const kanban = within(help).getByRole('region', { name: 'Kanban' });

    for (const label of [
      'Ticket suivant',
      'Ticket précédent',
      'Colonne précédente',
      'Colonne suivante',
      'Ouvrir le ticket sélectionné',
      'Désélectionner le ticket',
    ]) {
      // Une seule ligne par action, même quand elle a deux touches (H ou ←).
      expect(within(kanban).getAllByText(label), label).toHaveLength(1);
    }
    expect(within(kanban).getAllByRole('listitem')).toHaveLength(6);
    const line = (label: string) => (within(kanban).getByText(label).closest('li') as HTMLElement).textContent;
    expect(line('Colonne précédente')).toBe('Colonne précédenteHou←');
    expect(line('Colonne suivante')).toBe('Colonne suivanteLou→');
    const caps = (label: string) => within(within(kanban).getAllByText(label)[0]!.closest('li') as HTMLElement).getAllByText(/.+/).map((el) => el.textContent);
    expect(caps('Ticket suivant')).toContain('J');
    expect(caps('Ticket précédent')).toContain('K');
    expect(caps('Ouvrir le ticket sélectionné')).toContain('↵');
    expect(caps('Désélectionner le ticket')).toContain('Échap');
  });
});

describe('« h » et « l » quand les cinq colonnes sont affichées (bureau)', () => {
  withWideLayout();
  const link = (name: string) => screen.getByRole('link', { name });
  /** Le tableau de TICKETS : Backlog, Prêt, En cours, Bloqué et Terminé ont tous au moins une carte. */
  const firstOf = { backlog: 'Raccourcis clavier', done: 'Fermé hier' } as const;

  it('« l » sans carte sélectionnée prend la première carte de la première colonne qui en a, « h » celle de la dernière', async () => {
    stubTickets();
    const { user } = await openBoard();

    await user.keyboard('l');
    expect(document.activeElement).toBe(link(firstOf.backlog));
    await user.keyboard('{Escape}');
    await user.keyboard('h');
    expect(document.activeElement).toBe(link(firstOf.done));
  });

  it('les flèches font de même', async () => {
    stubTickets();
    const { user } = await openBoard();

    await user.keyboard('{ArrowRight}');
    expect(document.activeElement).toBe(link(firstOf.backlog));
    await user.keyboard('{Escape}');
    await user.keyboard('{ArrowLeft}');
    expect(document.activeElement).toBe(link(firstOf.done));
  });

  it('ne part pas de la colonne d’ouverture du mobile (En cours) : « l » ne saute pas à Bloqué', async () => {
    stubTickets();
    const { user } = await openBoard();

    await user.keyboard('l');

    expect(document.activeElement).not.toBe(link('Panneau en attente du spike'));
    expect(document.activeElement).toBe(link(firstOf.backlog));
  });

  it('ne part pas non plus de la colonne de l’adresse (?col=), qui ne sert qu’au mobile', async () => {
    stubTickets();
    const { user, router } = await openBoard('/p/bdesk/kanban?col=blocked');

    await user.keyboard('l');
    expect(document.activeElement).toBe(link(firstOf.backlog));
    await user.keyboard('{Escape}');
    await user.keyboard('h');
    expect(document.activeElement).toBe(link(firstOf.done));

    expect(search(router)).toBe('?col=blocked');
  });

  it('saute les colonnes vides des bords', async () => {
    stubTickets([
      issue({ id: 'bdesk-1', title: 'Prêt', priority: 1 }),
      issue({ id: 'bdesk-2', title: 'Prêt aussi', priority: 2 }),
      issue({ id: 'bdesk-3', title: 'En travail', status: 'in_progress' }),
    ]);
    const { user } = await openBoard();

    await user.keyboard('l');
    expect(document.activeElement).toBe(link('Prêt'));
    await user.keyboard('{Escape}');
    await user.keyboard('h');
    expect(document.activeElement).toBe(link('En travail'));
  });

  it('avec une carte sélectionnée, passe à la colonne voisine à la même hauteur, sans rien écrire dans l’adresse', async () => {
    stubTickets();
    const { user, router } = await openBoard();

    await user.keyboard('jj');
    expect(document.activeElement).toBe(link('Revue automatique'));
    await user.keyboard('l');
    expect(document.activeElement).toBe(link('Attente d’un retour'));
    await user.keyboard('{ArrowRight}');
    expect(document.activeElement).toBe(link('Fermé hier'));
    await user.keyboard('h');
    expect(document.activeElement).toBe(link('Panneau en attente du spike'));

    expect(search(router)).toBe('');
  });

  it('n’écrit jamais ?col= : ce paramètre ne sert qu’au mobile', async () => {
    stubTickets();
    const { user, router } = await openBoard();

    await user.keyboard('lllllhhhhh{ArrowRight}{ArrowRight}{ArrowLeft}');

    expect(search(router)).toBe('');
    expect(router.state.location.search).not.toContain('col');
  });

  it('ne fait rien depuis le tiroir « En pause » : ce n’est pas une colonne', async () => {
    stubTickets();
    const { user } = await openBoard();
    await user.click(screen.getByRole('button', { name: /^En pause/ }));

    link('Reporté à plus tard').focus();
    await user.keyboard('lh');

    expect(document.activeElement).toBe(link('Reporté à plus tard'));
  });

  it('« j » et « k » sans sélection n’ont pas changé : ils prennent la colonne d’ouverture', async () => {
    stubTickets();
    const { user } = await openBoard();

    await user.keyboard('j');
    expect(document.activeElement).toBe(link('Barre latérale'));
  });
});

describe('« h » et « l » quand une seule colonne est affichée (mobile)', () => {
  withNarrowLayout();
  const link = (name: string) => screen.getByRole('link', { name });
  /** Les colonnes que le style laisse affichées (les autres sont hors de l'arbre d'accessibilité : `columns()` ne les voit pas). */
  const shown = () =>
    [...document.querySelectorAll<HTMLElement>('section[data-column]')]
      .filter((region) => getComputedStyle(region).display !== 'none')
      .map((region) => region.dataset.column);
  /** Ouvre le tableau et attend la colonne affichée à l'ouverture (En cours) : les autres sont cachées. */
  async function openNarrow() {
    const app = renderApp('/p/bdesk/kanban');
    await screen.findByRole('region', { name: 'En cours' });
    return app;
  }

  it('« l » sans carte sélectionnée part de la colonne affichée : la suivante, et l’adresse la retient', async () => {
    stubTickets();
    const { user, router } = await openNarrow();
    expect(shown()).toEqual(['inProgress']);

    await user.keyboard('l');

    // Bloqué n'était pas affichée : la colonne apparaît d'abord, puis le focus la rejoint.
    await waitFor(() => expect(document.activeElement).toBe(link('Panneau en attente du spike')));
    expect(shown()).toEqual(['blocked']);
    expect(search(router)).toBe('?col=blocked');
  });

  it('« h » sans carte sélectionnée part de la colonne affichée : la précédente', async () => {
    stubTickets();
    const { user, router } = await openNarrow();

    await user.keyboard('h');

    await waitFor(() => expect(document.activeElement).toBe(link('Thèmes clair et sombre')));
    expect(shown()).toEqual(['ready']);
    expect(search(router)).toBe('?col=ready');
  });

  it('avec une carte sélectionnée, fait apparaître la colonne voisine, y met le focus et écrit ?col=', async () => {
    stubTickets();
    const { user, router } = await openNarrow();

    await user.keyboard('jj');
    expect(document.activeElement).toBe(link('Revue automatique'));
    await user.keyboard('l');

    await waitFor(() => expect(document.activeElement).toBe(link('Attente d’un retour')));
    expect(shown()).toEqual(['blocked']);
    expect(search(router)).toBe('?col=blocked');
  });
});

describe('les états de la page', () => {
  it('annonce le chargement', async () => {
    stubTickets().mockImplementation(async (input) => {
      if (String(input) === '/api/projects') return new Response(JSON.stringify(projectsResponse), { status: 200 });
      return new Promise<Response>(() => undefined);
    });
    renderApp('/p/bdesk/kanban');

    expect(await screen.findByRole('status', { name: 'Chargement des tickets' })).toBeTruthy();
    expect(screen.getByRole('heading', { level: 1, name: 'Kanban' })).toBeTruthy();
  });

  it('dit qu’un Projet sans ticket est vide, et comment en créer', async () => {
    stubTickets([]);
    renderApp('/p/bdesk/kanban');

    expect(await screen.findByText('Aucun ticket dans ce Projet')).toBeTruthy();
    expect(screen.queryByRole('region', { name: 'Prêt' })).toBeNull();
  });

  it('titre « Projet illisible » un 503 avec sa raison, et laisse réessayer', async () => {
    stubApi({
      projects: projectsResponse,
      issues: {
        bdesk: httpFailure(503, {
          statusCode: 503,
          error: 'Service Unavailable',
          message: 'Projet illisible : Base Dolt verrouillée',
          reason: 'Base Dolt verrouillée',
        }),
      },
    });
    const { user } = renderApp('/p/bdesk/kanban');

    const alert = await screen.findByRole('alert');
    expect(alert.querySelector('p')?.textContent).toBe('Projet illisible');
    expect(alert.textContent).toContain('Base Dolt verrouillée');

    stubTickets();
    await user.click(within(alert).getByRole('button', { name: /Réessayer/ }));
    expect(await screen.findByRole('region', { name: 'Prêt' })).toBeTruthy();
  });

  it('explique un 404 : le Projet n’existe plus, avec le chemin de sortie', async () => {
    stubApi({
      projects: projectsResponse,
      issues: { bdesk: httpFailure(404, { statusCode: 404, error: 'Not Found', message: 'Projet inconnu : bdesk' }) },
    });
    renderApp('/p/bdesk/kanban');

    expect(await screen.findByText('Ce Projet n’est plus disponible')).toBeTruthy();
    expect(screen.getByRole('link', { name: 'Voir les Projets suivis' }).getAttribute('href')).toBe('/');
  });

  it('signale une panne serveur (500) et laisse réessayer', async () => {
    stubApi({ projects: projectsResponse, issues: { bdesk: new Error('database is locked') } });
    renderApp('/p/bdesk/kanban');

    const alert = await screen.findByRole('alert');
    expect(within(alert).getByText('Impossible de charger les tickets')).toBeTruthy();
    expect(within(alert).getByText('database is locked')).toBeTruthy();
    expect(within(alert).getByRole('button', { name: /Réessayer/ })).toBeTruthy();
  });
});
