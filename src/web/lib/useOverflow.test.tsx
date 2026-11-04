import { act, render, within } from '@testing-library/react';
import { useRef } from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { useOverflow } from './useOverflow';

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
