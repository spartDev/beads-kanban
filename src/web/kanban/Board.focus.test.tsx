import { type QueryClient } from '@tanstack/react-query';
import { act, render, screen, waitFor, within } from '@testing-library/react';
import { StrictMode, useRef } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { Issue } from '../data/types';
import { refreshProject } from '../live/refresh';
import { withAsyncTimeout } from '../test/asyncTimeout';
import { issue, projectsResponse } from '../test/fixtures';
import { renderApp, stubApi } from '../test/render';
import { useKeepFocusInBoard } from './boardFocus';

/**
 * Où est le focus quand ce qui l'avait dans le tableau disparaît sur un commit (bdesk-38k.59). La sélection du clavier est le focus de la carte (voir `useBoardShortcuts`) :
 * une carte que le commit change de colonne est remontée dans l'autre (React ne déplace pas un nœud d'un parent à l'autre), et le focus qu'elle avait tombait sur le corps de la page.
 * Il suit la carte, là où elle est maintenant ; faute de carte à l'écran (colonne cachée sur un écran étroit, ticket supprimé, tiroir fermé), il passe à la zone la plus proche, le contenu principal.
 * Jamais le focus qu'un utilisateur a mis ailleurs (voir `keepFocusInContent`, `lib/zoneFocus.ts`, dont c'est la veille).
 */

// Monter toute l'application prend plus d'une seconde quand la machine est chargée : voir `withAsyncTimeout`.
withAsyncTimeout(5_000);

const EPIC = issue({ id: 'bdesk-e1', title: 'Shell UI : thèmes et navigation', type: 'epic', priority: 1 });
const TICKETS: Issue[] = [
  EPIC,
  issue({ id: 'bdesk-a1', title: 'Palette ⌘K', priority: 1 }),
  issue({ id: 'bdesk-c1', title: 'Barre latérale', status: 'in_progress', parentId: EPIC.id, updatedAt: '2026-10-12T09:00:00Z' }),
  issue({ id: 'bdesk-c2', title: 'Thèmes clair et sombre', status: 'in_progress', updatedAt: '2026-10-11T09:00:00Z' }),
  issue({ id: 'bdesk-c3', title: 'Raccourcis clavier', status: 'in_progress', updatedAt: '2026-10-10T09:00:00Z' }),
  issue({ id: 'bdesk-d1', title: 'Fermé hier', status: 'closed', closedAt: new Date(Date.now() - 86_400_000).toISOString() }),
];

/** Le Projet tel que le serveur le dira à partir de maintenant. */
const serve = (issues: Issue[]) => stubApi({ projects: projectsResponse, issues: { bdesk: issues } });
/** Un commit du Projet, en direct : la liste des tickets est relue. */
const commit = (queryClient: QueryClient) => act(() => refreshProject(queryClient, 'bdesk'));
/** La liste après un commit qui change un ticket. */
const changed = (id: string, change: Partial<Issue>) => TICKETS.map((candidate) => (candidate.id === id ? { ...candidate, ...change } : candidate));
const closedNow = () => {
  const now = new Date().toISOString();
  return { status: 'closed', closedAt: now, updatedAt: now };
};

/** Laisse passer les effets et les minuteries de 0 ms : à attendre avant d'affirmer qu'un focus n'a pas bougé. */
const settle = () => act(() => new Promise<void>((resolve) => setTimeout(resolve, 40)));

/** Ouvre le tableau et attend une colonne affichée : « Prêt » quand les cinq le sont, « En cours » quand une seule l'est (la colonne d'ouverture, les autres sont cachées). */
async function openBoard(shown = 'Prêt') {
  serve(TICKETS);
  const app = renderApp('/p/bdesk/kanban');
  await screen.findByRole('region', { name: shown });
  return app;
}
const column = (name: string) => screen.getByRole('region', { name });
const cardLink = (id: string) => document.querySelector<HTMLElement>(`a[data-card-link="${id}"]`)!;
const main = () => document.querySelector('main');

/** Un commit qui change le ticket `id`, la carte `link` qui l'avait étant remontée : attend la nouvelle carte et laisse passer le tour. */
async function commitAndWaitForMove(queryClient: QueryClient, link: HTMLElement, lane: string) {
  await commit(queryClient);
  await waitFor(() => expect(link.isConnected).toBe(false));
  await waitFor(() => expect(cardLink(link.dataset.cardLink!).closest('li')?.dataset.column).toBe(lane));
  await settle();
}

/**
 * Pose une règle de style le temps d'un bloc de tests : jsdom ne charge pas le CSS de l'application (Tailwind), on y reproduit la seule règle
 * dont dépend le comportement testé.
 */
function withStyle(css: string) {
  let style: HTMLStyleElement | undefined;
  beforeEach(() => {
    style = document.createElement('style');
    style.textContent = css;
    document.head.append(style);
  });
  afterEach(() => style?.remove());
}

describe('la carte qui a le focus change de colonne sur un commit (cinq colonnes affichées)', () => {
  it('le commit ferme le ticket : la carte passe dans Terminé et garde le focus, le corps de la page ne l’a pas', async () => {
    const { queryClient } = await openBoard();
    const link = cardLink('bdesk-c1');
    act(() => link.focus());
    expect(document.activeElement).toBe(link);

    serve(changed('bdesk-c1', closedNow()));
    await commitAndWaitForMove(queryClient, link, 'done');

    expect(within(column('Terminé')).getByRole('link', { name: 'Barre latérale' })).toBe(cardLink('bdesk-c1'));
    expect(document.activeElement).toBe(cardLink('bdesk-c1')); // la carte, là où elle est maintenant : la sélection du clavier la suit
  });

  it('c’est la sélection du clavier qui suit la carte : « j » part de la carte déplacée, dans sa nouvelle colonne', async () => {
    const { user, queryClient } = await openBoard();
    const link = cardLink('bdesk-c1');
    act(() => link.focus());
    serve(changed('bdesk-c1', closedNow()));
    await commitAndWaitForMove(queryClient, link, 'done');
    expect(document.activeElement).toBe(cardLink('bdesk-c1')); // la première de Terminé : la clôture la plus récente d'abord

    await user.keyboard('j');

    expect(document.activeElement).toBe(cardLink('bdesk-d1')); // la suivante de Terminé, pas la première carte d'En cours
  });

  it('le commit rouvre le ticket (il repart dans Prêt) : la carte le suit, et la règle ne s’use pas', async () => {
    const { queryClient } = await openBoard();
    const link = cardLink('bdesk-c2');
    act(() => link.focus());
    serve(changed('bdesk-c2', { status: 'open' }));
    await commitAndWaitForMove(queryClient, link, 'ready');
    expect(document.activeElement).toBe(cardLink('bdesk-c2'));
    const again = cardLink('bdesk-c2');

    serve(changed('bdesk-c2', { status: 'in_progress' })); // un autre commit la ramène : elle est de nouveau remontée
    await commit(queryClient);
    await waitFor(() => expect(again.isConnected).toBe(false));
    await settle();

    expect(within(column('En cours')).getByRole('link', { name: 'Thèmes clair et sombre' })).toBe(cardLink('bdesk-c2'));
    expect(document.activeElement).toBe(cardLink('bdesk-c2'));
  });

  it('le commit met le ticket en Blocage (il attend un autre) : la carte passe dans Bloqué et garde le focus', async () => {
    const { queryClient } = await openBoard();
    const link = cardLink('bdesk-c1');
    act(() => link.focus());

    serve(changed('bdesk-c1', { blockedBy: ['bdesk-a1'] }));
    await commitAndWaitForMove(queryClient, link, 'blocked');

    expect(document.activeElement).toBe(cardLink('bdesk-c1'));
  });

  it('la pastille d’Epic de la carte a le focus : la carte passe dans Terminé, le focus va à son lien', async () => {
    const { queryClient } = await openBoard();
    const link = cardLink('bdesk-c1');
    const pill = within(link.closest('li')!).getByRole('link', { name: /Epic :/ });
    act(() => pill.focus());
    expect(document.activeElement).toBe(pill);

    serve(changed('bdesk-c1', closedNow()));
    await commitAndWaitForMove(queryClient, link, 'done');

    expect(document.activeElement).toBe(cardLink('bdesk-c1')); // le lien du titre : ce que « la carte sélectionnée » a pour focus
  });

  it('la carte reprend le focus sans faire défiler la page : le focus n’est pas l’attention de l’utilisateur, qui a pu défiler ailleurs', async () => {
    const { queryClient } = await openBoard();
    const link = cardLink('bdesk-c1');
    act(() => link.focus());
    const focus = vi.spyOn(HTMLElement.prototype, 'focus');
    try {
      serve(changed('bdesk-c1', closedNow()));
      await commitAndWaitForMove(queryClient, link, 'done');

      const calls = focus.mock.calls.filter((_, call) => focus.mock.contexts[call] === cardLink('bdesk-c1'));
      expect(calls).toEqual([[{ preventScroll: true }]]);
    } finally {
      focus.mockRestore();
    }
  });

  it('un commit qui ne déplace pas la carte (son titre change) : le focus n’a pas bougé, c’est le même lien', async () => {
    const { queryClient } = await openBoard();
    const link = cardLink('bdesk-c1');
    act(() => link.focus());

    serve(changed('bdesk-c1', { title: 'Barre latérale, version 2' }));
    await commit(queryClient);
    await screen.findByRole('link', { name: 'Barre latérale, version 2' });
    await settle();

    expect(link.isConnected).toBe(true);
    expect(document.activeElement).toBe(link);
  });

  it('une carte qui change de rang dans sa colonne garde le focus (React remet le focus à ce qu’il déplace) : la veille n’y touche pas', async () => {
    const { queryClient } = await openBoard();
    const link = cardLink('bdesk-c3');
    act(() => link.focus());

    serve(changed('bdesk-c3', { priority: 0 })); // P0 : elle passe devant les autres cartes d'En cours
    await commit(queryClient);
    await waitFor(() => expect(within(column('En cours')).getAllByRole('link')[0]?.textContent).toBe('Raccourcis clavier'));
    await settle();

    expect(document.activeElement).toBe(cardLink('bdesk-c3'));
  });

  it('le ticket est dans le tiroir « En pause », ouvert : la carte qui y arrive garde le focus', async () => {
    const { user, queryClient } = await openBoard();
    await user.click(screen.getByRole('button', { name: /^En pause/ }));
    const link = cardLink('bdesk-c1');
    act(() => link.focus());

    serve(changed('bdesk-c1', { status: 'deferred' }));
    await commit(queryClient);
    await waitFor(() => expect(link.isConnected).toBe(false));
    await settle();

    expect(within(screen.getByRole('region', { name: 'En pause' })).getByRole('link', { name: 'Barre latérale' })).toBe(cardLink('bdesk-c1'));
    expect(document.activeElement).toBe(cardLink('bdesk-c1'));
  });
});

describe('la carte qui a le focus n’est plus sur le tableau après un commit : la zone la plus proche', () => {
  it('le ticket part dans le tiroir « En pause », fermé : la carte n’est plus à l’écran, le contenu principal prend le focus', async () => {
    const { queryClient } = await openBoard();
    const link = cardLink('bdesk-c1');
    act(() => link.focus());

    serve(changed('bdesk-c1', { status: 'deferred' }));
    await commit(queryClient);
    await waitFor(() => expect(link.isConnected).toBe(false));
    await settle();

    expect(cardLink('bdesk-c1')).toBeNull();
    expect(document.activeElement).toBe(main());
    expect(main()?.hasAttribute('tabindex')).toBe(true); // le temps qu'il a le focus seulement (voir `focusContainer`)
  });

  it('le ticket est supprimé : de même, et la zone ne reste pas focalisable une fois le focus parti', async () => {
    const { user, queryClient } = await openBoard();
    const link = cardLink('bdesk-c2');
    act(() => link.focus());

    serve(TICKETS.filter((candidate) => candidate.id !== 'bdesk-c2'));
    await commit(queryClient);
    await waitFor(() => expect(link.isConnected).toBe(false));
    await settle();
    expect(document.activeElement).toBe(main());

    await user.tab();

    expect(document.activeElement).not.toBe(main());
    expect(main()?.hasAttribute('tabindex')).toBe(false);
  });

  it('ce qui part n’est pas une carte (le filtre Epic, retiré avec la dernière Epic) : le contenu principal prend le focus', async () => {
    const { queryClient } = await openBoard();
    const filter = screen.getByRole('combobox', { name: 'Epic' });
    act(() => filter.focus());
    expect(document.activeElement).toBe(filter);

    serve(TICKETS.filter((candidate) => candidate.id !== EPIC.id).map((candidate) => ({ ...candidate, parentId: null })));
    await commit(queryClient);
    await waitFor(() => expect(filter.isConnected).toBe(false));
    await settle();

    expect(document.activeElement).toBe(main());
  });
});

describe('le focus que l’utilisateur a mis ailleurs reste où il est quand une carte change de colonne', () => {
  it('une autre carte du tableau a le focus : une carte qui change de colonne ne le lui prend pas', async () => {
    const { queryClient } = await openBoard();
    const other = cardLink('bdesk-c2');
    act(() => other.focus());

    serve(changed('bdesk-c1', closedNow()));
    await commit(queryClient);
    await waitFor(() => expect(cardLink('bdesk-c1').closest('li')?.dataset.column).toBe('done'));
    await settle();

    expect(document.activeElement).toBe(other);
  });

  it('un lien de la barre latérale a le focus (l’utilisateur a quitté le tableau) : la carte qu’il avait quittée ne le lui prend pas', async () => {
    const { queryClient } = await openBoard();
    const link = cardLink('bdesk-c1');
    const sidebarLink = within(screen.getByRole('navigation', { name: 'Navigation principale' })).getByRole('link', { name: /^Métriques/ });
    act(() => link.focus());
    act(() => sidebarLink.focus());

    serve(changed('bdesk-c1', closedNow()));
    await commitAndWaitForMove(queryClient, link, 'done');

    expect(document.activeElement).toBe(sidebarLink);
  });

  it('l’utilisateur a cliqué dans le vide (le corps de la page a le focus) : la carte qui change de colonne ne le lui reprend pas', async () => {
    const { user, queryClient } = await openBoard();
    const link = cardLink('bdesk-c1');
    act(() => link.focus());
    await user.click(document.body);
    expect(document.activeElement).toBe(document.body);

    serve(changed('bdesk-c1', closedNow()));
    await commitAndWaitForMove(queryClient, link, 'done');

    expect(document.activeElement).toBe(document.body);
  });

  it('Échap a désélectionné la carte (le focus est parti) : elle ne le reprend pas en changeant de colonne', async () => {
    const { user, queryClient } = await openBoard();
    const link = cardLink('bdesk-c1');
    act(() => link.focus());
    await user.keyboard('{Escape}');
    expect(document.activeElement).toBe(document.body);

    serve(changed('bdesk-c1', closedNow()));
    await commitAndWaitForMove(queryClient, link, 'done');

    expect(document.activeElement).toBe(document.body);
  });

  it('rien n’avait le focus : une carte qui change de colonne n’en prend aucun', async () => {
    const { queryClient } = await openBoard();
    const link = cardLink('bdesk-c1');
    expect(document.activeElement).toBe(document.body);

    serve(changed('bdesk-c1', closedNow()));
    await commitAndWaitForMove(queryClient, link, 'done');

    expect(document.activeElement).toBe(document.body);
  });

  it('le panneau du ticket est ouvert et a le focus (c’est le ticket qui change de colonne : un cas de tous les jours) : la carte ne le lui prend pas', async () => {
    serve(TICKETS);
    const { queryClient } = renderApp('/p/bdesk/t/bdesk-c1');
    const dialog = await screen.findByRole('dialog', { name: /Barre latérale/ });
    await screen.findByRole('region', { name: 'Prêt' });
    expect(document.activeElement).toBe(dialog);
    const link = cardLink('bdesk-c1');

    serve(changed('bdesk-c1', closedNow()));
    await commitAndWaitForMove(queryClient, link, 'done');

    expect(document.activeElement).toBe(dialog);
  });
});

describe('une seule colonne est affichée (écran étroit) : la colonne d’arrivée est cachée', () => {
  withStyle('section[data-column]:not([data-shown="true"]) { display: none; }');

  it('la carte qui a le focus passe dans une colonne cachée : le focus passe à la zone la plus proche, la colonne affichée ne change pas', async () => {
    const { queryClient, router } = await openBoard('En cours');
    expect(document.querySelector('section[data-column][data-shown="true"]')?.getAttribute('data-column')).toBe('inProgress');
    const link = cardLink('bdesk-c1');
    act(() => link.focus());
    expect(document.activeElement).toBe(link);

    serve(changed('bdesk-c1', closedNow()));
    await commit(queryClient);
    await waitFor(() => expect(link.isConnected).toBe(false));
    await settle();

    expect(document.activeElement).toBe(main()); // ni le corps de la page, ni une colonne que l'utilisateur n'a pas choisie
    expect(document.querySelector('section[data-column][data-shown="true"]')?.getAttribute('data-column')).toBe('inProgress');
    expect(router.state.location.search).toBe(''); // seul un choix de l'utilisateur change la colonne affichée : le commit n'écrit pas `?col=`
    expect(cardLink('bdesk-c1').closest('li')?.dataset.column).toBe('done');
  });

  it('« j » repart de la colonne affichée : la sélection perdue n’est pas une sélection fantôme', async () => {
    const { user, queryClient } = await openBoard('En cours');
    const link = cardLink('bdesk-c1');
    act(() => link.focus());
    serve(changed('bdesk-c1', closedNow()));
    await commit(queryClient);
    await waitFor(() => expect(link.isConnected).toBe(false));
    await settle();

    await user.keyboard('j');

    expect(document.activeElement).toBe(cardLink('bdesk-c2')); // la première carte d'En cours, qui ne compte plus la carte partie
  });
});

describe('la veille du tableau ne vit que tant que le tableau est monté', () => {
  it('le tableau part (une autre page) avec une carte qui a le focus : rien ne le lui rend, il n’y a plus de tableau', async () => {
    const { router } = await openBoard();
    act(() => cardLink('bdesk-c1').focus());

    await act(() => router.navigate('/p/bdesk/epics'));
    await settle();

    expect(document.querySelector('[data-card-id]')).toBeNull();
    expect(document.activeElement).toBe(document.body); // comme partout ailleurs dans l'application : une navigation n'est pas un retrait que la veille corrige
  });

  it('démonté, le tableau coupe son observateur de mutations', async () => {
    const observed: MutationObserver[] = [];
    const disconnected: MutationObserver[] = [];
    const observe = vi.spyOn(MutationObserver.prototype, 'observe');
    const disconnect = vi.spyOn(MutationObserver.prototype, 'disconnect');
    try {
      const { unmount } = await openBoard();
      const board = document.querySelector('[data-card-id]')!.closest('.\\@container')!;
      observe.mock.calls.forEach(([target], call) => {
        if (target === board) observed.push(observe.mock.contexts[call] as MutationObserver);
      });
      expect(observed.length).toBeGreaterThan(0);

      unmount();

      disconnect.mock.contexts.forEach((observer) => disconnected.push(observer as MutationObserver));
      for (const observer of observed) expect(disconnected).toContain(observer);
    } finally {
      observe.mockRestore();
      disconnect.mockRestore();
    }
  });
});

/** Un tableau en miniature : la même carte (`li[data-card-id]` et son lien) dans la colonne `a` ou `b`, comme React la remonte quand le commit la change de colonne. */
function MiniBoard({ lane }: { lane: 'a' | 'b' }) {
  const ref = useRef<HTMLDivElement>(null);
  useKeepFocusInBoard(ref);
  const card = (
    <li data-card-id="x">
      <a data-card-link="x" href="#x">
        X
      </a>
    </li>
  );
  return (
    <main>
      <div ref={ref}>
        <ul>{lane === 'a' ? card : null}</ul>
        <ul>{lane === 'b' ? card : null}</ul>
      </div>
    </main>
  );
}

describe('en StrictMode (le développement monte les effets deux fois)', () => {
  it('la carte qui change de colonne garde le focus, et le tableau démonté ne laisse aucun observateur', async () => {
    const observe = vi.spyOn(MutationObserver.prototype, 'observe');
    const disconnect = vi.spyOn(MutationObserver.prototype, 'disconnect');
    try {
      const view = render(
        <StrictMode>
          <MiniBoard lane="a" />
        </StrictMode>,
      );
      /** Les observateurs qui veillent encore : posés, et pas coupés. */
      const watching = () => new Set(observe.mock.contexts.filter((observer) => !disconnect.mock.contexts.includes(observer)));
      expect(watching().size).toBe(1); // attache, détache, attache : une seule veille reste
      act(() => screen.getByRole('link', { name: 'X' }).focus());
      const link = screen.getByRole('link', { name: 'X' });

      view.rerender(
        <StrictMode>
          <MiniBoard lane="b" />
        </StrictMode>,
      );
      await settle();

      expect(link.isConnected).toBe(false);
      expect(document.activeElement).toBe(screen.getByRole('link', { name: 'X' }));
      view.unmount();
      expect(watching().size).toBe(0);
    } finally {
      observe.mockRestore();
      disconnect.mockRestore();
    }
  });
});
