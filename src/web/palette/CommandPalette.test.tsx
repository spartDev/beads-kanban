import { screen, within } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { bdeskIssues, mpmIssues, projectsResponse } from '../test/fixtures';
import { renderApp, stubApi } from '../test/render';

/** Rôles que WAI-ARIA admet dans une listbox : des options, éventuellement rangées en groupes. */
const LISTBOX_ROLES = new Set(['option', 'group', 'presentation', 'none']);

async function openPalette(path: string) {
  const app = renderApp(path);
  await screen.findByRole('navigation', { name: 'Navigation principale' });
  await app.user.keyboard('{Control>}k{/Control}');
  const dialog = await screen.findByRole('dialog', { name: 'Palette de commandes' });
  return { ...app, dialog, listbox: within(dialog).getByRole('listbox') };
}

/** Ce que la listbox contient d'étranger à son rôle : un message d'état ou d'alerte n'a rien à y faire. */
const foreignRoles = (listbox: HTMLElement) =>
  [...listbox.querySelectorAll('[role]')].map((el) => el.getAttribute('role') ?? '').filter((role) => !LISTBOX_ROLES.has(role));

describe('ARIA de la palette : la listbox ne contient que des options', () => {
  it('pendant le chargement des tickets, le message d’attente est hors de la liste', async () => {
    const fetchMock = stubApi({ projects: projectsResponse, issues: { bdesk: bdeskIssues, mpm: mpmIssues } });
    const healthy = fetchMock.getMockImplementation()!;
    // Les tickets n'arrivent jamais : la palette reste en attente.
    fetchMock.mockImplementation((input) =>
      String(input).endsWith('/issues') ? new Promise<Response>(() => undefined) : healthy(input),
    );

    const { dialog, listbox } = await openPalette('/');

    const loading = await within(dialog).findByText('Chargement des tickets…');
    expect(loading.getAttribute('role')).toBe('status');
    expect(listbox.contains(loading)).toBe(false);
    expect(foreignRoles(listbox)).toEqual([]);
  });

  it('quand des tickets sont indisponibles, l’alerte est hors de la liste et « Réessayer » reste une option', async () => {
    stubApi({ projects: projectsResponse, issues: { bdesk: new Error('database is locked'), mpm: mpmIssues } });

    const { dialog, listbox } = await openPalette('/');

    const alert = await within(dialog).findByRole('alert');
    expect(alert.textContent).toContain('Tickets indisponibles : beads-desktop');
    expect(listbox.contains(alert)).toBe(false);
    expect(within(listbox).getByRole('option', { name: /Réessayer/ })).toBeTruthy();
    expect(foreignRoles(listbox)).toEqual([]);
  });

  it('quand rien ne correspond, le message est hors de la liste', async () => {
    stubApi({ projects: projectsResponse, issues: { bdesk: bdeskIssues, mpm: mpmIssues } });

    const { dialog, listbox, user } = await openPalette('/');
    await user.keyboard('zzzzzz');

    const empty = await within(dialog).findByText('Aucun résultat pour « zzzzzz ».');
    expect(empty.getAttribute('role')).toBe('status');
    expect(listbox.contains(empty)).toBe(false);
    expect(foreignRoles(listbox)).toEqual([]);
  });

  it('avec des résultats, la liste ne porte que des options et des groupes', async () => {
    stubApi({ projects: projectsResponse, issues: { bdesk: bdeskIssues, mpm: mpmIssues } });

    const { listbox, user } = await openPalette('/');
    await user.keyboard('shell');

    expect(await within(listbox).findByRole('option', { name: /Shell UI façon Linear/ })).toBeTruthy();
    expect(foreignRoles(listbox)).toEqual([]);
  });
});
