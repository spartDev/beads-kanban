import { screen, waitFor, within } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import type { DeclaredStatuses, Issue } from '../data/types';
import { withAsyncTimeout } from '../test/asyncTimeout';
import { issue, projectsResponse } from '../test/fixtures';
import { setBrowserLanguages } from '../test/languages';
import { renderApp, stubApi } from '../test/render';

/**
 * Les colonnes des Statuts de relais au tableau (bdesk-pz0.4, ADR 0007) : En relecture, En intégration et À valider, entre En cours et Bloqué. Une
 * colonne de relais n'est là que si le Projet déclare son statut ou qu'un de ses tickets le porte ; sinon, le tableau garde ses cinq colonnes, comme
 * avant. Un ticket d'un Statut de relais est dans sa colonne, et dans Bloqué en Blocage ; sa carte dit alors son statut, que la colonne ne dit plus.
 */

withAsyncTimeout(5_000);

const ALL_HANDOFF: DeclaredStatuses = { handoff: ['in_review', 'in_integration', 'awaiting_human'], others: [] };
const WITH_QA: DeclaredStatuses = { handoff: [], others: [{ name: 'qa_testing', category: 'wip' }] };

const TICKETS: Issue[] = [
  issue({ id: 'bdesk-1', title: 'Prêt à démarrer' }),
  issue({ id: 'bdesk-2', title: 'En développement', status: 'in_progress' }),
  issue({ id: 'bdesk-3', title: 'Relu par un agent', status: 'in_review' }),
  issue({ id: 'bdesk-4', title: 'Demande de fusion ouverte', status: 'in_integration' }),
  issue({ id: 'bdesk-5', title: 'Attend votre test', status: 'awaiting_human' }),
  issue({ id: 'bdesk-6', title: 'Relecture coincée', status: 'in_review', blockedBy: ['bdesk-1'] }),
];

const PLAIN: Issue[] = [
  issue({ id: 'bdesk-1', title: 'Prêt à démarrer' }),
  issue({ id: 'bdesk-2', title: 'En développement', status: 'in_progress' }),
  issue({ id: 'bdesk-7', title: 'Rattaché', status: 'hooked' }),
  issue({ id: 'bdesk-8', title: 'Statut bloqué', status: 'blocked' }),
];

async function openBoard(issues: Issue[], { declared, path = '/p/bdesk/kanban', language }: { declared?: DeclaredStatuses; path?: string; language?: 'en' } = {}) {
  if (language) setBrowserLanguages(['en-US']);
  stubApi({ projects: projectsResponse, issues: { bdesk: issues }, ...(declared ? { declared: { bdesk: declared } } : {}) });
  const app = renderApp(path, language ? { languageSwitch: true } : {});
  await screen.findByRole('region', { name: language ? 'Ready' : 'Prêt' });
  return app;
}

/** Les régions des colonnes, dans l'ordre du DOM. */
const columns = () => screen.getAllByRole('region').filter((region) => region.hasAttribute('data-column'));
const headings = () => columns().map((region) => region.querySelector('h2')?.textContent);
const titlesIn = (region: HTMLElement) =>
  within(region)
    .queryAllByRole('listitem')
    .map((card) => within(card).getAllByRole('link')[0]?.textContent);
const card = (id: string) => document.querySelector<HTMLElement>(`[data-card-id="${id}"]`) as HTMLElement;
/** La pastille de statut d'une carte : son texte, ou null sans pastille. */
const statusPill = (id: string) => card(id).querySelector('[data-card-status]')?.textContent ?? null;
const selectorButtons = () => within(screen.getByRole('group', { name: /^(Colonne affichée|Column shown)$/ })).getAllByRole('button');

describe('sans Statut de relais déclaré ni porté', () => {
  it('garde ses cinq colonnes et son sélecteur de cinq boutons, comme avant', async () => {
    await openBoard(PLAIN);

    expect(headings()).toEqual(['Backlog', 'Prêt', 'En cours', 'Bloqué', 'Terminé']);
    expect(selectorButtons()).toHaveLength(5);
    expect(document.querySelector('[data-column-selector] [role="group"]')?.className).toContain('grid-cols-5');
  });

  it('n’écrit aucun statut sur les cartes de ses colonnes : en cours, rattaché à un agent (sa pastille « agent ») et statut bloqué', async () => {
    await openBoard(PLAIN);

    for (const id of ['bdesk-1', 'bdesk-2', 'bdesk-7', 'bdesk-8']) expect(statusPill(id), id).toBeNull();
    expect(within(card('bdesk-7')).getByText('agent')).toBeTruthy();
  });
});

describe('les colonnes de relais', () => {
  it('apparaissent entre En cours et Bloqué quand des tickets portent leur statut, sans déclaration', async () => {
    await openBoard(TICKETS);

    expect(headings()).toEqual(['Backlog', 'Prêt', 'En cours', 'En relecture', 'En intégration', 'À valider', 'Bloqué', 'Terminé']);
    expect(selectorButtons().map((button) => button.textContent)).toEqual([
      'Backlog0 ticket',
      'Prêt1 ticket',
      'En cours1 ticket',
      'En relecture1 ticket',
      'En intégration1 ticket',
      'À valider1 ticket',
      'Bloqué1 ticket',
      'Terminé0 ticket',
    ]);
  });

  it('rangent chaque ticket dans la colonne de son statut, et un ticket en Blocage dans Bloqué', async () => {
    await openBoard(TICKETS);

    expect(titlesIn(screen.getByRole('region', { name: 'En cours' }))).toEqual(['En développement']);
    expect(titlesIn(screen.getByRole('region', { name: 'En relecture' }))).toEqual(['Relu par un agent']);
    expect(titlesIn(screen.getByRole('region', { name: 'En intégration' }))).toEqual(['Demande de fusion ouverte']);
    expect(titlesIn(screen.getByRole('region', { name: 'À valider' }))).toEqual(['Attend votre test']);
    expect(titlesIn(screen.getByRole('region', { name: 'Bloqué' }))).toEqual(['Relecture coincée']);
  });

  it('apparaissent vides quand le Projet déclare leur statut et qu’aucun ticket ne le porte', async () => {
    await openBoard(PLAIN, { declared: ALL_HANDOFF });

    expect(headings()).toEqual(['Backlog', 'Prêt', 'En cours', 'En relecture', 'En intégration', 'À valider', 'Bloqué', 'Terminé']);
    for (const name of ['En relecture', 'En intégration', 'À valider']) expect(within(screen.getByRole('region', { name })).getByText('Aucun ticket')).toBeTruthy();
  });

  it('n’apparaissent que pour les statuts déclarés ou portés : une seule colonne de relais, à sa place', async () => {
    await openBoard([...PLAIN, issue({ id: 'bdesk-5', title: 'Attend votre test', status: 'awaiting_human' })]);

    expect(headings()).toEqual(['Backlog', 'Prêt', 'En cours', 'À valider', 'Bloqué', 'Terminé']);
  });

  it('disent leur règle en infobulle, avec les mots du glossaire', async () => {
    await openBoard(TICKETS);

    const hint = (name: string, text: string) => within(screen.getByRole('region', { name })).getByText(text).getAttribute('title');
    expect(hint('En relecture', 'Agent relecteur, hors Blocage')).toBe('Ticket qu’un agent relecteur examine, sans dépendance en suspens.');
    expect(hint('En intégration', 'Fusion demandée, hors Blocage')).toContain('la demande de fusion est ouverte');
    expect(hint('À valider', 'Vous attend, hors Blocage')).toContain('un test à la main, une décision ou votre feu vert');
  });

  it('s’affichent seules sur mobile avec ?col=, et retombent sur la colonne d’ouverture pour une colonne que le Projet n’a pas', async () => {
    await openBoard(TICKETS, { path: '/p/bdesk/kanban?col=awaitingHuman' });
    expect(columns().filter((region) => region.dataset.shown === 'true').map((region) => region.dataset.column)).toEqual(['awaitingHuman']);
    expect(selectorButtons().find((button) => button.getAttribute('aria-pressed') === 'true')?.textContent).toMatch(/^À valider/);
  });

  it('ne montrent pas une colonne de relais absente du Projet, même demandée par l’adresse', async () => {
    await openBoard(PLAIN, { path: '/p/bdesk/kanban?col=inReview' });

    expect(columns().filter((region) => region.dataset.shown === 'true').map((region) => region.dataset.column)).toEqual(['inProgress']);
  });

  it('se suivent aux raccourcis h et l, comme les autres colonnes', async () => {
    const { user, router } = await openBoard(TICKETS, { path: '/p/bdesk/kanban?col=inProgress' });

    await user.keyboard('l');
    await waitFor(() => expect(router.state.location.search).toBe('?col=inReview'));
    await user.keyboard('l');
    await waitFor(() => expect(router.state.location.search).toBe('?col=inIntegration'));
    await user.keyboard('h');
    await waitFor(() => expect(router.state.location.search).toBe('?col=inReview'));
  });

  it('passent côte à côte à un seuil qui croît avec leur nombre, sans écraser une colonne : la grille du tableau a une piste par colonne', async () => {
    await openBoard(TICKETS);

    const grid = columns()[0]?.parentElement as HTMLElement;
    expect(grid.className).toContain('@min-[96rem]:grid-cols-8');
    expect(grid.className).not.toContain('@min-[60rem]');
  });
});

describe('la pastille de statut d’une carte : le statut que sa colonne ne dit pas', () => {
  it('dit le Statut de relais d’une carte en Bloqué, pour savoir à quelle étape elle est bloquée', async () => {
    await openBoard(TICKETS);

    expect(within(screen.getByRole('region', { name: 'Bloqué' })).getByText('en relecture')).toBeTruthy();
    expect(statusPill('bdesk-6')).toBe('en relecture');
  });

  it('ne dit rien d’une carte de relais dans sa propre colonne, ni d’une carte en cours en En cours', async () => {
    await openBoard(TICKETS);

    for (const id of ['bdesk-2', 'bdesk-3', 'bdesk-4', 'bdesk-5']) expect(statusPill(id), id).toBeNull();
  });

  it('dit un autre statut que le Projet déclare comme travail, en En cours comme en Bloqué', async () => {
    const issues = [
      ...PLAIN,
      issue({ id: 'bdesk-9', title: 'En recette', status: 'qa_testing' }),
      issue({ id: 'bdesk-10', title: 'Recette coincée', status: 'qa_testing', blockedBy: ['bdesk-1'] }),
    ];
    await openBoard(issues, { declared: WITH_QA });

    expect(within(screen.getByRole('region', { name: 'En cours' })).getByText('qa_testing')).toBeTruthy();
    expect(statusPill('bdesk-9')).toBe('qa_testing');
    expect(statusPill('bdesk-10')).toBe('qa_testing');
    expect(statusPill('bdesk-2')).toBeNull();
  });

  it('garde la pastille du tiroir « En pause »', async () => {
    const { user } = await openBoard([...PLAIN, issue({ id: 'bdesk-11', title: 'Reporté', status: 'deferred' })]);

    await user.click(screen.getByRole('button', { name: /^En pause/ }));
    expect(statusPill('bdesk-11')).toBe('reporté');
  });
});

describe('en anglais', () => {
  it('nomme les colonnes de relais avec les termes de CONTEXT.md, chacune avec sa règle', async () => {
    await openBoard(TICKETS, { language: 'en' });

    expect(headings()).toEqual(['Backlog', 'Ready', 'In progress', 'In review', 'In integration', 'Awaiting validation', 'Blocked', 'Done']);
    const hint = (name: string, text: string) => within(screen.getByRole('region', { name })).getByText(text).getAttribute('title');
    expect(hint('In review', 'Agent reviewing, not Blocked')).toBe('Ticket that an agent reviewer is examining, with no pending dependency.');
    expect(hint('In integration', 'Merge requested, not Blocked')).toBe(
      'Ticket whose merge request is open, during its automated checks and external review, with no pending dependency.',
    );
    expect(hint('Awaiting validation', 'Waiting for you, not Blocked')).toBe(
      'Ticket waiting for you: a manual test, a decision or your go-ahead to merge, with no pending dependency.',
    );
    expect(statusPill('bdesk-6')).toBe('in review');
  });
});
