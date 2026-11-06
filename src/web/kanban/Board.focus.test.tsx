import { type QueryClient } from '@tanstack/react-query';
import { act, render, screen, waitFor, within } from '@testing-library/react';
import { StrictMode, useRef } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { Issue } from '../data/types';
import { refreshProject } from '../live/refresh';
import { focusContainer } from '../lib/focus';
import { withAsyncTimeout } from '../test/asyncTimeout';
import { issue, projectsResponse } from '../test/fixtures';
import { renderApp, stubApi } from '../test/render';
import { focusCardOrZone, movedCardLink, openedFromCard, panelOpener, useKeepFocusInBoard } from './boardFocus';

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

describe('une carte porte son Projet : les identifiants de tickets ne sont uniques que dans un Projet', () => {
  it('chaque carte du tableau, dans une colonne comme dans le tiroir « En pause », porte l’identifiant du Projet affiché', async () => {
    serve([...TICKETS, issue({ id: 'bdesk-p1', title: 'Reporté', status: 'deferred' })]);
    const { user } = renderApp('/p/bdesk/kanban');
    await screen.findByRole('region', { name: 'Prêt' });
    await user.click(screen.getByRole('button', { name: /^En pause/ }));

    const cards = [...document.querySelectorAll<HTMLElement>('li[data-card-id]')];

    expect(cards.length).toBeGreaterThan(TICKETS.length - 2); // les cartes des colonnes, plus celle du tiroir
    expect(cards.map((card) => card.dataset.cardProject)).toEqual(cards.map(() => 'bdesk'));
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

/**
 * Retrouver la carte dont un élément a été retiré (bdesk-38k.68). Le panneau d'un ticket et la palette retiennent l'élément qui avait le focus à leur ouverture (le lien d'une carte) pour
 * le lui rendre à leur fermeture ; quand un commit a remonté la carte dans une autre colonne, c'est un lien retiré du document, et c'est la carte, par son identifiant, qui reçoit le focus.
 * Le DOM seul : une carte est un `li[data-card-id]` et son lien `a[data-card-link]`, que React remonte dans la nouvelle colonne en retirant l'ancien `li`.
 */
describe('movedCardLink et focusCardOrZone : la carte dont un élément a été retiré, là où elle est maintenant', () => {
  afterEach(() => {
    document.body.innerHTML = '';
  });

  /**
   * Un tableau de deux colonnes sous le contenu principal, avec la carte `x` du Projet `a` dans `#a` (son lien, et une pastille d'Epic) ; hors du contenu principal, une carte de même identifiant
   * et de même Projet (elle n'est pas dans le tableau). `move()` fait ce que fait un commit : l'ancien `li` est retiré, un nouveau est monté dans `#b`. Une carte porte son Projet
   * (`data-card-project`, voir `Card`) : les identifiants de tickets ne sont uniques que dans un Projet.
   */
  function mount() {
    document.body.innerHTML =
      '<aside><ul><li data-card-id="x" data-card-project="a"><p><a id="ailleurs" data-card-link="x" href="#ailleurs">Ailleurs</a></p></li></ul></aside>' +
      '<main><div id="tableau"><ul id="a"><li data-card-id="x" data-card-project="a"><p><a id="ancien" data-card-link="x" href="#x">X</a></p><div><a id="pastille" href="#epic">Epic</a></div></li></ul><ul id="b"></ul></div></main>';
    const $ = (selector: string) => document.querySelector<HTMLElement>(selector)!;
    const gone = { link: $('#ancien'), pill: $('#pastille') };
    const move = () => {
      $('#b').insertAdjacentHTML('beforeend', '<li data-card-id="x" data-card-project="a"><p><a id="nouveau" data-card-link="x" href="#x">X</a></p></li>');
      $('#a li').remove();
    };
    return { $, gone, move };
  }

  it('le lien de la carte est retiré, la carte est dans une autre colonne : son lien actuel', () => {
    const { $, gone, move } = mount();
    move();

    expect(gone.link.isConnected).toBe(false);
    expect(movedCardLink($('main'), gone.link)).toBe($('#nouveau'));
  });

  it('c’est la pastille d’Epic qui est retirée avec la carte : le lien de la carte, celui de son titre', () => {
    const { $, gone, move } = mount();
    move();

    expect(movedCardLink($('main'), gone.pill)).toBe($('#nouveau'));
  });

  it('l’élément est encore dans le document (la carte n’a pas bougé) : le lien de sa carte, qui est le sien', () => {
    const { $, gone } = mount();

    expect(movedCardLink($('main'), gone.pill)).toBe(gone.link);
    expect(movedCardLink($('main'), gone.link)).toBe(gone.link);
  });

  it('l’élément n’est pas dans une carte (le champ d’une palette, un bouton) ou il n’y a pas d’élément : aucune carte', () => {
    const { $ } = mount();
    const button = document.createElement('button');

    expect(movedCardLink($('main'), button)).toBeNull();
    expect(movedCardLink($('main'), null)).toBeNull();
    expect(movedCardLink($('main'), undefined)).toBeNull();
  });

  it('la carte n’est plus dans le tableau (le ticket est supprimé, ou dans le tiroir fermé) : aucune carte', () => {
    const { $, gone } = mount();
    $('#a li').remove();

    expect(movedCardLink($('main'), gone.link)).toBeNull();
  });

  it('un lien de même identifiant hors de `within` n’est pas la carte : on cherche dans le tableau, pas dans la page', () => {
    const { $, gone } = mount();
    $('#a li').remove();

    expect(movedCardLink($('main'), gone.link)).toBeNull();
    expect(movedCardLink(document.body, gone.link)).toBe($('#ailleurs')); // la page entière le trouverait : `within` est ce qui l'écarte
  });

  /*
   * Les identifiants de tickets ne sont uniques que dans un Projet : deux Projets, deux copies ou deux clones d'un même dépôt, ont les mêmes (même préfixe). Le panneau d'un ticket reste monté d'un Projet
   * à l'autre (un choix de la palette ouvre un ticket de l'autre Projet, sur la même route) : il retient le lien d'une carte du premier, et le tableau qui arrive est celui du second. Sa carte de même
   * identifiant n'est pas la carte d'où l'on venait : on ne la retrouve qu'avec son Projet.
   */
  it('une carte de même identifiant, d’un autre Projet, n’est pas la carte : aucune carte', () => {
    const { $, gone } = mount();
    $('#a li').remove();
    $('#b').insertAdjacentHTML('beforeend', '<li data-card-id="x" data-card-project="b"><p><a id="autre-projet" data-card-link="x" href="#x">X</a></p></li>');

    expect(gone.link.isConnected).toBe(false);
    expect(movedCardLink($('main'), gone.link)).toBeNull();
    expect(movedCardLink($('main'), gone.pill)).toBeNull();
  });

  it('les deux Projets ont une carte de même identifiant dans `within` : celle du Projet de l’élément retiré, quel que soit l’ordre du document', () => {
    const { $, gone } = mount();
    $('#a li').remove();
    $('#a').insertAdjacentHTML('beforeend', '<li data-card-id="x" data-card-project="b"><p><a id="autre-projet" data-card-link="x" href="#x">X</a></p></li>'); // la première du document
    $('#b').insertAdjacentHTML('beforeend', '<li data-card-id="x" data-card-project="a"><p><a id="nouveau" data-card-link="x" href="#x">X</a></p></li>');

    expect(movedCardLink($('main'), gone.link)).toBe($('#nouveau'));
    expect(movedCardLink($('main'), gone.pill)).toBe($('#nouveau'));
  });

  it('focusCardOrZone : la seule carte de cet identifiant est celle d’un autre Projet : le contenu principal, pas cette carte', () => {
    const { $, gone } = mount();
    $('#a li').remove();
    $('#b').insertAdjacentHTML('beforeend', '<li data-card-id="x" data-card-project="b"><p><a id="autre-projet" data-card-link="x" href="#x">X</a></p></li>');

    expect(focusCardOrZone($('main'), gone.link)).toBe(true);

    expect(document.activeElement).toBe($('main'));
  });

  it('focusCardOrZone : la carte, là où elle est maintenant, prend le focus ; le contenu principal comme `within`, le panneau ne connaît pas le tableau', () => {
    const { $, gone, move } = mount();
    move();

    expect(focusCardOrZone($('main'), gone.link)).toBe(true);

    expect(document.activeElement).toBe($('#nouveau'));
  });

  it('focusCardOrZone : la carte n’est plus à l’écran (colonne cachée, ticket supprimé) : le contenu principal, jamais le corps de la page', () => {
    const { $, gone, move } = mount();
    move();
    const hide = document.createElement('style');
    hide.textContent = '#b { display: none }'; // la colonne d'arrivée est cachée : le navigateur refuse le focus à son lien
    document.head.append(hide);
    try {
      expect(focusCardOrZone($('main'), gone.link)).toBe(true);

      expect(document.activeElement).toBe($('main'));
      $('#b').remove();
      document.body.focus();
      expect(focusCardOrZone($('main'), gone.link)).toBe(true);
      expect(document.activeElement).toBe($('main'));
    } finally {
      hide.remove();
    }
  });

  it('focusCardOrZone : ce qui part n’est pas une carte : le contenu principal, comme avant', () => {
    const { $ } = mount();

    expect(focusCardOrZone($('main'), document.createElement('button'))).toBe(true);
    expect(document.activeElement).toBe($('main'));
  });
});

/**
 * L'origine que le panneau d'un ticket retient à son ouverture (bdesk-38k.72). L'élément qui a le focus, le lien de la carte au clavier comme à la souris dans Chromium et Firefox ; mais WebKit ne donne pas le focus au lien qu'on
 * clique : le corps de la page l'a, ou le contenu principal quand il l'avait, et le lien de la carte, qui a écrit sa carte dans l'entrée d'historique qu'il ouvre (`openedFromCard`), est l'origine. Le DOM seul : le panneau
 * (`IssuePanel`) l'appelle avec l'état de l'adresse et le type de navigation du routeur, les tests de l'application jouent le reste (`IssuePanel.opener.test.tsx`).
 */
describe('panelOpener : l’origine que le panneau d’un ticket retient à son ouverture', () => {
  afterEach(() => {
    document.body.innerHTML = '';
  });

  /** Un lien hors du tableau, le contenu principal avec deux cartes (`x` et `y`) du Projet `a` dont la première a une pastille d'Epic, et une carte `x` du Projet `b`, dans l'autre colonne. */
  function mount() {
    document.body.innerHTML =
      '<nav><a id="barre" href="#barre">Métriques</a></nav>' +
      '<main><ul id="a"><li data-card-id="x" data-card-project="a"><p><a id="carte" data-card-link="x" href="#x">X</a></p><div><a id="pastille" href="#epic">Epic</a></div></li>' +
      '<li data-card-id="y" data-card-project="a"><p><a id="autre" data-card-link="y" href="#y">Y</a></p></li></ul><ul id="b"></ul></main>';
    const $ = (selector: string) => document.querySelector<HTMLElement>(selector)!;
    return { $, main: $('main') };
  }
  const fromX = openedFromCard('x', 'a');

  it('un lien a le focus (au clavier, ou à la souris dans Chromium et Firefox) : c’est lui, quelle que soit la carte que l’adresse dit', () => {
    const { $ } = mount();
    $('#autre').focus();

    expect(panelOpener(fromX, false)).toBe($('#autre'));
    expect(panelOpener(null, false)).toBe($('#autre'));
  });

  it('le lien de la carte a le focus : c’est lui, avec ou sans l’adresse de la carte', () => {
    const { $ } = mount();
    $('#carte').focus();

    expect(panelOpener(fromX, false)).toBe($('#carte'));
    expect(panelOpener(null, false)).toBe($('#carte'));
  });

  it('un élément de la carte qui n’est pas son lien a le focus (la pastille d’Epic) : c’est lui, la carte le retrouve', () => {
    const { $ } = mount();
    $('#pastille').focus();

    expect(panelOpener(fromX, false)).toBe($('#pastille'));
  });

  it('un lien hors du tableau a le focus (la barre latérale) : le clic sur la carte ne le lui aurait pas laissé, mais il n’est pas pris pour autant', () => {
    const { $ } = mount();
    $('#barre').focus();

    expect(panelOpener(fromX, false)).toBe($('#barre'));
  });

  it('le corps de la page a le focus (WebKit) et le lien d’une carte ouvre le panneau : le lien de cette carte', () => {
    const { $ } = mount();
    expect(document.activeElement).toBe(document.body);

    expect(panelOpener(fromX, false)).toBe($('#carte'));
    expect(panelOpener(openedFromCard('y', 'a'), false)).toBe($('#autre'));
  });

  it('le contenu principal a le focus, qui contient la carte (WebKit le lui laisse : son clic ne quitte qu’un élément qu’il ne focalise pas) : le lien de la carte', () => {
    const { $, main } = mount();
    focusContainer(main);
    expect(document.activeElement).toBe(main);

    expect(panelOpener(fromX, false)).toBe($('#carte'));
  });

  it('l’élément qui avait le focus a été retiré : le focus n’est nulle part, le lien de la carte', () => {
    const { $ } = mount();
    const gone = document.createElement('button');
    document.body.append(gone);
    gone.focus();
    gone.remove();

    expect(panelOpener(fromX, false)).toBe($('#carte'));
  });

  it('« Retour » ou « Avancer » rouvre le panneau (POP) : l’entrée a gardé la carte, mais ce n’est pas un clic sur elle, et l’origine est l’élément qui a le focus', () => {
    const { $ } = mount();

    expect(panelOpener(fromX, true)).toBe(document.body);
    $('#autre').focus();
    expect(panelOpener(fromX, true)).toBe($('#autre'));
  });

  it.each<readonly [string, unknown]>([
    ['aucun état (la palette, la pastille d’Epic, une ligne de la page Epics, l’adresse collée)', null],
    ['un état indéfini', undefined],
    ['un état vide', {}],
    ['un état d’un autre auteur', { from: 'ailleurs' }],
    ['du texte', 'x'],
    ['un nombre', 42],
    ['une carte nulle', { openedFromCard: null }],
    ['une carte sans Projet', { openedFromCard: { id: 'x' } }],
    ['une carte sans identifiant', { openedFromCard: { project: 'a' } }],
    ['un identifiant qui n’est pas du texte', { openedFromCard: { id: 1, project: 'a' } }],
    ['un Projet qui n’est pas du texte', { openedFromCard: { id: 'x', project: null } }],
  ])('%s : le corps de la page, l’origine de WebKit à l’ordinaire', (_kind, state) => {
    mount();

    expect(panelOpener(state, false)).toBe(document.body);
  });

  it('la carte n’est pas dans le document (le ticket est supprimé, ou dans le tiroir « En pause » fermé) : l’élément qui a le focus', () => {
    mount();

    expect(panelOpener(openedFromCard('z', 'a'), false)).toBe(document.body);
  });

  it('une carte de même identifiant d’un autre Projet n’est pas la carte : l’élément qui a le focus', () => {
    mount();

    expect(panelOpener(openedFromCard('x', 'b'), false)).toBe(document.body);
  });

  it('les deux Projets ont une carte de même identifiant : celle du Projet de la carte qui a ouvert le panneau, quel que soit l’ordre du document', () => {
    const { $ } = mount();
    $('#b').insertAdjacentHTML('beforeend', '<li data-card-id="x" data-card-project="b"><p><a id="clone" data-card-link="x" href="#x">X</a></p></li>');
    $('#a').insertAdjacentHTML('afterbegin', '<li data-card-id="x" data-card-project="c"><p><a id="avant" data-card-link="x" href="#x">X</a></p></li>'); // la première du document

    expect(panelOpener(openedFromCard('x', 'b'), false)).toBe($('#clone'));
    expect(panelOpener(openedFromCard('x', 'a'), false)).toBe($('#carte'));
    expect(panelOpener(openedFromCard('x', 'c'), false)).toBe($('#avant'));
  });

  /*
   * Le panneau resté ouvert : une autre carte, cliquée pendant qu'il l'est, remplace l'entrée d'historique sans le remonter. L'appel se refait avec l'origine déjà retenue (`previous`). La carte que l'état nomme la remplace aux
   * mêmes conditions qu'à l'ouverture ; sinon c'est `previous` qui reste, et non l'élément qui a le focus (le panneau lui-même, le plus souvent, qui l'a pris à l'ouverture du ticket).
   */
  it('une autre carte remplace l’entrée du panneau resté ouvert, le corps de la page a le focus : son lien prend la place de l’origine d’avant', () => {
    const { $ } = mount();

    expect(panelOpener(openedFromCard('y', 'a'), false, $('#carte'))).toBe($('#autre'));
  });

  it('une autre carte remplace l’entrée du panneau resté ouvert, le contenu principal a le focus : de même', () => {
    const { $, main } = mount();
    focusContainer(main);

    expect(panelOpener(openedFromCard('y', 'a'), false, $('#carte'))).toBe($('#autre'));
  });

  it('une autre carte remplace l’entrée du panneau resté ouvert, son lien a le focus (Chromium, Firefox, le clavier) : le même lien', () => {
    const { $ } = mount();
    $('#autre').focus();

    expect(panelOpener(openedFromCard('y', 'a'), false, $('#carte'))).toBe($('#autre'));
  });

  it('aucune carte n’est écrite (un lien du panneau, la palette) : l’origine d’avant reste, non l’élément qui a le focus', () => {
    const { $ } = mount();
    $('#barre').focus();

    expect(panelOpener(null, false, $('#carte'))).toBe($('#carte'));
    expect(panelOpener({}, false, $('#carte'))).toBe($('#carte'));
  });

  it('le navigateur rouvre une entrée qui nomme une autre carte (POP) : l’origine d’avant reste', () => {
    const { $ } = mount();

    expect(panelOpener(openedFromCard('y', 'a'), true, $('#carte'))).toBe($('#carte'));
  });

  it('un autre élément a le focus (un lien de la barre latérale) : l’origine d’avant reste, la carte ne le lui prend pas', () => {
    const { $ } = mount();
    $('#barre').focus();

    expect(panelOpener(openedFromCard('y', 'a'), false, $('#carte'))).toBe($('#carte'));
  });

  it('la carte nommée n’est plus dans le document, ou est d’un autre Projet : l’origine d’avant reste', () => {
    const { $ } = mount();

    expect(panelOpener(openedFromCard('z', 'a'), false, $('#carte'))).toBe($('#carte'));
    expect(panelOpener(openedFromCard('y', 'b'), false, $('#carte'))).toBe($('#carte'));
  });

  it('le panneau n’avait aucune origine (`null`) : sans carte écrite, il n’en a toujours pas ; avec une carte, c’est elle', () => {
    const { $ } = mount();

    expect(panelOpener(null, false, null)).toBeNull();
    expect(panelOpener(openedFromCard('y', 'a'), false, null)).toBe($('#autre'));
  });
});
