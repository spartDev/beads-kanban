import { act, render } from '@testing-library/react';
import { createMemoryRouter, RouterProvider, useLocation } from 'react-router';
import { describe, expect, it } from 'vitest';
import { HistoryTrail, type PanelSession, panelSession, useVisits, type Visits } from './HistoryTrail';

/** Monte `HistoryTrail` sur un routeur en mémoire et donne la séquence de panneaux de l'entrée courante. */
function trail(initialEntries: string[]) {
  const seen: { visits: Visits | null; key: string } = { visits: null, key: '' };
  function Probe() {
    seen.visits = useVisits();
    seen.key = useLocation().key;
    return null;
  }
  // Le routeur porte `HistoryTrail` comme l'application : au-dessus de ses pages.
  const wrapped = createMemoryRouter([{ path: '*', element: <HistoryTrail><Probe /></HistoryTrail> }], { initialEntries });
  render(<RouterProvider router={wrapped} />);
  const session = (): PanelSession => panelSession(seen.visits, seen.key);
  const go = (to: string, replace = false) => act(() => wrapped.navigate(to, { replace }));
  const move = (delta: number) => act(() => wrapped.navigate(delta));
  return { session, go, move };
}

describe('HistoryTrail et panelSession : la séquence de panneaux de l’entrée courante', () => {
  it('ne sait rien de ce qu’il y a derrière un panneau ouvert par une adresse collée ou un rechargement', async () => {
    const { session } = trail(['/p/x/t/a']);

    expect(session()).toEqual({ depth: 1, origin: null });
  });

  it('n’a pas de séquence sur une page qui n’est pas un panneau', async () => {
    const { session, go } = trail(['/p/x/kanban']);
    expect(session()).toEqual({ depth: 0, origin: null });

    await go('/p/x/metrics');

    expect(session()).toEqual({ depth: 0, origin: null });
  });

  it('retient la page d’où le panneau a été ouvert par un lien, et compte chaque panneau empilé depuis elle', async () => {
    const { session, go } = trail(['/p/x/kanban']);

    await go('/p/x/t/a');
    expect(session()).toEqual({ depth: 1, origin: '/p/x/kanban' });
    await go('/p/x/t/b');
    expect(session()).toEqual({ depth: 2, origin: '/p/x/kanban' });
    await go('/p/x/t/c');
    expect(session()).toEqual({ depth: 3, origin: '/p/x/kanban' });
  });

  it('une entrée qui en remplace une garde sa précédente : le remplacement n’empile rien', async () => {
    const { session, go } = trail(['/p/x/metrics']);
    await go('/p/x/t/a');

    await go('/p/x/t/b', true);
    await go('/p/x/t/c', true);

    expect(session()).toEqual({ depth: 1, origin: '/p/x/metrics' });
  });

  it('retrouve ce qu’elle savait d’une entrée en revenant ou en avançant dans l’historique', async () => {
    const { session, go, move } = trail(['/p/x/kanban']);
    await go('/p/x/t/a');
    await go('/p/x/t/b');

    await move(-1);
    expect(session()).toEqual({ depth: 1, origin: '/p/x/kanban' });
    await move(-1);
    expect(session()).toEqual({ depth: 0, origin: null }); // le tableau
    await move(2);
    expect(session()).toEqual({ depth: 2, origin: '/p/x/kanban' });
  });

  it('ne distingue pas les Projets : des panneaux de Projets différents se suivent dans une même séquence, depuis la page d’avant le premier', async () => {
    const { session, go } = trail(['/']);
    await go('/p/x/t/a');

    await go('/p/y/t/b');

    expect(session()).toEqual({ depth: 2, origin: '/' });
  });

  it('oublie les plus anciennes entrées au-delà de 500 : une origine oubliée est inconnue, jamais fausse', async () => {
    const { session, go, move } = trail(['/p/x/kanban']);
    await go('/p/x/t/a');
    for (let page = 0; page < 497; page++) await go(`/p/x/metrics?page=${page}`); // 499 entrées vues : toutes retenues
    await move(-497);
    expect(session()).toEqual({ depth: 1, origin: '/p/x/kanban' });

    await go('/p/x/epics?page=1');
    await go('/p/x/epics?page=2'); // 501 : la plus ancienne, le tableau, est oubliée
    await move(-2);

    expect(session()).toEqual({ depth: 1, origin: null }); // le panneau est connu, pas la page d'où il vient
  });
});
