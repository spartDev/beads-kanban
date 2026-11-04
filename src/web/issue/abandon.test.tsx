import { screen, within } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import type { IssueAbandon, IssueRef } from '../data/types';
import { withAsyncTimeout } from '../test/asyncTimeout';
import { issue, issueDetail, projectsResponse } from '../test/fixtures';
import { renderApp, stubApi } from '../test/render';

// Monter toute l'application prend plus d'une seconde quand la machine est chargée : voir `withAsyncTimeout`.
withAsyncTimeout(5_000);

/** L'espace insécable que la typographie française met à l'intérieur des guillemets : le titre ne s'y coupe pas de ses guillemets. */
const NBSP = '\u00a0';

const ref = (id: string, title: string): IssueRef => ({ id, title, type: 'task', status: 'closed', priority: 2 });

/** Le panneau d'un ticket fermé, avec ou sans Abandon (`abandon`), et les tickets que sa fiche nomme (`linked`). */
async function openClosed(abandon: IssueAbandon | undefined, linked: Record<string, IssueRef> = {}) {
  const base = { id: 'bdesk-2', title: 'Le ticket fermé', status: 'closed', closedAt: '2026-10-05T09:00:00Z', ...(abandon ? { abandon } : {}) };
  stubApi({
    projects: projectsResponse,
    issues: { bdesk: [issue(base), issue({ id: 'bdesk-1', title: 'Le ticket de référence', status: 'closed' })] },
    details: { 'bdesk/bdesk-2': issueDetail({ ...base, linked }) },
  });
  const app = renderApp('/p/bdesk/t/bdesk-2');
  return { ...app, dialog: await screen.findByRole('dialog', { name: /Le ticket fermé/ }) };
}

/**
 * La fiche d'un Abandon le dit comme la carte du kanban (la pastille « Abandon ») et l'explique : doublon de quel ticket,
 * remplacé par lequel, avec un lien pour l'ouvrir. Une Livraison n'a rien de tel.
 */
describe('le panneau d’un Abandon', () => {
  it('porte la pastille Abandon à côté du statut', async () => {
    const { dialog } = await openClosed({ cause: 'duplicate', of: 'bdesk-1' }, { 'bdesk-1': ref('bdesk-1', 'Le ticket de référence') });

    const status = within(dialog).getByText('fermé').closest('dd');

    expect(status && within(status).getByText('Abandon')).toBeTruthy();
  });

  it('dit de quel ticket il est le doublon, avec un lien vers lui', async () => {
    const { dialog } = await openClosed({ cause: 'duplicate', of: 'bdesk-1' }, { 'bdesk-1': ref('bdesk-1', 'Le ticket de référence') });

    const link = within(dialog).getByRole('link', { name: 'bdesk-1' });

    expect(link.getAttribute('href')).toBe('/p/bdesk/t/bdesk-1');
    expect(link.closest('p')?.textContent).toBe(`Doublon de bdesk-1 «${NBSP}Le ticket de référence${NBSP}». Fermé sans être une Livraison.`);
  });

  it('dit par quel ticket il est remplacé', async () => {
    const { dialog } = await openClosed({ cause: 'superseded', of: 'bdesk-1' }, { 'bdesk-1': ref('bdesk-1', 'Le ticket de référence') });

    expect(within(dialog).getByRole('link', { name: 'bdesk-1' }).closest('p')?.textContent).toBe(
      `Remplacé par bdesk-1 «${NBSP}Le ticket de référence${NBSP}». Fermé sans être une Livraison.`,
    );
  });

  it('nomme sans lien le ticket qui n’est pas dans le Projet : il n’y a rien à ouvrir', async () => {
    const { dialog } = await openClosed({ cause: 'superseded', of: 'external:ailleurs:x-1' });

    expect(within(dialog).queryByRole('link', { name: 'external:ailleurs:x-1' })).toBeNull();
    expect(within(dialog).getByText('external:ailleurs:x-1').closest('p')?.textContent).toBe(
      'Remplacé par external:ailleurs:x-1 (hors du Projet). Fermé sans être une Livraison.',
    );
  });

  it('ne dit pas deux fois le motif aux lecteurs d’écran : la phrase le donne, la pastille se tait', async () => {
    const { dialog } = await openClosed({ cause: 'duplicate', of: 'bdesk-1' }, { 'bdesk-1': ref('bdesk-1', 'Le ticket de référence') });

    const pill = within(dialog).getByText('Abandon');

    expect(pill.textContent).toBe('Abandon');
    expect(pill.getAttribute('title')).toBe('Abandon : doublon de bdesk-1');
  });

  it('n’existe pas pour une Livraison : ni pastille, ni phrase', async () => {
    const { dialog } = await openClosed(undefined);

    expect(within(dialog).queryByText('Abandon')).toBeNull();
    expect(within(dialog).queryByText(/Fermé sans être une Livraison/)).toBeNull();
  });
});
