import { screen, within } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import type { IssueAbandon, IssueRef } from '../data/types';
import { withAsyncTimeout } from '../test/asyncTimeout';
import { BLANK_SAMPLE, UNTITLED } from '../test/blankTitles';
import { issue, issueDetail, projectsResponse } from '../test/fixtures';
import { renderApp, stubApi } from '../test/render';

/**
 * Les tickets sans titre que le panneau d'un ticket nomme (bdesk-38k.54) : ses relations, le ticket dont il est le doublon, son Parent, ceux qui le
 * bloquent. Le titre de chacun vient de la fiche (`linked`) tel qu'il est dans la base : vide, fait d'espaces ou de caractères sans largeur, il ne
 * laissait qu'un texte invisible, ou des guillemets vides (« Doublon de bdesk-zz1 «  » »). Chacun est écrit comme dans le reste de l'interface
 * (bdesk-38k.50) : « Sans titre » (`ticketTitle`), son identifiant étant déjà écrit à côté.
 */

// Monter toute l'application prend plus d'une seconde quand la machine est chargée : voir `withAsyncTimeout`.
withAsyncTimeout(5_000);

/** L'espace insécable que la typographie française met à l'intérieur des guillemets : le titre ne s'y coupe pas de ses guillemets. */
const NBSP = ' ';

const ref = (id: string, title: string, overrides: Partial<IssueRef> = {}): IssueRef => ({ id, title, type: 'task', status: 'open', priority: 2, ...overrides });

describe.each(BLANK_SAMPLE)('le panneau d’un ticket relié à des tickets dont le titre est %s', (_kind, blank) => {
  /** Un ticket relié à un ticket sans titre de chaque genre : parent, enfant, bloquant, bloqué, lié, découvert à partir de. */
  const RELATED = issueDetail({
    id: 'bdesk-9',
    title: 'Un ticket très relié',
    parentId: 'bdesk-p',
    dependencies: [
      { to: 'bdesk-p', type: 'parent-child' },
      { to: 'bdesk-b', type: 'blocks' },
      { to: 'bdesk-l', type: 'relates-to' },
      { to: 'bdesk-d', type: 'discovered-from' },
    ],
    dependents: [
      { from: 'bdesk-c', type: 'parent-child' },
      { from: 'bdesk-k', type: 'blocks' },
    ],
    linked: {
      'bdesk-p': ref('bdesk-p', blank),
      'bdesk-b': ref('bdesk-b', blank),
      'bdesk-l': ref('bdesk-l', blank),
      'bdesk-d': ref('bdesk-d', blank),
      'bdesk-c': ref('bdesk-c', blank),
      'bdesk-k': ref('bdesk-k', blank),
      'bdesk-t': ref('bdesk-t', 'Un ticket relié qui a un titre'),
    },
    blockedBy: ['bdesk-b'],
  });

  async function show(detail = RELATED) {
    stubApi({ projects: projectsResponse, issues: { bdesk: [issue({ id: 'bdesk-9', title: 'Un ticket très relié' })] }, details: { 'bdesk/bdesk-9': detail } });
    const app = renderApp('/p/bdesk/t/bdesk-9');
    const dialog = await screen.findByRole('dialog', { name: /Un ticket très relié/ });
    return { ...app, dialog, relations: within(await within(dialog).findByRole('region', { name: 'Relations' })) };
  }

  it('écrit « Sans titre » pour chaque ticket lié, dans chaque genre de relation, avec son identifiant et son statut', async () => {
    const { relations } = await show();

    for (const [group, id] of [
      ['Parent', 'bdesk-p'],
      ['Enfants', 'bdesk-c'],
      ['Bloqué par', 'bdesk-b'],
      ['Bloque', 'bdesk-k'],
      ['Lié à', 'bdesk-l'],
      ['Découvert à partir de', 'bdesk-d'],
    ] as const) {
      const link = within(relations.getByRole('list', { name: group })).getByRole('link');
      expect(link.getAttribute('href'), group).toBe(`/p/bdesk/t/${id}`);
      expect(link.textContent, group).toBe(`${id} ${UNTITLED} ouvert${group === 'Bloqué par' ? ' Bloque encore' : ''}`);
    }
  });

  it('nomme chacun de ces liens de son identifiant puis de « Sans titre »', async () => {
    const { relations } = await show();

    expect(relations.getByRole('link', { name: /^bdesk-b Sans titre ouvert Bloque encore$/ })).toBeTruthy();
    expect(relations.getByRole('link', { name: /^bdesk-k Sans titre ouvert$/ })).toBeTruthy();
  });

  it('laisse à un ticket lié qui a un titre son titre', async () => {
    const { relations } = await show({
      ...RELATED,
      dependencies: [...RELATED.dependencies, { to: 'bdesk-t', type: 'relates-to' }],
    });

    const link = relations.getByRole('link', { name: /bdesk-t Un ticket relié qui a un titre/ });

    expect(link.textContent).toBe('bdesk-t Un ticket relié qui a un titre ouvert');
    expect(within(link).queryByText(UNTITLED)).toBeNull();
  });

  it('nomme le Parent qui n’est pas une Epic de son identifiant et de « Sans titre », dans l’en-tête', async () => {
    const { dialog } = await show();

    const parent = within(dialog).getByRole('link', { name: /^Parent bdesk-p/ });

    expect(parent.textContent).toBe(`Parent bdesk-p ${UNTITLED}`);
  });

  it('donne « Sans titre » en infobulle au lien d’un ticket bloquant sans titre, plutôt qu’une infobulle vide', async () => {
    const { dialog } = await show();

    const blocker = within(dialog).getByRole('link', { name: 'bdesk-b' });

    expect(blocker.getAttribute('title')).toBe(UNTITLED);
  });
});

describe('le panneau d’un ticket bloqué par un ticket qui a un titre', () => {
  it('garde ce titre en infobulle du lien bloquant, sans espaces superflus', async () => {
    const detail = issueDetail({
      id: 'bdesk-9',
      title: 'Un ticket bloqué',
      blockedBy: ['bdesk-b'],
      dependencies: [{ to: 'bdesk-b', type: 'blocks' }],
      linked: { 'bdesk-b': ref('bdesk-b', '  Le   bloquant  ') },
    });
    stubApi({ projects: projectsResponse, issues: { bdesk: [issue({ id: 'bdesk-9', title: 'Un ticket bloqué' })] }, details: { 'bdesk/bdesk-9': detail } });
    renderApp('/p/bdesk/t/bdesk-9');
    const dialog = await screen.findByRole('dialog', { name: /Un ticket bloqué/ });

    const blocker = within(dialog).getByRole('link', { name: 'bdesk-b' });

    expect(blocker.getAttribute('title')).toBe('Le bloquant');
  });
});

describe.each(BLANK_SAMPLE)('le panneau d’un Abandon dont l’autre ticket a un titre %s', (_kind, blank) => {
  /** Le panneau d'un ticket fermé qui est le doublon de (ou remplacé par) `bdesk-1`, dont le titre est `blank`. */
  async function openAbandoned(abandon: IssueAbandon) {
    const base = { id: 'bdesk-2', title: 'Le ticket fermé', status: 'closed', closedAt: '2026-10-05T09:00:00Z', abandon };
    stubApi({
      projects: projectsResponse,
      issues: { bdesk: [issue(base), issue({ id: 'bdesk-1', title: blank, status: 'closed' })] },
      details: { 'bdesk/bdesk-2': issueDetail({ ...base, linked: { 'bdesk-1': ref('bdesk-1', blank, { status: 'closed' }) } }) },
    });
    renderApp('/p/bdesk/t/bdesk-2');
    return within(await screen.findByRole('dialog', { name: /Le ticket fermé/ }));
  }

  // Sans guillemets : « Sans titre » entre guillemets ne se distinguerait pas d'un ticket réellement intitulé « Sans titre » (voir plus bas).
  it('dit « Doublon de bdesk-1 (sans titre) », jamais des guillemets vides', async () => {
    const dialog = await openAbandoned({ cause: 'duplicate', of: 'bdesk-1' });

    expect(dialog.getByRole('link', { name: 'bdesk-1' }).closest('p')?.textContent).toBe(
      'Doublon de bdesk-1 (sans titre). Fermé sans être une Livraison.',
    );
  });

  it('dit de même « Remplacé par bdesk-1 (sans titre) »', async () => {
    const dialog = await openAbandoned({ cause: 'superseded', of: 'bdesk-1' });

    expect(dialog.getByRole('link', { name: 'bdesk-1' }).closest('p')?.textContent).toBe(
      'Remplacé par bdesk-1 (sans titre). Fermé sans être une Livraison.',
    );
  });
});

describe('le panneau d’un Abandon dont l’autre ticket est réellement intitulé « Sans titre »', () => {
  it.each([
    ['duplicate', 'Doublon de'],
    ['superseded', 'Remplacé par'],
  ] as const)('garde son titre entre guillemets (%s) : on ne le confond pas avec un ticket sans titre', async (cause, lead) => {
    const base = { id: 'bdesk-2', title: 'Le ticket fermé', status: 'closed', closedAt: '2026-10-05T09:00:00Z', abandon: { cause, of: 'bdesk-1' } } as const;
    stubApi({
      projects: projectsResponse,
      issues: { bdesk: [issue(base), issue({ id: 'bdesk-1', title: UNTITLED, status: 'closed' })] },
      details: { 'bdesk/bdesk-2': issueDetail({ ...base, linked: { 'bdesk-1': ref('bdesk-1', UNTITLED, { status: 'closed' }) } }) },
    });
    renderApp('/p/bdesk/t/bdesk-2');
    const dialog = within(await screen.findByRole('dialog', { name: /Le ticket fermé/ }));

    expect(dialog.getByRole('link', { name: 'bdesk-1' }).closest('p')?.textContent).toBe(
      `${lead} bdesk-1 «${NBSP}${UNTITLED}${NBSP}». Fermé sans être une Livraison.`,
    );
  });
});
