import { screen, within } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { Issue } from '../data/types';
import { withAsyncTimeout } from '../test/asyncTimeout';
import { issue, projectsResponse } from '../test/fixtures';
import { setBrowserLanguages } from '../test/languages';
import { renderApp, stubApi } from '../test/render';
import { withTimeZone } from '../test/timeZone';

// Monter toute l'application prend plus d'une seconde quand la machine est chargée : voir `withAsyncTimeout`.
withAsyncTimeout(5_000);

/**
 * Le kanban en anglais : un navigateur anglais et le sélecteur de langue activé (`languageSwitch`), comme les tests du socle. Le reste de la suite
 * est en français ; ici, on vérifie que les écrans clés de la zone (colonnes, filtre Epic, tiroir, états vides) parlent anglais, avec les termes
 * de CONTEXT.md, et que le contenu des tickets n'est jamais traduit.
 */
withTimeZone('Europe/Paris');

beforeEach(() => {
  setBrowserLanguages(['en-US']);
  vi.useFakeTimers({ toFake: ['Date'], now: new Date('2026-10-26T12:00:00+01:00') });
});
afterEach(() => {
  vi.useRealTimers();
});

const DAY = 86_400_000;
const ago = (days: number) => new Date(Date.now() - days * DAY).toISOString();

const TICKETS = (): Issue[] => [
  issue({ id: 'bdesk-e1', title: 'Refonte du shell', type: 'epic', priority: 1 }),
  issue({ id: 'bdesk-a1', title: 'Palette ⌘K', priority: 1, parentId: 'bdesk-e1' }),
  issue({ id: 'bdesk-b1', title: 'Raccourcis clavier', blockedBy: ['bdesk-a1'] }),
  issue({ id: 'bdesk-c1', title: 'Barre latérale', status: 'in_progress', assignee: 'spartDev' }),
  issue({ id: 'bdesk-c2', title: 'Revue automatique', status: 'hooked' }),
  issue({ id: 'bdesk-d2', title: 'Attente d’un retour', status: 'blocked' }),
  issue({ id: 'bdesk-f1', title: 'Fermé hier', status: 'closed', closedAt: ago(1), updatedAt: ago(1) }),
  issue({ id: 'bdesk-f2', title: 'Fermé il y a vingt jours', status: 'closed', closedAt: ago(20), updatedAt: ago(20) }),
  issue({ id: 'bdesk-g1', title: 'Reporté à plus tard', status: 'deferred' }),
];

const openBoard = async (issues: Issue[] = TICKETS(), path = '/p/bdesk/kanban') => {
  stubApi({ projects: projectsResponse, issues: { bdesk: issues } });
  const app = renderApp(path, { languageSwitch: true });
  await screen.findByRole('region', { name: 'Ready' });
  return app;
};

describe('the kanban, in English', () => {
  it('names its five columns with the glossary’s English terms, each with its rule', async () => {
    await openBoard();

    for (const name of ['Backlog', 'Ready', 'In progress', 'Blocked', 'Done']) {
      expect(screen.getByRole('heading', { level: 2, name })).toBeTruthy();
    }
    const rules: [column: string, hint: string, rule: string][] = [
      ['Backlog', 'Open, Blocked', 'Open ticket that is Blocked: it depends on at least one ticket that isn’t closed.'],
      ['Ready', 'Open, not Blocked', 'Open ticket with no pending dependency (beads’ “ready”).'],
      ['In progress', 'In progress, not Blocked', 'Ticket in progress or hooked to an agent, with no pending dependency.'],
      [
        'Blocked',
        'Blockage or blocked status',
        'Ticket with the blocked status, or in progress (or hooked to an agent) but Blocked: it depends on a ticket that isn’t closed.',
      ],
    ];
    for (const [column, hint, rule] of rules) {
      expect(within(screen.getByRole('region', { name: column })).getByText(hint).getAttribute('title'), column).toBe(rule);
    }
    expect(screen.getByRole('heading', { level: 1, name: 'Kanban' })).toBeTruthy();
    expect(screen.getByText(/^The tickets of .+, in columns, read-only\.$/)).toBeTruthy();
    const done = screen.getByRole('region', { name: 'Done' });
    expect(within(done).getByText('Closed in the last 14 days').getAttribute('title')).toBe(
      'Ticket closed in the last 14 days, today included, that is since midnight on Tue, Oct 13 (calendar days, your browser’s time).',
    );
    expect(within(done).getByText('1 other closed earlier')).toBeTruthy();
    expect(within(done).getByRole('combobox', { name: 'Done window' })).toBeTruthy();
    expect(within(done).getByRole('option', { name: '7 days' })).toBeTruthy();
    expect(document.documentElement.lang).toBe('en');
  });

  it('counts the tickets in English and points to the Epic filter', async () => {
    await openBoard();

    expect(screen.getByText(/^7 tickets/)).toBeTruthy();
    // Le sélecteur de colonne du mobile : chaque bouton dit son nombre de cartes ; zéro est pluriel en anglais.
    const selector = screen.getByRole('group', { name: 'Column shown' });
    expect(within(selector).getByRole('button', { name: /^Backlog\s*1\s*ticket$/ })).toBeTruthy();
    expect(within(selector).getByRole('button', { name: /^In progress\s*2\s*tickets$/ })).toBeTruthy();
    expect(screen.getByText('· 1 Epic in the filter')).toBeTruthy();
    const filter = screen.getByRole('combobox', { name: 'Epic' });
    expect(within(filter).getByRole('option', { name: 'All Epics' })).toBeTruthy();
    // Le contenu des tickets n'est jamais traduit : le titre de l'Epic reste le sien.
    expect(within(filter).getByRole('option', { name: 'Refonte du shell' })).toBeTruthy();
  });

  it('writes the cards’ badges and screen-reader text in English, the ticket’s own words untouched', async () => {
    await openBoard();

    const blocked = screen.getByRole('region', { name: 'Blocked' });
    expect(within(blocked).getByText('Blocked status')).toBeTruthy();
    const backlog = screen.getByRole('region', { name: 'Backlog' });
    expect(within(backlog).getByTitle('Waiting on bdesk-a1')).toBeTruthy();
    const inProgress = screen.getByRole('region', { name: 'In progress' });
    expect(within(inProgress).getByTitle('Hooked to an agent')).toBeTruthy();
    expect(within(inProgress).getByRole('link', { name: 'Barre latérale' })).toBeTruthy();
    // Le type de la carte et son âge, pour les lecteurs d'écran.
    const card = within(inProgress).getByRole('link', { name: 'Barre latérale' }).closest('li') as HTMLElement;
    expect(within(card).getByText('Task', { exact: false, selector: '.sr-only' })).toBeTruthy();
    expect(within(card).getByText('Updated', { exact: false, selector: '.sr-only' })).toBeTruthy();
    const closed = within(screen.getByRole('region', { name: 'Done' })).getByRole('link', { name: 'Fermé hier' }).closest('li') as HTMLElement;
    expect(within(closed).getByText('Closed', { exact: false, selector: '.sr-only' })).toBeTruthy();
    const ready = screen.getByRole('region', { name: 'Ready' });
    expect(within(ready).getByRole('link', { name: /^Epic: Refonte du shell/ })).toBeTruthy();
  });

  it('opens the “Paused” drawer, in English', async () => {
    const { user } = await openBoard();

    const toggle = screen.getByRole('button', { name: /^Paused/ });
    expect(toggle.textContent).toBe('Paused1 ticketDeferred, pinned or of an unknown status');
    await user.click(toggle);
    const drawer = screen.getByRole('region', { name: 'Paused' });
    // Le statut d'un ticket en pause, en minuscules, comme dans une phrase.
    expect(within(drawer).getByText('deferred')).toBeTruthy();
  });

  it('says so, in English, when every ticket is paused', async () => {
    await openBoard([issue({ id: 'bdesk-g1', title: 'Reporté', status: 'deferred' }), issue({ id: 'bdesk-g2', title: 'Épinglé', status: 'pinned' })]);

    expect(screen.getByText('All 2 tickets on the board are paused')).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Open “Paused”' })).toBeTruthy();
    expect(within(screen.getByRole('region', { name: 'Ready' })).getByText('No tickets')).toBeTruthy();
    // Zéro est pluriel en anglais, dans le titre de la colonne comme dans son bouton du sélecteur.
    expect(within(screen.getByRole('region', { name: 'Blocked' })).getByText('tickets', { exact: false, selector: '.sr-only' }).textContent).toBe(' tickets');
    const selector = screen.getByRole('group', { name: 'Column shown' });
    expect(within(selector).getByRole('button', { name: /^Blocked\s*0\s*tickets$/ })).toBeTruthy();
    expect(screen.getByRole('button', { name: /^Paused/ }).textContent).toContain('2 tickets');
  });

  it('says so, in the singular, when the only ticket is paused', async () => {
    await openBoard([issue({ id: 'bdesk-g1', title: 'Reporté', status: 'deferred' })]);

    expect(screen.getByText('The only ticket on the board is paused')).toBeTruthy();
    expect(
      screen.getByText('Deferred, pinned or of an unknown status, it isn’t in any column: it waits in the “Paused” drawer.'),
    ).toBeTruthy();
  });

  it('groups large numbers the English way, and names the closed tickets left aside', async () => {
    const old = Array.from({ length: 1234 }, (_, index) =>
      issue({ id: `bdesk-old${index}`, title: `Ancien ${index}`, status: 'closed', closedAt: ago(40), updatedAt: ago(40) }),
    );
    await openBoard([...TICKETS(), ...old, issue({ id: 'bdesk-u1', title: 'Sans date', status: 'closed', closedAt: null })]);

    const done = screen.getByRole('region', { name: 'Done' });
    expect(within(done).getByText('1,235 others closed earlier')).toBeTruthy();
    expect(within(done).getByText('1 closed ticket with no close date')).toBeTruthy();
  });

  it('says an unknown Epic filter is unknown, in English', async () => {
    await openBoard(TICKETS(), '/p/bdesk/kanban?epic=bdesk-zz');

    expect(screen.getByText('No Epic “bdesk-zz” in this Project')).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Clear the filter' })).toBeTruthy();
  });

  it('lists its shortcuts in English, with the same keys', async () => {
    const { user } = await openBoard();

    await user.keyboard('?');
    const help = within(await screen.findByRole('dialog'));
    const keysOf = (label: string) => help.getByText(label).closest('li')?.querySelectorAll('kbd');
    const KEYS: [label: string, key: string][] = [
      ['Next ticket', 'J'],
      ['Previous ticket', 'K'],
      ['Previous column', 'H'],
      ['Next column', 'L'],
      ['Open the selected ticket', '↵'],
      // Échap : une touche du shell (`keyCaps`), qui la nommera dans la langue affichée quand le shell sera migré.
      ['Deselect the ticket', ''],
    ];
    const kanban = help.getByRole('region', { name: 'Kanban' });
    expect(within(kanban).getAllByRole('listitem')).toHaveLength(KEYS.length);
    for (const [label, key] of KEYS) {
      const caps = [...(keysOf(label) ?? [])].map((kbd) => kbd.textContent);
      expect(caps.length, label).toBeGreaterThan(0);
      if (key) expect(caps, label).toContain(key);
    }
  });

  it('has an English empty state for a Project without tickets', async () => {
    stubApi({ projects: projectsResponse, issues: { bdesk: [] } });
    renderApp('/p/bdesk/kanban', { languageSwitch: true });

    expect(await screen.findByText('No tickets in this Project')).toBeTruthy();
    expect(screen.getByText(/it will show up here within a few seconds/)).toBeTruthy();
  });
});
