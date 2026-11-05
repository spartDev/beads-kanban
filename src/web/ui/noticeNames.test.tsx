import { render, screen, within } from '@testing-library/react';
import { createMemoryRouter, RouterProvider } from 'react-router';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { Issue } from '../data/types';
import { RouteError } from '../pages/RouteError';
import { withAsyncTimeout } from '../test/asyncTimeout';
import { bdeskIssues, issue, projectsResponse } from '../test/fixtures';
import { httpFailure, renderApp, stubApi } from '../test/render';

/**
 * Chaque avis de l'application est une région au nom de son titre (bdesk-38k.61). `Notice` rend un avis de statut (`role="status"`) ou, pour une erreur, une alerte : sans nom, le
 * lecteur d'écran dit « statut » sans dire de quoi, et l'arbre d'accessibilité n'a qu'un `status` muet. Ici, les vrais endroits où l'application en montre un, montés dans
 * l'application entière devant un faux serveur : le nom est celui du titre qu'on lit, à chacun. (`states.test.tsx` éprouve le composant seul, `MetricsPage.notices.test.tsx` les
 * avis de la page Métriques.) Les alertes, elles, restent sans nom : voir `states.test.tsx`.
 */

// Monter toute l'application prend plus d'une seconde quand la machine est chargée : voir `withAsyncTimeout`.
withAsyncTimeout(5_000);

afterEach(() => {
  vi.unstubAllGlobals();
});

const TASK = issue({ id: 'bdesk-a', title: 'Palette' });
const paused = (count: number) => Array.from({ length: count }, (_, index) => issue({ id: `bdesk-p${index + 1}`, title: `En pause ${index + 1}`, status: 'deferred' }));

/** Une page de l'application, ce qu'il faut au faux serveur pour qu'elle montre un avis, et le nom que cet avis doit porter. */
type Scenario = readonly [where: string, arrange: () => string, name: string];

/** Le faux serveur d'un Projet `bdesk` aux tickets donnés, et l'adresse à ouvrir. */
const withIssues = (issues: Issue[], path: string) => () => {
  stubApi({ projects: projectsResponse, issues: { bdesk: issues } });
  return path;
};

const STATUS_NOTICES: readonly Scenario[] = [
  ['une adresse qui ne mène nulle part', withIssues([], '/nulle/part'), 'Cette adresse ne correspond à aucune page'],
  ['un Projet inconnu', withIssues([], '/p/inconnu/kanban'), 'Aucun Projet n’a l’identifiant « inconnu »'],
  [
    'la Vue globale sans Projet',
    () => {
      stubApi({ projects: { projects: [], ignored: [] } });
      return '/';
    },
    'Aucun Projet trouvé',
  ],
  ['le kanban sans ticket', withIssues([], '/p/bdesk/kanban'), 'Aucun ticket dans ce Projet'],
  [
    'le kanban d’un Projet qui n’est plus là (404)',
    () => {
      stubApi({ projects: projectsResponse, issues: { bdesk: httpFailure(404, { statusCode: 404, error: 'Not Found', message: 'Projet inconnu : bdesk' }) } });
      return '/p/bdesk/kanban';
    },
    'Ce Projet n’est plus disponible',
  ],
  ['le kanban filtré sur une Epic qui n’existe pas', withIssues(bdeskIssues, '/p/bdesk/kanban?epic=fantome'), 'Aucune Epic « fantome » dans ce Projet'],
  ['le kanban dont tous les tickets sont en pause', withIssues(paused(3), '/p/bdesk/kanban'), 'Les 3 tickets du tableau sont tous en pause'],
  ['le kanban dont le seul ticket est en pause', withIssues(paused(1), '/p/bdesk/kanban'), 'Le seul ticket du tableau est en pause'],
  ['la liste des Epics d’un Projet qui n’en a pas', withIssues([TASK], '/p/bdesk/epics'), 'Aucune Epic dans ce Projet'],
  ['la page d’une Epic qui n’existe pas', withIssues([TASK], '/p/bdesk/epics?epic=bdesk-fantome'), 'Aucune Epic « bdesk-fantome » dans beads-desktop'],
  ['la page d’un ticket qui n’est pas une Epic', withIssues([TASK], '/p/bdesk/epics?epic=bdesk-a'), '« bdesk-a » est de type Tâche'],
  ['le panneau d’un ticket qui n’existe pas', withIssues(bdeskIssues, '/p/bdesk/t/inexistant'), 'Aucun ticket « inexistant » dans beads-desktop'],
];

describe('les avis de statut de l’application sont nommés par leur titre', () => {
  it.each(STATUS_NOTICES)('%s', async (_where, arrange, name) => {
    renderApp(arrange());

    const notice = await screen.findByRole('status', { name });

    expect(within(notice).getByText(name)).toBeTruthy(); // le nom est le titre qu'on lit, dans la région qu'il nomme
  });

  it('le nom d’un avis n’en cache pas un autre : deux avis d’une même page ont chacun le leur', async () => {
    // Le filtre d'une Epic inconnue et un tableau dont tout est en pause : deux avis de statut sur la même page.
    renderApp(withIssues(paused(3), '/p/bdesk/kanban?epic=fantome')());

    const unknown = await screen.findByRole('status', { name: 'Aucune Epic « fantome » dans ce Projet' });
    const allPaused = await screen.findByRole('status', { name: 'Les 3 tickets du tableau sont tous en pause' });

    expect(unknown).not.toBe(allPaused);
    expect(within(unknown).queryByText(/tous en pause/)).toBeNull();
    expect(within(allPaused).queryByText(/Aucune Epic/)).toBeNull();
  });

  it('l’avis qui garde son bouton le garde sous son nom : ouvrir le tiroir change son contenu, pas sa région', async () => {
    const { user } = renderApp(withIssues(paused(3), '/p/bdesk/kanban')());
    const name = 'Les 3 tickets du tableau sont tous en pause';
    const notice = await screen.findByRole('status', { name });

    await user.click(within(notice).getByRole('button', { name: 'Ouvrir « En pause »' }));

    expect(screen.getByRole('status', { name })).toBe(notice); // la même région : son contenu a changé, elle n'a pas été remontée
    expect(within(notice).queryByRole('button', { name: 'Ouvrir « En pause »' })).toBeNull();
  });
});

/**
 * Les erreurs, elles, sont des alertes sans nom (voir `states.test.tsx`) : le lecteur d'écran les lit à leur apparition, et le nom d'une alerte précède son contenu.
 */
describe('les alertes de l’application restent sans nom', () => {
  it('la liste des tickets en échec : une alerte, titre dans son contenu', async () => {
    stubApi({ projects: projectsResponse, issues: { bdesk: new Error('database is locked') } });
    renderApp('/p/bdesk/kanban');

    const alert = await screen.findByRole('alert', { name: '' });

    expect(within(alert).getByText('Impossible de charger les tickets')).toBeTruthy();
  });

  it('un Projet illisible : une alerte, titre dans son contenu', async () => {
    stubApi({ projects: projectsResponse, issues: {} });
    renderApp('/p/legacy/kanban');

    const alert = await screen.findByRole('alert', { name: '' });

    expect(within(alert).getByText('Ce Projet est illisible')).toBeTruthy();
  });

  it('la chronologie d’un ticket indisponible : une alerte dans le panneau, titre dans son contenu', async () => {
    stubApi({
      projects: projectsResponse,
      issues: { bdesk: bdeskIssues },
      chronologies: { 'bdesk/bdesk-38k.6': httpFailure(500, { statusCode: 500, error: 'Internal Server Error', message: 'database is locked' }) },
    });
    renderApp('/p/bdesk/t/bdesk-38k.6');
    const dialog = await screen.findByRole('dialog');

    const alert = await within(dialog).findByRole('alert', { name: '' });

    expect(within(alert).getByText('Chronologie indisponible')).toBeTruthy();
  });

  it('l’erreur qui interrompt l’affichage d’une page : une alerte, titre dans son contenu', () => {
    const broken = vi.spyOn(console, 'error').mockImplementation(() => undefined); // React et React Router disent l'erreur à la console
    try {
      const Boom = (): never => {
        throw new Error('boom');
      };
      render(<RouterProvider router={createMemoryRouter([{ path: '/', element: <Boom />, errorElement: <RouteError /> }])} />);

      const alert = screen.getByRole('alert', { name: '' });

      expect(within(alert).getByText('Une erreur a interrompu l’affichage de cette page')).toBeTruthy();
      expect(within(alert).getByText('boom')).toBeTruthy();
    } finally {
      broken.mockRestore();
    }
  });
});
