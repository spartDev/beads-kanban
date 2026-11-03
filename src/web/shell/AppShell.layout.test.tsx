import { screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { bdeskIssues, mpmIssues, projectsResponse } from '../test/fixtures';
import { renderApp, stubApi } from '../test/render';

/**
 * Sur ordinateur le panneau de contenu est le seul à défiler (`md:overflow-y-auto`) : la barre latérale et la barre du
 * haut restent en place. Pour qu'il le reste, il doit aussi être positionné (`relative`). Les éléments `sr-only` des
 * pages (légendes de tableau, « (4 minutes) » des âges, « tickets » du kanban…) sont en `position: absolute` ; sans
 * ancêtre positionné, leur bloc conteneur est la fenêtre, et leur position statique, loin en bas d'une page longue,
 * allonge le document au-delà de la fenêtre (1 904 px pour 900 sur les Métriques d'un Projet, 3 257 sur la Vue
 * globale, 8 211 au kanban). La molette fait alors défiler le document une fois le panneau au bout : la barre latérale
 * et la barre du haut sortent de l'écran.
 *
 * jsdom ne mesure rien : ce test garde la classe qui corrige la cause. La mesure (hauteur du document = hauteur de la
 * fenêtre, molette comprise) se fait en vrai navigateur ; voir la preuve de bdesk-38k.12.
 */
describe('AppShell : le panneau de contenu', () => {
  it('est positionné, pour que les éléments sr-only des pages restent dans le panneau qui défile', async () => {
    stubApi({ projects: projectsResponse, issues: { bdesk: bdeskIssues, mpm: mpmIssues } });
    renderApp('/p/bdesk/kanban');
    await screen.findByRole('navigation', { name: 'Navigation principale' });

    const main = screen.getByRole('main');

    expect(main.id).toBe('contenu');
    expect(main.classList.contains('relative')).toBe(true);
  });
});
