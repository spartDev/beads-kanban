import { act, fireEvent } from '@testing-library/react';
import { useRef, type ReactElement } from 'react';
import { createRoot } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { useSelectionInView } from './useSelectionInView';

interface Group {
  heading: string;
  rows: readonly string[];
}

/**
 * Une liste à la façon de cmdk 1.1.1 (`cmdk-list`, `cmdk-group`, `cmdk-group-heading`, `cmdk-item`, `data-value`, `aria-selected`), dont la
 * sélection est une prop : jsdom ne fait pas de mise en page, ces tests vérifient sur quel élément `scrollIntoView` est appelé, et avec quoi.
 */
function List({ groups, selected }: { groups: readonly Group[]; selected: string }) {
  const root = useRef<HTMLDivElement>(null);
  useSelectionInView(root);
  return (
    <div ref={root}>
      <div cmdk-list="">
        {groups.map(({ heading, rows }) => (
          <div key={heading} cmdk-group="">
            <div cmdk-group-heading="">{heading}</div>
            <div cmdk-group-items="">
              {rows.map((value) => (
                <div key={value} cmdk-item="" data-value={value} aria-selected={value === selected} />
              ))}
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}

const NAVIGATION: Group = { heading: 'Navigation', rows: ['a', 'b', 'c'] };
const PROJECTS: Group = { heading: 'Projets', rows: ['d', 'e'] };
const GROUPS: readonly Group[] = [NAVIGATION, PROJECTS];

/** Les éléments sur lesquels `scrollIntoView` a été appelé, dans l'ordre, avec ce qu'on lui a demandé. */
let scrolled: { target: Element; options: unknown }[] = [];
const names = () => scrolled.map(({ target }) => target.getAttribute('data-value') ?? `en-tête « ${target.textContent} »`);
const nearest = { block: 'nearest' };

beforeEach(() => {
  scrolled = [];
  vi.spyOn(Element.prototype, 'scrollIntoView').mockImplementation(function (this: Element, options?: boolean | ScrollIntoViewOptions) {
    scrolled.push({ target: this, options });
  });
});
afterEach(() => {
  vi.restoreAllMocks();
});

/** Monte `element` dans `act` ; `render` le remplace par un autre (même racine : les nœuds gardent leur identité), `unmount` le retire. */
async function mount(element: ReactElement) {
  const container = document.createElement('div');
  document.body.append(container);
  const root = createRoot(container);
  await act(async () => root.render(element));
  return {
    container,
    /** L'élément racine auquel le hook est branché (celui de `Command`, dans la palette). */
    root: container.firstElementChild!,
    row: (value: string) => container.querySelector<HTMLElement>(`[cmdk-item][data-value="${value}"]`)!,
    render: (next: ReactElement) => act(async () => root.render(next)),
    unmount: async () => {
      await act(async () => root.unmount());
      container.remove();
    },
  };
}

describe('useSelectionInView : la ligne qui devient sélectionnée est amenée dans la zone visible de la liste', () => {
  it('au plus près : la ligne est visée, sans la centrer ni l’aligner en haut', async () => {
    const view = await mount(<List groups={GROUPS} selected="a" />);
    scrolled = [];

    await view.render(<List groups={GROUPS} selected="b" />);

    expect(scrolled).toHaveLength(1);
    expect(scrolled[0]!.target).toBe(view.row('b'));
    expect(scrolled[0]!.options).toEqual(nearest);
    await view.unmount();
  });

  it('dans la tâche qui a changé la liste, avant l’image suivante : ni minuterie ni image d’animation', async () => {
    const view = await mount(<List groups={GROUPS} selected="a" />);
    scrolled = [];

    // La sélection change hors de React, d'un trait : le prochain point de contrôle des microtâches doit déjà avoir défilé.
    view.row('a').setAttribute('aria-selected', 'false');
    view.row('c').setAttribute('aria-selected', 'true');
    await Promise.resolve();

    expect(names()).toEqual(['c']);
    await view.unmount();
  });

  it('la première ligne d’un groupe : son en-tête est amené d’abord, comme le fait cmdk, puis la ligne', async () => {
    const view = await mount(<List groups={GROUPS} selected="c" />);
    scrolled = [];

    await view.render(<List groups={GROUPS} selected="d" />);

    expect(names()).toEqual(['en-tête « Projets »', 'd']);
    expect(scrolled.map(({ options }) => options)).toEqual([nearest, nearest]);
    await view.unmount();
  });

  it('une ligne qui n’est pas la première de son groupe : l’en-tête est laissé', async () => {
    const view = await mount(<List groups={GROUPS} selected="a" />);
    scrolled = [];

    await view.render(<List groups={GROUPS} selected="e" />);

    expect(names()).toEqual(['e']);
    await view.unmount();
  });

  it('une ligne montée déjà sélectionnée (un nouvel élément, aucun attribut qui change) est amenée aussi', async () => {
    const view = await mount(<List groups={GROUPS} selected="" />);
    scrolled = [];

    await view.render(<List groups={[{ heading: 'Epics', rows: ['x'] }, ...GROUPS]} selected="x" />);

    expect(names()).toEqual(['en-tête « Epics »', 'x']);
    await view.unmount();
  });

  it('plusieurs changements dans la même tâche : seule la ligne qui reste sélectionnée est amenée', async () => {
    const view = await mount(<List groups={GROUPS} selected="a" />);
    scrolled = [];

    view.row('a').setAttribute('aria-selected', 'false');
    view.row('b').setAttribute('aria-selected', 'true');
    view.row('b').setAttribute('aria-selected', 'false');
    view.row('c').setAttribute('aria-selected', 'true');
    await Promise.resolve();

    expect(names()).toEqual(['c']);
    await view.unmount();
  });
});

describe('useSelectionInView : un rafraîchissement retire la ligne sélectionnée', () => {
  // Décision de bdesk-38k.41 : le but est que la ligne sélectionnée soit toujours visible. Le hook défile donc quand la ligne sélectionnée change,
  // y compris quand la précédente a disparu, même si l'utilisateur avait fait défiler la liste ailleurs à la molette (il ne lit aucune position
  // de défilement). Il ne défile jamais quand des lignes arrivent ou partent autour d'une sélection qui ne change pas : c'est le second temps.
  const WITHOUT_E: readonly Group[] = [NAVIGATION, { heading: 'Projets', rows: ['d'] }];
  const REFRESHED: readonly Group[] = [
    { heading: 'Epics', rows: ['x', 'y'] },
    { heading: 'Navigation', rows: ['a', 'b'] },
    { heading: 'Projets', rows: ['d'] },
  ];

  it('la ligne sélectionnée retirée, une autre sélectionnée dans le même rendu : la nouvelle est amenée, puis plus rien tant qu’elle reste', async () => {
    const view = await mount(<List groups={GROUPS} selected="e" />);
    scrolled = [];

    await view.render(<List groups={WITHOUT_E} selected="a" />);

    expect(names()).toEqual(['en-tête « Navigation »', 'a']);
    scrolled = [];

    await view.render(<List groups={REFRESHED} selected="a" />); // un autre rafraîchissement : des lignes arrivent et partent, la sélection reste

    expect(names()).toEqual([]);
    await view.unmount();
  });

  it('la ligne sélectionnée retirée, la suivante choisie un rendu plus tard (cmdk choisit d’office après coup) : la nouvelle est amenée, puis plus rien', async () => {
    const view = await mount(<List groups={GROUPS} selected="e" />);
    scrolled = [];

    await view.render(<List groups={WITHOUT_E} selected="" />); // « e » est partie : aucune ligne n'est sélectionnée, rien à amener

    expect(names()).toEqual([]);

    await view.render(<List groups={WITHOUT_E} selected="a" />);

    expect(names()).toEqual(['en-tête « Navigation »', 'a']);
    scrolled = [];

    await view.render(<List groups={REFRESHED} selected="a" />);

    expect(names()).toEqual([]);
    await view.unmount();
  });
});

describe('useSelectionInView : rien ne défile tant que la ligne sélectionnée ne change pas', () => {
  it('des lignes arrivent et partent, la sélection reste : la liste n’est pas rejouée', async () => {
    const view = await mount(<List groups={GROUPS} selected="a" />);
    scrolled = [];

    await view.render(<List groups={[{ heading: 'Epics', rows: ['x', 'y'] }, ...GROUPS]} selected="a" />);
    await view.render(<List groups={[NAVIGATION]} selected="a" />);

    expect(names()).toEqual([]);
    await view.unmount();
  });

  it('aucune ligne sélectionnée : rien à amener', async () => {
    const view = await mount(<List groups={GROUPS} selected="a" />);
    scrolled = [];

    await view.render(<List groups={GROUPS} selected="" />);

    expect(names()).toEqual([]);
    await view.unmount();
  });
});

describe('useSelectionInView : le survol ne fait pas défiler, le clavier si', () => {
  it('la ligne que le pointeur survole, devenue sélectionnée, n’est pas amenée', async () => {
    const view = await mount(<List groups={GROUPS} selected="a" />);
    scrolled = [];

    fireEvent.pointerMove(view.row('c'));
    await view.render(<List groups={GROUPS} selected="c" />);

    expect(names()).toEqual([]);
    await view.unmount();
  });

  it('le pointeur passe d’une ligne à l’autre : c’est la dernière survolée qui n’est pas amenée', async () => {
    const view = await mount(<List groups={GROUPS} selected="a" />);
    scrolled = [];

    fireEvent.pointerMove(view.row('c'));
    fireEvent.pointerMove(view.row('e'));
    await view.render(<List groups={GROUPS} selected="e" />);

    expect(names()).toEqual([]);
    await view.unmount();
  });

  it('survoler une ligne ne retient pas la sélection d’une autre : celle-là est amenée', async () => {
    const view = await mount(<List groups={GROUPS} selected="a" />);
    scrolled = [];

    fireEvent.pointerMove(view.row('c'));
    await view.render(<List groups={GROUPS} selected="b" />);

    expect(names()).toEqual(['b']);
    await view.unmount();
  });

  it('une touche rend la main au clavier : la même ligne, choisie à la flèche après le survol, est amenée', async () => {
    const view = await mount(<List groups={GROUPS} selected="a" />);
    fireEvent.pointerMove(view.row('c'));
    await view.render(<List groups={GROUPS} selected="c" />);
    scrolled = [];

    fireEvent.keyDown(view.row('c'), { key: 'ArrowDown' });
    await view.render(<List groups={GROUPS} selected="d" />);
    await view.render(<List groups={GROUPS} selected="c" />);

    expect(names()).toEqual(['en-tête « Projets »', 'd', 'c']);
    await view.unmount();
  });

  it('le pointeur qui passe sur autre chose qu’une ligne n’en survole plus aucune : la ligne qu’il quitte, choisie ensuite, est amenée', async () => {
    const view = await mount(<List groups={GROUPS} selected="a" />);
    fireEvent.pointerMove(view.row('c'));
    await view.render(<List groups={GROUPS} selected="c" />);
    scrolled = [];

    fireEvent.pointerMove(view.container.querySelector('[cmdk-group-heading]')!);
    await view.render(<List groups={GROUPS} selected="b" />);
    await view.render(<List groups={GROUPS} selected="c" />);

    expect(names()).toEqual(['b', 'c']);
    await view.unmount();
  });

  it('le pointeur quitte la liste (ou la boîte de dialogue) : la ligne qu’il survolait, choisie ensuite sans touche, est amenée', async () => {
    const view = await mount(<List groups={GROUPS} selected="a" />);
    fireEvent.pointerMove(view.row('c'));
    await view.render(<List groups={GROUPS} selected="c" />);
    scrolled = [];

    fireEvent.pointerLeave(view.root);
    await view.render(<List groups={GROUPS} selected="b" />);
    await view.render(<List groups={GROUPS} selected="c" />);

    expect(names()).toEqual(['b', 'c']);
    await view.unmount();
  });
});

describe('useSelectionInView : la liste retirée, plus rien ne défile', () => {
  it('après le démontage, une sélection qui change dans le DOM resté en mémoire n’est plus suivie', async () => {
    const view = await mount(<List groups={GROUPS} selected="a" />);
    const previous = view.row('a');
    const kept = view.row('b');
    await view.unmount();
    scrolled = [];

    previous.setAttribute('aria-selected', 'false');
    kept.setAttribute('aria-selected', 'true');
    await Promise.resolve();

    expect(names()).toEqual([]);
  });
});
