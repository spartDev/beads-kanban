import { act, screen, waitFor, within } from '@testing-library/react';
import { beforeEach, describe, expect, it } from 'vitest';
import type { ApiSignal } from '../data/types';
import { withAsyncTimeout } from '../test/asyncTimeout';
import { LANGUAGE_STORAGE_KEY } from '../i18n/language';
import { issue, projectsResponse } from '../test/fixtures';
import { setBrowserLanguages } from '../test/languages';
import { renderApp, stubApi } from '../test/render';
import { withTimeZone } from '../test/timeZone';

/**
 * Le shell, la palette, les raccourcis et les pages de la zone shell (bdesk-ewr.2) en anglais : un navigateur anglais, sélecteur activé
 * (`languageSwitch`), comme l'application une fois bdesk-ewr.7 livrée. Le reste de la suite est en français.
 */

withAsyncTimeout(5_000);
withTimeZone('Europe/Paris');

const DAY = 86_400_000;
const NBSP = ' ';
const text = (element: Element) => element.textContent?.replaceAll(NBSP, ' ') ?? '';

const SIGNALS: Record<string, ApiSignal[]> = {
  bdesk: [
    { kind: 'drift', project: 'bdesk', ticket: { id: 'bdesk-w', title: 'Ticket w', type: 'task', priority: 2 }, cycleTime: 12 * DAY, reference: 8.65 * DAY, scope: 'type' },
    { kind: 'stagnantReady', project: 'bdesk', ticket: { id: 'bdesk-r', title: '   ', type: 'task', priority: 2 }, since: '2026-10-03T18:00:00.000Z', age: 20 * DAY },
    { kind: 'sendBackLoop', project: 'bdesk', ticket: { id: 'bdesk-l', title: 'Ticket l', type: 'task', priority: 2 }, sendBacks: 3 },
  ],
  mpm: [{ kind: 'unusualWip', project: 'mpm', wip: 6, threshold: 4.5 }],
};

const stub = () => stubApi({ projects: projectsResponse, issues: { bdesk: [], mpm: [] }, signals: SIGNALS });
const renderEnglish = (path: string) => renderApp(path, { languageSwitch: true });

beforeEach(() => {
  setBrowserLanguages(['en-US', 'en']);
});

describe('the shell in English', () => {
  it('names the navigation, the projects and the controls in English', async () => {
    stub();
    renderEnglish('/overview');

    const navigation = await screen.findByRole('navigation', { name: 'Main navigation' });
    expect(document.documentElement.lang).toBe('en');
    expect(screen.getByRole('link', { name: 'Skip to content' })).toBeTruthy();
    expect(screen.getByRole('main', { name: 'Content' })).toBeTruthy();
    expect(within(navigation).getByRole('link', { name: /Overview/ })).toBeTruthy();
    expect(within(navigation).getByRole('link', { name: /^Watch list/ })).toBeTruthy();
    expect(within(navigation).getByRole('heading', { name: /Projects/ })).toBeTruthy();
    // La raison d'un Projet illisible vient du serveur : elle n'est pas traduite.
    await waitFor(() => expect(text(navigation)).toContain('Unreadable: Base Dolt verrouillée par un autre processus'));
    expect(screen.getByRole('navigation', { name: 'Tabs' })).toBeTruthy();
    expect(screen.getByRole('navigation', { name: 'Breadcrumb' })).toBeTruthy();
    expect(screen.getAllByRole('group', { name: 'Theme' })[0]).toBeTruthy();
    expect(screen.getAllByRole('button', { name: 'Dark theme' }).length).toBeGreaterThan(0);
    expect(screen.getAllByRole('button', { name: 'Show keyboard shortcuts' }).length).toBe(1);
    expect(screen.getByRole('group', { name: 'Language' })).toBeTruthy();
  });

  it('writes the Overview in English, and its tab title', async () => {
    stub();
    renderEnglish('/overview');

    expect(await screen.findByRole('heading', { level: 1, name: 'Overview' })).toBeTruthy();
    const projects = await screen.findByRole('region', { name: 'Tracked projects' });
    await waitFor(() => expect(text(projects)).toContain('Embedded Dolt'));
    expect(text(projects)).toContain('Dolt server');
    expect(screen.getByText('1 ignored folder')).toBeTruthy();
    await waitFor(() => expect(document.title).toBe('Overview · Throughline'));
  });

  it('names the tabs of a project in English, in the sidebar and the breadcrumb', async () => {
    stub();
    renderEnglish('/p/bdesk/signals');

    const navigation = await screen.findByRole('navigation', { name: 'Main navigation' });
    await waitFor(() => expect(within(navigation).getByRole('link', { name: /^Metrics/ })).toBeTruthy());
    for (const tab of ['Kanban', 'Watch list', 'Epics']) {
      expect(within(navigation).getAllByRole('link', { name: new RegExp(`^${tab}`) }).length).toBeGreaterThan(0);
    }
    const breadcrumb = screen.getByRole('navigation', { name: 'Breadcrumb' });
    expect(within(breadcrumb).getByRole('link', { name: 'Watch list' }).getAttribute('aria-current')).toBe('page');
  });
});

describe('the Watch list in English', () => {
  it('groups the signals under their English names and says them in English', async () => {
    stub();
    renderEnglish('/');

    const drift = await screen.findByRole('region', { name: 'Drift' });
    expect(screen.getByRole('heading', { level: 1, name: 'Watch list' })).toBeTruthy();
    // En tête, « Depuis votre dernière visite » : les genres sous leurs noms anglais (CONTEXT.md), dans l'ordre, les mauvaises nouvelles d'abord.
    const since = await screen.findByRole('region', { name: 'Since your last visit' });
    expect(text(since)).toContain('The last 24 hours, across all projects, bad news first: no visit has been recorded in this browser yet.');
    await waitFor(() =>
      expect([...since.querySelectorAll(':scope > ul > li .sr-only')].map((row) => row.textContent)).toEqual([
        'Reopens: 0 tickets',
        'Escaped bugs: 0 tickets',
        'Deliveries: 0 tickets',
        'New blockages: 0 tickets',
        'Arrivals: 0 tickets',
      ]),
    );
    expect(within(since).getByRole('button', { name: 'Mark all seen' })).toBeTruthy();
    expect(text(drift)).toContain('12 d of Cycle Time so far, above 8.7 d, the P85 of deliveries of the same type');
    const ready = screen.getByRole('region', { name: 'Stale ready' });
    expect(within(ready).getByRole('link', { name: 'Untitled' })).toBeTruthy();
    expect(text(ready)).toContain('Ready for 20 d');
    expect(text(screen.getByRole('region', { name: 'Unusual WIP' }))).toBe(
      'Unusual WIPMon-Pommier-Malin: 6 tickets in progress, above 4.5, the P85 of daily WIP over the last 90 days',
    );
    const loop = screen.getByRole('region', { name: 'Send-back loop' });
    expect(text(loop)).toContain('beads-desktop · 3 Send-backs to development, still not closed');
    expect(within(loop).getByRole('button', { name: 'About Send-back loop' })).toBeTruthy();
    await waitFor(() => expect(document.title).toBe('Watch list · Throughline'));
  });

  it('says when there is nothing to watch, and names the project in the description', async () => {
    stubApi({ projects: projectsResponse, issues: { bdesk: [], mpm: [] } });
    renderEnglish('/p/bdesk/signals');

    expect(await screen.findByRole('status', { name: 'Nothing to watch' })).toBeTruthy();
    expect(screen.getByText(/^What deserves a look right now in beads-desktop: /)).toBeTruthy();
  });
});

describe('the command palette in English', () => {
  it('opens with the same keys, and searches in English', async () => {
    stub();
    const { user } = renderEnglish('/overview');
    await screen.findByRole('navigation', { name: 'Main navigation' });

    await user.keyboard('{Control>}k{/Control}');
    const palette = await screen.findByRole('dialog', { name: 'Command palette' });
    const input = within(palette).getByPlaceholderText('Search for a ticket, an epic, a project or a command');

    await user.type(input, 'dark');
    expect(await within(palette).findByRole('option', { name: /Dark theme/ })).toBeTruthy();
    // Les trois thèmes partagent leurs mots-clés (« dark », « light »…).
    await waitFor(() => expect(within(palette).getByRole('status', { name: 'Result count' }).textContent).toBe('3 results'));

    await user.clear(input);
    await user.type(input, 'shortcut');
    expect(await within(palette).findByRole('option', { name: /Keyboard shortcuts/ })).toBeTruthy();
    await waitFor(() => expect(within(palette).getByRole('status', { name: 'Result count' }).textContent).toBe('1 result'));

    // Les mots français des libellés et des mots-clés de la zone ne trouvent plus rien : la palette cherche dans la langue affichée. (Les types de ticket,
    // « tâche »…, sont ceux de `design/`, que bdesk-ewr.3 traduit.)
    await user.clear(input);
    await user.type(input, 'sombre');
    expect(await within(palette).findByText('No results for “sombre”.')).toBeTruthy();
    expect(within(palette).queryByRole('option', { name: /Dark theme/ })).toBeNull();
  });

  it('finds an untitled ticket by the word it shows', async () => {
    stubApi({ projects: projectsResponse, issues: { bdesk: [issue({ id: 'bdesk-u', title: ' \u200b ' })], mpm: [] } });
    const { user } = renderEnglish('/p/bdesk/kanban');
    await screen.findByRole('navigation', { name: 'Main navigation' });

    await user.keyboard('{Control>}k{/Control}');
    const palette = await screen.findByRole('dialog', { name: 'Command palette' });
    await user.keyboard('untitled');
    expect(await within(palette).findByRole('option', { name: /bdesk-u.*Untitled/ })).toBeTruthy();
  });

  it('switches project from the palette, under English headings', async () => {
    stub();
    const { user, router } = renderEnglish('/p/bdesk/kanban');
    await screen.findByRole('navigation', { name: 'Main navigation' });

    await user.keyboard('gp');
    const palette = await screen.findByRole('dialog', { name: 'Command palette' });
    expect(within(palette).getByPlaceholderText('Switch project')).toBeTruthy();
    const group = await within(palette).findByRole('group', { name: 'Switch project' });
    expect(within(group).getByLabelText('Current project')).toBeTruthy();
    await user.click(within(group).getByRole('option', { name: /Mon-Pommier-Malin/ }));
    await waitFor(() => expect(router.state.location.pathname).toBe('/p/mpm/kanban'));
  });
});

describe('the keyboard shortcuts help in English', () => {
  it('lists the same keys under English labels and groups', async () => {
    stub();
    const { user } = renderEnglish('/overview');
    await screen.findByRole('navigation', { name: 'Main navigation' });

    await user.keyboard('?');
    const help = await screen.findByRole('dialog', { name: 'Keyboard shortcuts' });
    const list = within(help).getByRole('region', { name: 'Shortcut list' });
    const general = within(list).getByRole('region', { name: 'General' });
    expect(text(general)).toContain('Open the command palette');
    expect(text(general)).toContain('CtrlK');
    const navigation = within(list).getByRole('region', { name: 'Navigation' });
    expect(text(navigation)).toContain('Go to HomeGthenH');
    expect(text(navigation)).toContain('Go to the OverviewGthenV');
    expect(text(navigation)).toContain('Go to MetricsGthenM');
    expect(within(help).getByRole('button', { name: 'Close' })).toBeTruthy();
  });
});

describe('the error and missing pages in English', () => {
  it('a page that does not exist', async () => {
    stub();
    renderEnglish('/nowhere');

    expect(await screen.findByRole('heading', { level: 1, name: 'Page not found' })).toBeTruthy();
    expect(screen.getByRole('status', { name: 'This address does not match any page' })).toBeTruthy();
    expect(screen.getByRole('link', { name: 'Go to the Overview' })).toBeTruthy();
    await waitFor(() => expect(document.title).toBe('Page not found · Throughline'));
  });

  it('a project that does not exist', async () => {
    stub();
    renderEnglish('/p/nope/kanban');

    expect(await screen.findByRole('heading', { level: 1, name: 'Project not found' })).toBeTruthy();
    expect(await screen.findByRole('status', { name: 'No project has the identifier “nope”' })).toBeTruthy();
    expect(screen.getByRole('link', { name: 'See tracked projects' })).toBeTruthy();
  });

  it('projects that do not load', async () => {
    stubApi({ projects: new Error('database is locked') });
    renderEnglish('/overview');

    const main = await screen.findByRole('main');
    await waitFor(() => expect(text(main)).toContain('Could not load projects'));
    expect(text(main)).toContain('The server ran into an error');
    // Le message du serveur n'est pas traduit.
    expect(text(main)).toContain('database is locked');
    expect(within(main).getAllByRole('button', { name: 'Retry' }).length).toBeGreaterThan(0);
    expect(text(screen.getByRole('navigation', { name: 'Main navigation' }))).toContain('Projects unavailable: the server is not responding.');
  });
});

describe('switching language without reloading', () => {
  it('rewrites the help, and keeps the application groups first', async () => {
    setBrowserLanguages(['fr-FR', 'fr']);
    // Le panneau d'un ticket enregistre ses propres raccourcis (rubrique « Ticket ») : la page en a une rubrique de plus.
    stubApi({ projects: projectsResponse, issues: { bdesk: [issue({ id: 'bdesk-1', title: 'Un ticket' })], mpm: [] } });
    const { user } = renderEnglish('/p/bdesk/t/bdesk-1');
    await screen.findByRole('navigation', { name: 'Navigation principale' });
    await screen.findByRole('heading', { name: /Un ticket/ });

    // Les raccourcis de l'application se ré-enregistrent sous leurs libellés anglais : ils restent en tête de l'aide, devant ceux de la page.
    await user.click(screen.getByRole('button', { name: 'English' }));
    await screen.findByRole('navigation', { name: 'Main navigation' });
    await user.keyboard('?');
    const help = await screen.findByRole('dialog', { name: 'Keyboard shortcuts' });
    const groups = within(within(help).getByRole('region', { name: 'Shortcut list' })).getAllByRole('heading', { level: 3 });
    expect(groups.slice(0, 2).map((heading) => heading.textContent)).toEqual(['General', 'Navigation']);
    expect(groups.length).toBeGreaterThan(2);
  });

  it('searches in the new language while the palette stays open', async () => {
    setBrowserLanguages(['fr-FR', 'fr']);
    window.localStorage.setItem(LANGUAGE_STORAGE_KEY, 'fr');
    stubApi({ projects: projectsResponse, issues: { bdesk: [issue({ id: 'bdesk-u', title: ' \u200b ' })], mpm: [] } });
    const { user } = renderEnglish('/p/bdesk/kanban');
    await screen.findByRole('navigation', { name: 'Navigation principale' });

    await user.keyboard('{Control>}k{/Control}');
    const input = within(await screen.findByRole('dialog', { name: 'Palette de commandes' })).getByRole('combobox');
    await user.type(input, 'sans titre');
    expect(await screen.findByRole('option', { name: /bdesk-u.*Sans titre/ })).toBeTruthy();

    // Un autre onglet passe à l'anglais : la palette, restée ouverte, cherche aussitôt dans la nouvelle langue.
    act(() => {
      window.localStorage.setItem(LANGUAGE_STORAGE_KEY, 'en');
      window.dispatchEvent(new StorageEvent('storage', { key: LANGUAGE_STORAGE_KEY, newValue: 'en' }));
    });
    await screen.findByRole('dialog', { name: 'Command palette' });
    await user.clear(input);
    await user.type(input, 'untitled');
    expect(await screen.findByRole('option', { name: /bdesk-u.*Untitled/ })).toBeTruthy();
  });
});
