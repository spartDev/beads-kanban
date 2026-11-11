import { render, screen } from '@testing-library/react';
import { useLayoutEffect } from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { installFakeResizeObserver } from '../test/resizeObserver';
import { useKeptPlace } from './useKeptPlace';

/**
 * bdesk-38k.81 (1) : le squelette qui remplace les chiffres d'un autre fuseau garde leur hauteur, et les chiffres qui reviennent ne laissent pas l'ancrage du défilement suivre leur première mise en
 * page. Ce crochet en est la mesure : il retient la hauteur de ce qu'il observe tant que cela est à l'écran, la rend dès le rendu qui le remplace, et dit quand ce qui revient n'a pas encore été
 * mesuré. Dans jsdom, rien n'a de taille : le test dit au crochet quelle taille le navigateur lui aurait donnée.
 */

afterEach(() => {
  vi.unstubAllGlobals();
});

interface Render {
  holding: boolean;
  height: number | undefined;
  settling: boolean;
}

/** Ce que le test peut faire arriver pendant l'affichage des chiffres : le navigateur les mesure aussitôt, avant les effets différés de cet affichage. */
interface Hooks {
  onFiguresCommit?: (figures: Element) => void;
}

/** Les chiffres sont à l'écran (`holding` faux), puis ce qui les remplace (`holding` vrai) ; chaque affichage (un rendu que React a gardé) dit ce que le crochet a rendu dans `renders`. */
function Harness({ holding, scope, renders, hooks }: { holding: boolean; scope: string; renders: Render[]; hooks: Hooks }) {
  const { ref, height, settling } = useKeptPlace<HTMLDivElement>(holding, scope);
  useLayoutEffect(() => {
    renders.push({ holding, height, settling });
  });
  useLayoutEffect(() => {
    if (!holding) hooks.onFiguresCommit?.(screen.getByTestId('figures'));
  });
  return holding ? <div data-testid="skeleton" data-kept={height ?? 'rien'} /> : <div ref={ref} data-testid="figures" data-settling={settling ? 'oui' : 'non'} />;
}

function setup(first: { holding?: boolean; scope?: string } = {}) {
  const resize = installFakeResizeObserver();
  const renders: Render[] = [];
  const hooks: Hooks = {};
  const scope = first.scope ?? 'bdesk';
  const view = render(<Harness holding={first.holding ?? false} scope={scope} renders={renders} hooks={hooks} />);
  return {
    resize,
    renders,
    hooks,
    show: (next: { holding: boolean; scope?: string }) => view.rerender(<Harness holding={next.holding} scope={next.scope ?? scope} renders={renders} hooks={hooks} />),
    figures: () => screen.getByTestId('figures'),
    kept: () => screen.getByTestId('skeleton').getAttribute('data-kept'),
    settling: () => screen.getByTestId('figures').getAttribute('data-settling'),
  };
}

describe('useKeptPlace : la hauteur gardée', () => {
  it('rend la dernière hauteur mesurée dès que ce qu’il observe est remplacé, dès le premier rendu de ce qui le remplace', () => {
    const { resize, show, figures, kept, renders } = setup();
    resize.emit(figures(), 3100);
    resize.emit(figures(), 4090); // les chiffres ont grandi (un tableau ouvert) : c'est la dernière qui compte

    show({ holding: true });

    expect(kept()).toBe('4090');
    expect(renders).toHaveLength(2); // l'ouverture, puis le squelette : aucun affichage de plus pour poser la hauteur
    expect(renders.at(-1)).toMatchObject({ holding: true, height: 4090 }); // dès le premier affichage du squelette, pas à un suivant : la page n'a pas le temps de rétrécir
  });

  it('ne rend la hauteur qu’à ce qui remplace les chiffres, jamais à eux : tant qu’ils sont à l’écran, rien à garder', () => {
    const { resize, show, figures, renders } = setup();
    resize.emit(figures(), 4090);

    show({ holding: false });

    expect(renders.every((one) => one.height === undefined)).toBe(true);
  });

  it('ne rend rien quand ce qu’il remplace n’a jamais été mesuré : le squelette de l’ouverture est celui de toujours', () => {
    const { show, kept } = setup({ holding: true });
    expect(kept()).toBe('rien');

    show({ holding: true });

    expect(kept()).toBe('rien');
  });

  it('ne rend pas une hauteur nulle : une mesure sans mise en page ne réserve rien', () => {
    const { resize, show, figures, kept } = setup();
    resize.emit(figures(), 0);

    show({ holding: true });

    expect(kept()).toBe('rien');
  });

  it('garde la hauteur tant que dure l’attente, d’un rendu à l’autre', () => {
    const { resize, show, figures, kept } = setup();
    resize.emit(figures(), 4090);
    show({ holding: true });

    show({ holding: true });
    show({ holding: true });

    expect(kept()).toBe('4090');
  });

  it('ne rend pas la hauteur d’un autre périmètre : celle des chiffres d’un Projet ne vaut pas pour ceux d’un autre', () => {
    const { resize, show, figures, kept } = setup({ scope: 'bdesk' });
    resize.emit(figures(), 4090);

    show({ holding: true, scope: 'mpm' });

    expect(kept()).toBe('rien');
  });

  it('l’oublie quand l’attente cesse : le squelette d’une attente suivante n’hérite pas d’une hauteur ancienne', () => {
    const { resize, show, figures, kept } = setup();
    resize.emit(figures(), 4090);
    show({ holding: true });
    expect(kept()).toBe('4090');

    show({ holding: false }); // les chiffres reviennent (un nouveau nœud, que le navigateur n'a pas encore mesuré)…
    show({ holding: true }); // … et une autre attente commence : rien n'a été mesuré depuis

    expect(kept()).toBe('rien');
  });

  it('mesure de nouveau ce qui revient : l’attente suivante garde la hauteur des chiffres qui sont revenus', () => {
    const { resize, show, figures, kept } = setup();
    resize.emit(figures(), 4090);
    show({ holding: true });
    show({ holding: false });
    resize.emit(figures(), 2500); // les chiffres du nouveau fuseau sont moins hauts

    show({ holding: true });

    expect(kept()).toBe('2500');
  });

  it('garde ce que le navigateur mesure des chiffres qui reviennent, même mesuré avant les effets différés de l’affichage qui les ramène', () => {
    const { resize, show, figures, hooks, kept } = setup();
    resize.emit(figures(), 4090);
    show({ holding: true });
    hooks.onFiguresCommit = (node) => {
      hooks.onFiguresCommit = undefined; // une seule fois : à l'affichage qui ramène les chiffres, pas aux rendus que cette mesure provoque ensuite
      resize.notify(node, 2500); // les chiffres sont mesurés dès qu'ils sont affichés : avant les effets différés, que l'oubli de l'attente ne doit pas devancer
    };

    show({ holding: false });
    show({ holding: true });

    expect(kept()).toBe('2500');
  });

  it('cesse d’observer ce qui part avec les chiffres', () => {
    const { resize, show } = setup();
    expect(resize.observed()).toHaveLength(1);

    show({ holding: true });

    expect(resize.observed()).toHaveLength(0);
  });

  it('mesure sous le périmètre du moment : une hauteur mesurée pour un Projet ne sert pas à celui qui lui succède, même si le nœud reste', () => {
    const { resize, show, figures, kept } = setup({ scope: 'bdesk' });
    resize.emit(figures(), 4090);
    show({ holding: false, scope: 'mpm' }); // les chiffres d'un autre Projet sont déjà là (le cache) : même nœud, autre périmètre
    resize.emit(figures(), 1800);

    show({ holding: true, scope: 'mpm' });

    expect(kept()).toBe('1800');
  });
});

describe('useKeptPlace : les chiffres qui arrivent', () => {
  it('les dit en train de se régler dès leur premier rendu, après une attente : le navigateur ne les a pas encore mesurés', () => {
    const { show, renders, settling } = setup({ holding: true });

    show({ holding: false });

    expect(settling()).toBe('oui');
    expect(renders.at(-1)).toMatchObject({ holding: false, settling: true }); // dès le premier affichage des chiffres, pas à un suivant : le navigateur ne les voit jamais sans cela
  });

  it('ne les dit plus en train de se régler une fois que le navigateur les a mesurés', () => {
    const { resize, show, figures, settling } = setup({ holding: true });
    show({ holding: false });
    expect(settling()).toBe('oui');

    resize.emit(figures(), 4090);

    expect(settling()).toBe('non');
  });

  it('ne dit rien de chiffres qui n’ont pas suivi une attente : des chiffres déjà là (le cache), ou le même nœud qui change de périmètre', () => {
    const { resize, show, figures, settling } = setup({ holding: false });
    expect(settling()).toBe('non');
    resize.emit(figures(), 4090);

    show({ holding: false, scope: 'mpm' });

    expect(settling()).toBe('non');
  });

  it('ne dit plus rien à régler dès qu’une attente commence : le squelette n’est pas en train de se régler', () => {
    const { show, renders, settling } = setup({ holding: true });
    show({ holding: false });
    expect(settling()).toBe('oui');

    show({ holding: true });

    expect(renders.at(-1)).toMatchObject({ holding: true, settling: false });
  });

  it('ne les dit plus en train de se régler quand une autre attente commence avant qu’ils aient été mesurés', () => {
    const { resize, show, figures, settling } = setup({ holding: true });
    show({ holding: false });
    expect(settling()).toBe('oui');
    show({ holding: true });
    show({ holding: false }); // de nouveaux chiffres, qui se règlent à leur tour : un autre nœud, un autre observateur
    expect(settling()).toBe('oui');

    resize.emit(figures(), 3000);

    expect(settling()).toBe('non');
  });
});
