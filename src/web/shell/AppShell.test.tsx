import { screen, waitFor, within } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { THEME_STORAGE_KEY } from '../theme/theme';
import { bdeskIssues, mpmIssues, projectsResponse } from '../test/fixtures';
import { renderApp, stubApi } from '../test/render';

const stubDefaultApi = () =>
  stubApi({ projects: projectsResponse, issues: { bdesk: bdeskIssues, mpm: mpmIssues } });

const sidebar = () => screen.findByRole('navigation', { name: 'Navigation principale' });
const pathname = (router: { state: { location: { pathname: string; search: string } } }) =>
  router.state.location.pathname + router.state.location.search;

/** Ouvre la palette comme le ferait un utilisateur (jsdom n'est pas un Mac : Ctrl+K). */
async function openPalette(user: ReturnType<typeof renderApp>['user']) {
  await user.keyboard('{Control>}k{/Control}');
  return screen.findByRole('dialog', { name: 'Palette de commandes' });
}

describe('navigation', () => {
  it('liste les Projets et déplie les onglets du Projet courant', async () => {
    stubDefaultApi();
    renderApp('/p/bdesk/kanban');

    const nav = await sidebar();
    expect(await within(nav).findByRole('link', { name: /beads-desktop/ })).toBeTruthy();
    expect(within(nav).getByRole('link', { name: /My-Prompt-Manager/ })).toBeTruthy();

    const kanban = within(nav).getByRole('link', { name: /Kanban/ });
    expect(kanban.getAttribute('aria-current')).toBe('page');
    expect(within(nav).getByRole('link', { name: /Epics/ }).getAttribute('aria-current')).toBeNull();
    expect(within(nav).getByRole('link', { name: /Métriques/ })).toBeTruthy();
  });

  it('affiche un Projet illisible grisé, avec sa raison, sans lien', async () => {
    stubDefaultApi();
    renderApp('/');

    const nav = await sidebar();
    await within(nav).findByRole('link', { name: /beads-desktop/ });
    expect(within(nav).queryByRole('link', { name: /legacy-api/ })).toBeNull();
    expect(within(nav).getByText(/Base Dolt verrouillée par un autre processus/)).toBeTruthy();
  });

  it('redirige /p/:projet vers le kanban', async () => {
    stubDefaultApi();
    const { router } = renderApp('/p/mpm');

    await waitFor(() => expect(pathname(router)).toBe('/p/mpm/kanban'));
  });

  it('explique qu’un Projet est introuvable ou illisible au lieu d’afficher une page vide', async () => {
    stubDefaultApi();
    const unknown = renderApp('/p/fantome/kanban');
    expect(await screen.findByRole('heading', { name: 'Projet introuvable' })).toBeTruthy();
    unknown.unmount();

    renderApp('/p/legacy/metrics');
    expect(await screen.findByText('Ce Projet est illisible')).toBeTruthy();
    expect(screen.getAllByText(/Base Dolt verrouillée/).length).toBeGreaterThan(0);
  });

  it('renvoie une page introuvable pour une adresse inconnue', async () => {
    stubDefaultApi();
    renderApp('/n/importe/quoi');

    expect(await screen.findByRole('heading', { name: 'Page introuvable' })).toBeTruthy();
  });

  it('met à jour le titre de l’onglet du navigateur', async () => {
    stubDefaultApi();
    renderApp('/p/bdesk/epics');

    await waitFor(() => expect(document.title).toBe('Epics · beads-desktop · beads-desktop'));
  });

  it('nomme le bouton de changement de Projet du mobile par le Projet affiché : le texte visible est dans son nom accessible', async () => {
    stubDefaultApi();
    renderApp('/p/bdesk/kanban');

    // WCAG 2.5.3 : un aria-label qui ne commence pas par le texte visible fait échouer axe (label-content-name-mismatch).
    const button = await screen.findByRole('button', { name: 'beads-desktop, changer de Projet' });
    expect(button.getAttribute('aria-label')).toBeNull();
    expect(button.textContent).toContain('beads-desktop');
  });

  it('pointe les onglets du mobile sur le dernier Projet visité quand on est en Vue globale', async () => {
    stubDefaultApi();
    window.localStorage.setItem('beads-desktop:last-project', 'mpm');
    renderApp('/');

    const tabs = await screen.findByRole('navigation', { name: 'Onglets' });
    await waitFor(() => expect(within(tabs).getByRole('link', { name: 'Kanban' }).getAttribute('href')).toBe('/p/mpm/kanban'));
    expect(within(tabs).getByRole('link', { name: 'Vue globale' }).getAttribute('aria-current')).toBe('page');
    expect(within(tabs).getAllByRole('link')).toHaveLength(4);
  });
});

describe('états de chargement', () => {
  it('signale un serveur en panne et propose de réessayer', async () => {
    stubApi({ projects: new Error('spawn dolt ENOENT') });
    const { user } = renderApp('/');

    expect((await screen.findAllByRole('alert')).length).toBeGreaterThan(0);
    expect(screen.getAllByText('Réessayer').length).toBeGreaterThan(0);

    stubDefaultApi();
    await user.click(screen.getAllByRole('button', { name: /Réessayer/ })[0]!);

    expect((await sidebar().then((nav) => within(nav).findByRole('link', { name: /beads-desktop/ }))).textContent).toContain('bdesk');
  });

  it('annonce le chargement comme un statut nommé : un aria-label sur un div sans rôle serait ignoré', async () => {
    stubDefaultApi().mockImplementation(() => new Promise<Response>(() => undefined));
    renderApp('/');

    // La barre latérale et la Vue globale attendent la même liste de Projets.
    expect(await screen.findAllByRole('status', { name: 'Chargement des Projets' })).toHaveLength(2);
  });

  it('invite à configurer les racines quand aucun Projet n’est trouvé', async () => {
    stubApi({ projects: { projects: [], ignored: [] } });
    renderApp('/');

    expect(await screen.findByText('Aucun Projet trouvé')).toBeTruthy();
    expect(screen.getByText('~/.config/beads-desktop/config.json')).toBeTruthy();
  });

  it('liste les dossiers ignorés avec leur raison', async () => {
    stubDefaultApi();
    const { user } = renderApp('/');

    await user.click(await screen.findByText('1 dossier ignoré'));

    expect(screen.getByText('/dev/notes')).toBeTruthy();
    expect(screen.getByText('Workspace non-Dolt')).toBeTruthy();
  });

  it('gère un Projet sans ticket et une erreur de chargement des tickets', async () => {
    stubApi({ projects: projectsResponse, issues: { bdesk: [], mpm: new Error('database is locked') } });
    const empty = renderApp('/p/bdesk/kanban');
    expect(await screen.findByText('Aucun ticket dans ce Projet')).toBeTruthy();
    empty.unmount();

    renderApp('/p/mpm/kanban');
    expect(await screen.findByText('Impossible de charger les tickets')).toBeTruthy();
    expect(screen.getByText('database is locked')).toBeTruthy();
  });
});

describe('palette ⌘K', () => {
  it('s’ouvre avec Ctrl+K, se ferme avec Échap et rend le focus', async () => {
    stubDefaultApi();
    const { user } = renderApp('/p/bdesk/kanban');
    await sidebar();

    const dialog = await openPalette(user);
    expect(within(dialog).getByRole('combobox')).toBe(document.activeElement);

    await user.keyboard('{Escape}');
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
  });

  it('s’ouvre aussi depuis le champ de recherche de la barre latérale', async () => {
    stubDefaultApi();
    const { user } = renderApp('/p/bdesk/kanban');

    // Le champ de recherche est dans la barre latérale, hors de sa liste de navigation.
    const aside = (await sidebar()).closest('aside')!;
    await user.click(within(aside).getByRole('button', { name: /Rechercher/ }));

    expect(await screen.findByRole('dialog', { name: 'Palette de commandes' })).toBeTruthy();
  });

  it('cherche un ticket par son id et l’ouvre avec Entrée', async () => {
    stubDefaultApi();
    const { user, router } = renderApp('/p/bdesk/kanban');
    await sidebar();

    const dialog = await openPalette(user);
    await user.keyboard('38k.6');

    const option = await within(dialog).findByRole('option', { name: /Shell UI façon Linear/ });
    expect(option.textContent).toContain('bdesk-38k.6');
    await user.keyboard('{Enter}');

    await waitFor(() => expect(pathname(router)).toBe('/p/bdesk/t/bdesk-38k.6'));
    expect(screen.queryByRole('dialog', { name: 'Palette de commandes' })).toBeNull();
    expect(await screen.findByRole('heading', { level: 2, name: /Shell UI façon Linear/ })).toBeTruthy();
  });

  it('cherche un ticket par son titre, sans tenir compte des accents', async () => {
    stubDefaultApi();
    const { user } = renderApp('/p/bdesk/kanban');
    await sidebar();

    const dialog = await openPalette(user);
    await user.keyboard('graphique debit');

    expect(await within(dialog).findByRole('option', { name: /Le graphique du Débit/ })).toBeTruthy();
    expect(within(dialog).queryByRole('option', { name: /Kanban par Projet/ })).toBeNull();
  });

  it('ouvre une Epic sur la page Epics', async () => {
    stubDefaultApi();
    const { user, router } = renderApp('/p/bdesk/kanban');
    await sidebar();

    const dialog = await openPalette(user);
    await user.keyboard('V1');
    await user.click(await within(dialog).findByRole('option', { name: /beads-desktop V1/ }));

    await waitFor(() => expect(pathname(router)).toBe('/p/bdesk/epics?epic=bdesk-38k'));
    // La page de l'Epic (bdesk-38k.10) : son titre est celui de l'Epic.
    expect(await screen.findByRole('heading', { level: 1, name: /beads-desktop V1/ })).toBeTruthy();
  });

  it('change de Projet en gardant la section courante', async () => {
    stubDefaultApi();
    const { user, router } = renderApp('/p/bdesk/metrics');
    await sidebar();

    const dialog = await openPalette(user);
    await user.keyboard('prompt');
    await user.click(await within(dialog).findByRole('option', { name: /My-Prompt-Manager/ }));

    await waitFor(() => expect(pathname(router)).toBe('/p/mpm/metrics'));
  });

  it('montre les Projets illisibles, désactivés, avec leur raison', async () => {
    stubDefaultApi();
    const { user, router } = renderApp('/');
    await sidebar();

    const dialog = await openPalette(user);
    const option = await within(dialog).findByRole('option', { name: /legacy-api/ });
    expect(option.getAttribute('aria-disabled')).toBe('true');
    expect(option.textContent).toContain('Base Dolt verrouillée');

    await user.click(option);
    expect(pathname(router)).toBe('/');
  });

  it('cherche dans tous les Projets depuis la Vue globale', async () => {
    stubDefaultApi();
    const { user } = renderApp('/');
    await sidebar();

    const dialog = await openPalette(user);
    await user.keyboard('mpm-12');

    expect(await within(dialog).findByRole('option', { name: /Recherche plein texte/ })).toBeTruthy();
  });

  it('propose d’élargir la recherche à tous les Projets depuis un Projet', async () => {
    stubDefaultApi();
    const { user, router } = renderApp('/p/bdesk/kanban');
    await sidebar();

    const dialog = await openPalette(user);
    await user.keyboard('mpm-12');
    expect(within(dialog).queryByRole('option', { name: /Recherche plein texte/ })).toBeNull();

    await user.click(await within(dialog).findByRole('option', { name: /dans tous les Projets/ }));
    const found = await within(dialog).findByRole('option', { name: /Recherche plein texte/ });
    await user.click(found);

    await waitFor(() => expect(pathname(router)).toBe('/p/mpm/t/mpm-12'));
  });

  it('dit quand rien ne correspond', async () => {
    stubApi({ projects: { projects: [projects0()], ignored: [] }, issues: { bdesk: bdeskIssues } });
    const { user } = renderApp('/p/bdesk/kanban');
    await sidebar();

    const dialog = await openPalette(user);
    await user.keyboard('zzzzzz');

    expect(await within(dialog).findByText('Aucun résultat pour « zzzzzz ».')).toBeTruthy();
  });

  it('lance une commande : le thème sombre', async () => {
    stubDefaultApi();
    const { user } = renderApp('/p/bdesk/kanban');
    await sidebar();

    const dialog = await openPalette(user);
    await user.keyboard('sombre');
    await user.click(await within(dialog).findByRole('option', { name: /Thème sombre/ }));

    expect(document.documentElement.dataset.theme).toBe('dark');
    expect(window.localStorage.getItem(THEME_STORAGE_KEY)).toBe('dark');
  });

  it('ne s’ouvre pas en mode « changer de Projet » avec autre chose que les Projets', async () => {
    stubDefaultApi();
    const { user, router } = renderApp('/p/bdesk/kanban');
    await sidebar();

    await user.keyboard('gp');
    const dialog = await screen.findByRole('dialog', { name: 'Palette de commandes' });

    expect(within(dialog).getAllByRole('option').map((o) => o.textContent)).toEqual([
      expect.stringContaining('beads-desktop'),
      expect.stringContaining('My-Prompt-Manager'),
      expect.stringContaining('legacy-api'),
    ]);
    await user.click(within(dialog).getByRole('option', { name: /My-Prompt-Manager/ }));
    await waitFor(() => expect(pathname(router)).toBe('/p/mpm/kanban'));
  });
});

describe('raccourcis clavier', () => {
  it('« g » puis « m » ouvre les métriques du Projet courant', async () => {
    stubDefaultApi();
    const { user, router } = renderApp('/p/bdesk/kanban');
    await sidebar();

    await user.keyboard('gm');
    await waitFor(() => expect(pathname(router)).toBe('/p/bdesk/metrics'));
    await user.keyboard('ge');
    await waitFor(() => expect(pathname(router)).toBe('/p/bdesk/epics'));
    await user.keyboard('gv');
    await waitFor(() => expect(pathname(router)).toBe('/'));
  });

  it('ignore « g » puis « m » tapés dans le champ de la palette', async () => {
    stubDefaultApi();
    const { user, router } = renderApp('/p/bdesk/kanban');
    await sidebar();

    const dialog = await openPalette(user);
    await user.keyboard('gm');

    expect((within(dialog).getByRole('combobox') as HTMLInputElement).value).toBe('gm');
    expect(pathname(router)).toBe('/p/bdesk/kanban');
  });

  it('« ? » affiche les raccourcis enregistrés, dont ceux de la navigation', async () => {
    stubDefaultApi();
    const { user } = renderApp('/p/bdesk/kanban');
    await sidebar();

    await user.keyboard('?');
    const help = await screen.findByRole('dialog', { name: 'Raccourcis clavier' });

    expect(within(help).getByText('Aller à Kanban')).toBeTruthy();
    expect(within(help).getByText('Ouvrir la palette de commandes')).toBeTruthy();
    expect(within(help).getAllByText('puis').length).toBeGreaterThan(0);

    await user.keyboard('{Escape}');
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
  });

  it('désactive les raccourcis d’onglet tant qu’aucun Projet n’est lisible', async () => {
    stubApi({ projects: { projects: [], ignored: [] } });
    const { user, router } = renderApp('/');
    await screen.findByText('Aucun Projet trouvé');

    await user.keyboard('gk');

    expect(pathname(router)).toBe('/');
  });
});

describe('thème', () => {
  it('bascule depuis la barre latérale et mémorise le choix', async () => {
    stubDefaultApi();
    const { user } = renderApp('/p/bdesk/kanban');
    const nav = await sidebar();
    expect(document.documentElement.dataset.theme).toBe('light');

    const group = within(nav.parentElement!).getAllByRole('group', { name: 'Thème' })[0]!;
    await user.click(within(group).getByRole('button', { name: 'Thème sombre' }));

    expect(document.documentElement.dataset.theme).toBe('dark');
    expect(window.localStorage.getItem(THEME_STORAGE_KEY)).toBe('dark');
    expect(within(group).getByRole('button', { name: 'Thème sombre' }).getAttribute('aria-pressed')).toBe('true');
    expect(within(group).getByRole('button', { name: 'Thème du système' }).getAttribute('aria-pressed')).toBe('false');
  });
});

describe('thème : une seule liste', () => {
  it('la bascule et la palette proposent les mêmes thèmes, dans le même ordre', async () => {
    stubDefaultApi();
    const { user } = renderApp('/p/bdesk/kanban');
    const nav = await sidebar();
    const group = within(nav.parentElement!).getAllByRole('group', { name: 'Thème' })[0]!;
    const toggleLabels = within(group)
      .getAllByRole('button')
      .map((button) => button.getAttribute('aria-label'));

    const dialog = await openPalette(user);
    await user.keyboard('thème');
    const options = await within(dialog).findAllByRole('option', { name: /^Thème/ });

    expect(toggleLabels).toEqual(['Thème du système', 'Thème clair', 'Thème sombre']);
    expect(options.map((option) => option.textContent)).toEqual(toggleLabels);
  });
});

function projects0() {
  const first = projectsResponse.projects[0];
  if (!first) throw new Error('fixture vide');
  return first;
}
