import { screen, within } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import type { Issue } from '../data/types';
import { withAsyncTimeout } from '../test/asyncTimeout';
import { issue, projectsResponse } from '../test/fixtures';
import { renderApp, stubApi } from '../test/render';

/**
 * Les Statuts de relais sur la page d'une Epic (bdesk-pz0.4) : un Enfant En relecture, En intégration ou À valider est dans la colonne de son statut,
 * et dans Bloqué en Blocage, par colonne comme en arbre, comme au tableau. Une colonne sans Enfant n'y est pas : une Epic sans Enfant en relais garde
 * la page d'avant.
 */

withAsyncTimeout(5_000);

const EPIC = issue({ id: 'bdesk-e1', title: 'Chaîne d’agents', type: 'epic' });
const child = (id: string, title: string, overrides: Partial<Issue> = {}) => issue({ id, title, parentId: EPIC.id, ...overrides });
const CHILDREN: Issue[] = [
  EPIC,
  child('bdesk-1', 'En développement', { status: 'in_progress' }),
  child('bdesk-2', 'Relu par un agent', { status: 'in_review' }),
  child('bdesk-3', 'Demande de fusion ouverte', { status: 'in_integration' }),
  child('bdesk-4', 'Attend votre test', { status: 'awaiting_human' }),
  child('bdesk-5', 'Relecture coincée', { status: 'in_review', blockedBy: ['bdesk-1'] }),
];

const open = (issues: Issue[], path = '/p/bdesk/epics?epic=bdesk-e1') => {
  stubApi({ projects: projectsResponse, issues: { bdesk: issues } });
  return renderApp(path);
};
const groups = () => [...document.querySelectorAll<HTMLElement>('[data-epic-group]')].map((section) => section.dataset.epicGroup);
const linksIn = (name: string) =>
  within(screen.getByRole('region', { name }))
    .getAllByRole('link')
    .map((link) => link.textContent);

describe('la page Epic, par colonne', () => {
  it('range chaque Enfant d’un Statut de relais dans sa colonne, entre En cours et Bloqué, et en Bloqué en Blocage', async () => {
    open(CHILDREN);
    await screen.findByRole('region', { name: 'En relecture' });

    expect(groups()).toEqual(['inProgress', 'inReview', 'inIntegration', 'awaitingHuman', 'blocked']);
    expect(linksIn('En relecture')).toEqual([expect.stringContaining('Relu par un agent')]);
    expect(linksIn('En intégration')).toEqual([expect.stringContaining('Demande de fusion ouverte')]);
    expect(linksIn('À valider')).toEqual([expect.stringContaining('Attend votre test')]);
    expect(linksIn('Bloqué')).toEqual([expect.stringContaining('Relecture coincée')]);
  });

  it('compte les Enfants par colonne dans l’avancement, colonnes de relais comprises', async () => {
    open(CHILDREN);

    const pills = await screen.findByRole('list', { name: 'Enfants par colonne' });
    expect(within(pills).getAllByRole('listitem').map((item) => item.textContent)).toEqual([
      'En cours 1',
      'En relecture 1',
      'En intégration 1',
      'À valider 1',
      'Bloqué 1',
    ]);
  });

  it('garde ses colonnes d’avant quand aucun Enfant n’est en relais', async () => {
    open([EPIC, child('bdesk-1', 'En développement', { status: 'in_progress' }), child('bdesk-6', 'Prêt')]);
    await screen.findByRole('region', { name: 'En cours' });

    expect(groups()).toEqual(['ready', 'inProgress']);
  });
});

describe('la page Epic, en arbre', () => {
  it('écrit sur chaque ligne la colonne de son Statut de relais, et Bloqué en Blocage', async () => {
    open(CHILDREN, '/p/bdesk/epics?epic=bdesk-e1&view=tree');

    const tree = await screen.findByRole('list', { name: 'Arborescence' });
    const row = (title: string) => within(tree).getAllByRole('link').find((link) => link.textContent?.includes(title))?.textContent;
    expect(row('Relu par un agent')).toContain('En relecture');
    expect(row('Demande de fusion ouverte')).toContain('En intégration');
    expect(row('Attend votre test')).toContain('À valider');
    expect(row('Relecture coincée')).toContain('Bloqué');
    expect(row('En développement')).toContain('En cours');
  });
});
