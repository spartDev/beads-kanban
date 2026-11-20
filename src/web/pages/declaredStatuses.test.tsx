import { screen, within } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import type { ApiSignal, DeclaredStatuses, Issue } from '../data/types';
import { withAsyncTimeout } from '../test/asyncTimeout';
import { chronology, issue, projectsResponse } from '../test/fixtures';
import { renderApp, stubApi } from '../test/render';

/**
 * Les statuts que déclare un Projet (bdesk-pz0.3, ADR 0007), du tableau au panneau : le serveur les rend avec ses tickets, et le tableau, la page Epic et
 * les Signaux d'un ticket les lisent (`useDeclaredStatuses`). Un statut que le Projet déclare de catégorie `wip` est en En cours, comme au CFD, au WIP et
 * à la page « À regarder » ; un statut d'une autre catégorie reste « En pause ». Un Statut de relais est dans sa colonne, déclaré ou non (bdesk-pz0.4).
 */

withAsyncTimeout(5_000);

const DAY = 86_400_000;
const DECLARED: DeclaredStatuses = {
  handoff: ['in_review'],
  others: [
    { name: 'qa_testing', category: 'wip' },
    { name: 'on_hold', category: 'frozen' },
  ],
};

const EPIC = issue({ id: 'bdesk-e1', title: 'Recette du thème', type: 'epic' });
const TICKETS: Issue[] = [
  EPIC,
  issue({ id: 'bdesk-1', title: 'En recette', status: 'qa_testing', parentId: 'bdesk-e1' }),
  issue({ id: 'bdesk-2', title: 'Relu par un agent', status: 'in_review', parentId: 'bdesk-e1' }),
  issue({ id: 'bdesk-3', title: 'Gelé pour l’instant', status: 'on_hold', parentId: 'bdesk-e1' }),
  issue({ id: 'bdesk-4', title: 'Prêt à démarrer', parentId: 'bdesk-e1' }),
];

const drift = (id: string): ApiSignal => ({
  kind: 'drift',
  project: 'bdesk',
  ticket: { id, title: `Titre de ${id}`, type: 'task', priority: 2 },
  cycleTime: 12 * DAY,
  reference: 8.65 * DAY,
  scope: 'type',
});

const stub = (declared?: DeclaredStatuses) =>
  stubApi({ projects: projectsResponse, issues: { bdesk: TICKETS }, signals: { bdesk: [drift('bdesk-1')] }, ...(declared ? { declared: { bdesk: declared } } : {}) });

const titlesIn = (region: HTMLElement) =>
  within(region)
    .queryAllByRole('listitem')
    .map((card) => within(card).getAllByRole('link')[0]?.textContent);
const card = (id: string) => document.querySelector<HTMLElement>(`[data-card-id="${id}"]`) as HTMLElement;

describe('le tableau', () => {
  it('range un statut déclaré wip en En cours, le Statut de relais dans sa colonne, et laisse « En pause » un statut déclaré d’une autre catégorie', async () => {
    stub(DECLARED);
    const { user } = renderApp('/p/bdesk/kanban');

    const inProgress = await screen.findByRole('region', { name: 'En cours' });
    expect(titlesIn(inProgress)).toEqual(['En recette']);
    expect(titlesIn(screen.getByRole('region', { name: 'En relecture' }))).toEqual(['Relu par un agent']);
    await user.click(screen.getByRole('button', { name: /^En pause/ }));
    expect(titlesIn(screen.getByRole('region', { name: 'En pause' }))).toEqual(['Gelé pour l’instant']);
  });

  it('montre sur la carte d’un statut déclaré wip la Dérive que le serveur a comptée', async () => {
    stub(DECLARED);
    renderApp('/p/bdesk/kanban');

    expect(await within(await screen.findByRole('region', { name: 'En cours' }).then(() => card('bdesk-1'))).findByText('Dérive')).toBeTruthy();
  });

  it('sans déclaration, laisse ce statut « En pause », comme avant : le Statut de relais garde sa colonne, reconnu à son nom', async () => {
    stub();
    const { user } = renderApp('/p/bdesk/kanban');

    expect(titlesIn(await screen.findByRole('region', { name: 'En cours' }))).toEqual([]);
    expect(titlesIn(screen.getByRole('region', { name: 'En relecture' }))).toEqual(['Relu par un agent']);
    await user.click(screen.getByRole('button', { name: /^En pause/ }));
    expect(titlesIn(screen.getByRole('region', { name: 'En pause' })).sort()).toEqual(['En recette', 'Gelé pour l’instant']);
    expect(within(card('bdesk-1')).queryByText('Dérive')).toBeNull();
  });
});

describe('le panneau d’un ticket', () => {
  it('dit, dans la Chronologie, que le ticket d’un statut déclaré wip dérive', async () => {
    const inQa = chronology({
      transitions: [
        { status: 'open', at: '2026-10-01T09:00:00.000Z', duration: DAY },
        { status: 'qa_testing', at: '2026-10-02T09:00:00.000Z', duration: null },
      ],
    });
    stubApi({
      projects: projectsResponse,
      issues: { bdesk: TICKETS },
      declared: { bdesk: DECLARED },
      chronologies: { 'bdesk/bdesk-1': inQa },
      signals: { bdesk: [drift('bdesk-1')] },
    });
    renderApp('/p/bdesk/t/bdesk-1');

    const dialog = await screen.findByRole('dialog', { name: /En recette/ });
    const section = within(dialog).getByRole('region', { name: 'Chronologie' });

    expect(await within(section).findByText(/^Dérive/)).toBeTruthy();
  });
});

describe('la page Epic', () => {
  it('range par colonne un Enfant d’un statut déclaré wip en En cours, et celui d’un Statut de relais dans la sienne, comme le tableau', async () => {
    stub(DECLARED);
    renderApp('/p/bdesk/epics?epic=bdesk-e1');

    const inProgress = await screen.findByRole('region', { name: 'En cours' });
    expect(inProgress.getAttribute('data-epic-group')).toBe('inProgress');
    expect(within(inProgress).getAllByRole('link').map((link) => link.textContent?.includes('En recette'))).toEqual([true]);
    const inReview = screen.getByRole('region', { name: 'En relecture' });
    expect(inReview.getAttribute('data-epic-group')).toBe('inReview');
    expect(within(inReview).getAllByRole('link').map((link) => link.textContent?.includes('Relu par un agent'))).toEqual([true]);
    expect(within(screen.getByRole('region', { name: 'En pause' })).getAllByRole('link')).toHaveLength(1);
  });

  it('écrit En cours dans l’arborescence sur la ligne d’un statut déclaré wip, et En relecture sur celle du Statut de relais', async () => {
    stub(DECLARED);
    renderApp('/p/bdesk/epics?epic=bdesk-e1&view=tree');

    const tree = await screen.findByRole('list', { name: 'Arborescence' });
    const row = (title: string) => within(tree).getAllByRole('link').find((link) => link.textContent?.includes(title));

    expect(row('En recette')?.textContent).toContain('En cours');
    expect(row('Relu par un agent')?.textContent).toContain('En relecture');
    expect(row('Gelé pour l’instant')?.textContent).toContain('En pause');
  });

  it('passe la déclaration aux niveaux suivants de l’arborescence : un petit-enfant d’un statut déclaré wip est En cours', async () => {
    const nested: Issue[] = [
      EPIC,
      issue({ id: 'bdesk-1', title: 'Enfant en cours', status: 'in_progress', parentId: 'bdesk-e1' }),
      issue({ id: 'bdesk-1.1', title: 'Petit-enfant en recette', status: 'qa_testing', parentId: 'bdesk-1' }),
      issue({ id: 'bdesk-1.1.1', title: 'Arrière-petit-enfant en recette', status: 'qa_testing', parentId: 'bdesk-1.1' }),
    ];
    stubApi({ projects: projectsResponse, issues: { bdesk: nested }, declared: { bdesk: DECLARED } });
    renderApp('/p/bdesk/epics?epic=bdesk-e1&view=tree');

    const tree = await screen.findByRole('list', { name: 'Arborescence' });
    const row = (title: string) => within(tree).getAllByRole('link').find((link) => link.textContent?.includes(title));

    expect(row('Petit-enfant en recette')?.textContent).toContain('En cours');
    expect(row('Arrière-petit-enfant en recette')?.textContent).toContain('En cours');
  });
});
