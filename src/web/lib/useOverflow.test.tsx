import { act, render, within } from '@testing-library/react';
import { StrictMode, useLayoutEffect, useRef } from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { withFocusFixup } from '../test/focusFixup';
import { useOverflow, useScrollFocusable } from './useOverflow';

function Box({ axis }: { axis: 'x' | 'y' }) {
  const ref = useRef<HTMLDivElement>(null);
  const overflows = useOverflow(ref, axis);
  return (
    <div ref={ref} data-testid="box" data-overflows={String(overflows)}>
      contenu
    </div>
  );
}

/** Un élément dont on fixe la taille mesurée, comme le ferait la mise en page d'un vrai navigateur (jsdom ne mesure rien). */
function measured(sizes: { scrollWidth?: number; clientWidth?: number; scrollHeight?: number; clientHeight?: number }) {
  for (const [name, value] of Object.entries(sizes)) {
    vi.spyOn(HTMLElement.prototype, name as 'scrollWidth', 'get').mockImplementation(() => value as number);
  }
}

afterEach(() => {
  vi.restoreAllMocks();
});

describe('useOverflow', () => {
  it('dit qu’un élément déborde en hauteur quand son contenu dépasse sa zone', () => {
    measured({ scrollHeight: 1200, clientHeight: 600 });
    const { getByTestId } = render(<Box axis="y" />);

    expect(getByTestId('box').dataset.overflows).toBe('true');
  });

  it('dit qu’un élément déborde en largeur de la même façon, et ne confond pas les deux axes', () => {
    measured({ scrollWidth: 900, clientWidth: 300, scrollHeight: 100, clientHeight: 100 });
    const horizontal = render(<Box axis="x" />);
    const vertical = render(<Box axis="y" />);

    expect(within(horizontal.container).getByTestId('box').dataset.overflows).toBe('true');
    expect(within(vertical.container).getByTestId('box').dataset.overflows).toBe('false');
  });

  it('ne dit rien d’un élément dont le contenu tient, à un pixel d’arrondi près', () => {
    measured({ scrollHeight: 601, clientHeight: 600 });

    expect(render(<Box axis="y" />).getByTestId('box').dataset.overflows).toBe('false');
  });

  it('relit la taille quand le contenu change', async () => {
    let scrollHeight = 100;
    vi.spyOn(HTMLElement.prototype, 'scrollHeight', 'get').mockImplementation(() => scrollHeight);
    vi.spyOn(HTMLElement.prototype, 'clientHeight', 'get').mockImplementation(() => 600);
    const { getByTestId } = render(<Box axis="y" />);
    expect(getByTestId('box').dataset.overflows).toBe('false');

    scrollHeight = 2000;
    await act(async () => {
      getByTestId('box').append('du texte en plus'); // le contenu grandit : MutationObserver
      await new Promise((resolve) => setTimeout(resolve, 0));
    });

    expect(getByTestId('box').dataset.overflows).toBe('true');
  });
});

function Zone() {
  const ref = useRef<HTMLDivElement>(null);
  const focusable = useScrollFocusable(ref, 'y');
  return (
    <>
      <div ref={ref} data-testid="zone" tabIndex={focusable ? 0 : undefined}>
        <a href="#dedans">Dedans</a> <span data-testid="texte">contenu</span>
      </div>
      <button type="button">Ailleurs</button>
    </>
  );
}

/** Une zone qui a le focus avant que le crochet ne veille (la mise en page lui donne avant les effets) : `data-focusable` dit ce que le crochet répond. */
function FocusedZone() {
  const ref = useRef<HTMLDivElement>(null);
  const focusable = useScrollFocusable(ref, 'y');
  useLayoutEffect(() => ref.current?.focus(), []);
  return (
    <div ref={ref} data-testid="zone" tabIndex={0} data-focusable={String(focusable)}>
      <span data-testid="texte">contenu</span>
    </div>
  );
}

/**
 * Une zone qui défile prend le focus pour qu'on la fasse défiler au clavier, et elle le garde tant qu'elle l'a (bdesk-38k.59) : lui retirer son `tabindex`
 * parce que son contenu a raccourci (un commit en direct, la fenêtre qu'on élargit) la ferait perdre le focus, qui tomberait sur le corps de la page.
 * `withFocusFixup` : jsdom retire le focus à un élément qui cesse d'être focalisable, comme les navigateurs.
 */
describe('useScrollFocusable : la zone qui défile prend le focus, et le garde tant qu’elle l’a', () => {
  withFocusFixup();

  /** Une zone et un bouton ailleurs ; sa hauteur de contenu se fixe à la main (jsdom ne mesure rien) : `resize` la change, et laisse l'observateur de mutations la relire. */
  function mountZone(contentHeight: number, strict = false) {
    let scrollHeight = contentHeight;
    vi.spyOn(HTMLElement.prototype, 'scrollHeight', 'get').mockImplementation(() => scrollHeight);
    vi.spyOn(HTMLElement.prototype, 'clientHeight', 'get').mockImplementation(() => 600);
    const view = render(strict ? <StrictMode><Zone /></StrictMode> : <Zone />);
    const resize = async (height: number) => {
      scrollHeight = height;
      await act(async () => {
        view.getByTestId('texte').append('.');
        await new Promise((resolve) => setTimeout(resolve, 0));
      });
    };
    return { ...view, zone: view.getByTestId('zone'), other: view.getByRole('button', { name: 'Ailleurs' }), link: view.getByRole('link', { name: 'Dedans' }), resize };
  }
  /** Laisse passer les micro-tâches (la vérification d'un `focusout`) et les minuteries de 0 ms. */
  const settle = () => act(() => new Promise<void>((resolve) => setTimeout(resolve, 0)));

  it('est focalisable tant que son contenu dépasse, et ne l’est pas quand il tient', () => {
    const tall = mountZone(2000);
    expect(tall.zone.getAttribute('tabindex')).toBe('0');
    tall.unmount();

    const short = mountZone(100);
    expect(short.zone.hasAttribute('tabindex')).toBe(false);
  });

  it('son contenu raccourcit et ne dépasse plus pendant qu’elle a le focus : elle le garde, le navigateur ne le lui retire pas', async () => {
    const { zone, resize } = mountZone(2000);
    act(() => zone.focus());
    expect(document.activeElement).toBe(zone);

    await resize(100);
    await settle();

    expect(document.activeElement).toBe(zone);
    expect(zone.getAttribute('tabindex')).toBe('0');
  });

  it('le focus la quitte (Tab, un clic ailleurs) alors qu’elle ne dépasse plus : elle n’est pas un arrêt de tabulation de plus', async () => {
    const { zone, other, resize } = mountZone(2000);
    act(() => zone.focus());
    await resize(100);

    act(() => other.focus());
    await settle();

    expect(zone.hasAttribute('tabindex')).toBe(false);
    expect(document.activeElement).toBe(other);
  });

  it('le focus la quitte pour le corps de la page (un clic dans le vide) : de même', async () => {
    const { zone, resize } = mountZone(2000);
    act(() => zone.focus());
    await resize(100);

    act(() => zone.blur());
    await settle();

    expect(zone.hasAttribute('tabindex')).toBe(false);
    expect(document.activeElement).toBe(document.body);
  });

  it('son contenu raccourcit puis grandit de nouveau pendant qu’elle a le focus : le focus la quitte ensuite, elle reste focalisable puisqu’elle défile', async () => {
    const { zone, other, resize } = mountZone(2000);
    act(() => zone.focus());
    await resize(100);
    await resize(2400);

    act(() => other.focus());
    await settle();

    expect(zone.getAttribute('tabindex')).toBe('0');
  });

  it('le focus est sur un élément qu’elle contient (un lien) : elle n’est pas focalisable pour autant quand son contenu tient', async () => {
    const { zone, link, resize } = mountZone(2000);
    act(() => link.focus());

    await resize(100);
    await settle();

    expect(zone.hasAttribute('tabindex')).toBe(false);
    expect(document.activeElement).toBe(link);
  });

  it('le focus passe de la zone au lien qu’elle contient, puis son contenu raccourcit : elle cesse d’être focalisable, le lien garde le focus', async () => {
    const { zone, link, resize } = mountZone(2000);
    act(() => zone.focus());
    act(() => link.focus());
    await settle();

    await resize(100);
    await settle();

    expect(zone.hasAttribute('tabindex')).toBe(false);
    expect(document.activeElement).toBe(link);
  });

  it('la fenêtre passe au second plan (`focusout` sans que l’élément actif du document change), puis le contenu raccourcit : elle garde le focus', async () => {
    const { zone, resize } = mountZone(2000);
    act(() => zone.focus());
    act(() => void zone.dispatchEvent(new FocusEvent('focusout', { bubbles: true })));
    await settle();
    expect(document.activeElement).toBe(zone);

    await resize(100);
    await settle();

    expect(document.activeElement).toBe(zone);
    expect(zone.getAttribute('tabindex')).toBe('0');
  });

  it('la fenêtre revient au premier plan, le focus quitte la zone ensuite : elle cesse d’être focalisable', async () => {
    const { zone, other, resize } = mountZone(2000);
    act(() => zone.focus());
    act(() => void zone.dispatchEvent(new FocusEvent('focusout', { bubbles: true })));
    await resize(100);
    act(() => void zone.dispatchEvent(new FocusEvent('focusin', { bubbles: true })));

    act(() => other.focus());
    await settle();

    expect(zone.hasAttribute('tabindex')).toBe(false);
  });

  it('elle avait déjà le focus quand le crochet a commencé à veiller (aucun `focusin` à attendre) : elle le garde quand le contenu raccourcit', async () => {
    let scrollHeight = 2000;
    vi.spyOn(HTMLElement.prototype, 'scrollHeight', 'get').mockImplementation(() => scrollHeight);
    vi.spyOn(HTMLElement.prototype, 'clientHeight', 'get').mockImplementation(() => 600);
    const { getByTestId } = render(<FocusedZone />);
    expect(document.activeElement).toBe(getByTestId('zone'));

    scrollHeight = 100;
    await act(async () => {
      getByTestId('texte').append('.');
      await new Promise((resolve) => setTimeout(resolve, 0));
    });

    expect(getByTestId('zone').dataset.focusable).toBe('true');
  });

  it('en StrictMode (le développement monte les effets deux fois), la zone garde le focus et ne laisse aucun écouteur en partant', async () => {
    const add = vi.spyOn(EventTarget.prototype, 'addEventListener');
    const remove = vi.spyOn(EventTarget.prototype, 'removeEventListener');
    const { zone, resize, unmount } = mountZone(2000, true);
    const onZone = (spy: typeof add) => spy.mock.calls.flatMap(([type, listener], call) => (spy.mock.contexts[call] === zone ? [[type, listener] as const] : []));
    act(() => zone.focus());

    await resize(100);
    await settle();

    expect(document.activeElement).toBe(zone);
    expect(zone.getAttribute('tabindex')).toBe('0');
    unmount();
    expect(onZone(remove)).toHaveLength(onZone(add).length);
    expect(onZone(remove)).toEqual(expect.arrayContaining(onZone(add)));
  });

  it('démontée, elle retire les écouteurs qu’elle a posés sur la zone', () => {
    const add = vi.spyOn(EventTarget.prototype, 'addEventListener');
    const remove = vi.spyOn(EventTarget.prototype, 'removeEventListener');
    const { zone, unmount } = mountZone(2000);
    const onZone = (spy: typeof add) => spy.mock.calls.flatMap(([type, listener], call) => (spy.mock.contexts[call] === zone ? [[type, listener] as const] : []));
    const added = onZone(add);
    expect(added.length).toBeGreaterThan(0);

    unmount();

    expect(onZone(remove)).toHaveLength(added.length);
    expect(onZone(remove)).toEqual(expect.arrayContaining(added));
  });
});
