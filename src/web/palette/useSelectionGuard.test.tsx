import { act } from '@testing-library/react';
import { useRef, useState, type ReactElement } from 'react';
import { createRoot } from 'react-dom/client';
import { describe, expect, it } from 'vitest';
import { useSelectionGuard } from './useSelectionGuard';

interface Row {
  value: string;
  disabled?: boolean;
}

/** Une liste à la façon de cmdk 1.1.1 (`cmdk-list`, `cmdk-item`, `data-value`, `aria-selected`, `aria-disabled`), dont la sélection est un état que la garde corrige. */
function List({ initial, rows, quiet = false }: { initial: string; rows: readonly Row[]; quiet?: boolean }) {
  const root = useRef<HTMLDivElement>(null);
  const [selected, setSelected] = useState(initial);
  useSelectionGuard({ root, selected, quiet, select: setSelected });
  return (
    <div ref={root}>
      <div cmdk-list="">
        {rows.map(({ value, disabled }) => (
          <div key={value} cmdk-item="" data-value={value} aria-selected={value === selected} aria-disabled={disabled ?? false} />
        ))}
      </div>
    </div>
  );
}

const selectedValues = (container: Element) =>
  [...container.querySelectorAll('[cmdk-item][aria-selected="true"]')].map((row) => row.getAttribute('data-value'));

/** Monte `element` dans `act` (tout est rendu quand l'appel rend la main) ; `unmount` le retire. */
async function mount(element: ReactElement) {
  const container = document.createElement('div');
  document.body.append(container);
  const root = createRoot(container);
  await act(async () => root.render(element));
  return {
    container,
    unmount: async () => {
      await act(async () => root.unmount());
      container.remove();
    },
  };
}

describe('useSelectionGuard : une ligne est sélectionnée dès qu’il y en a une à sélectionner, et la sélection désigne une ligne présente', () => {
  it.each<[string, string, readonly Row[], boolean, string[]]>([
    ['une sélection qui désigne une ligne présente est laissée telle quelle', 'b', [{ value: 'a' }, { value: 'b' }], false, ['b']],
    ['une sélection qui ne désigne plus aucune ligne est remplacée par la première ligne', 'partie', [{ value: 'a' }, { value: 'b' }], false, ['a']],
    ['aucune sélection, des lignes : la première est sélectionnée', '', [{ value: 'a' }, { value: 'b' }], false, ['a']],
    ['aucune sélection, aucune ligne : rien à sélectionner', '', [], false, []],
    ['une sélection périmée, aucune ligne : elle est vidée', 'partie', [], false, []],
    ['la première ligne est désactivée : la première ligne activable est prise', '', [{ value: 'x', disabled: true }, { value: 'b' }], false, ['b']],
    ['la ligne seule, tenue en retrait, n’est pas choisie d’office', '', [{ value: 'a' }], true, []],
    ['une sélection périmée, la ligne seule tenue en retrait : elle est vidée, la ligne n’est pas choisie', 'partie', [{ value: 'a' }], true, []],
  ])('%s', async (_title, initial, rows, quiet, expected) => {
    const { container, unmount } = await mount(<List initial={initial} rows={rows} quiet={quiet} />);

    expect(selectedValues(container)).toEqual(expected);

    await unmount();
  });

  it('corrige avant l’affichage : le premier point de contrôle qui suit le rendu voit déjà la ligne sélectionnée', async () => {
    // Hors d'`act`, React rend un premier rendu dans sa propre tâche et ne vide ses effets passifs qu'après, comme dans un navigateur, où une
    // image peut s'afficher entre les deux. La garde est un effet de mise en page : sa correction part en priorité synchrone et est rendue
    // dans la même tâche. En effet passif, elle le serait plus tard, et l'image montrerait des lignes sans qu'aucune soit sélectionnée.
    const container = document.createElement('div');
    document.body.append(container);
    const root = createRoot(container);
    const seen: (string | null)[][] = [];
    const watcher = new MutationObserver(() => seen.push(selectedValues(container)));
    watcher.observe(container, { subtree: true, childList: true, attributes: true });
    const react = globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean };
    const before = react.IS_REACT_ACT_ENVIRONMENT;
    react.IS_REACT_ACT_ENVIRONMENT = false;
    try {
      root.render(<List initial="partie" rows={[{ value: 'a' }, { value: 'b' }]} />);
      for (let task = 0; task < 4; task++) await new Promise<void>((resolve) => setImmediate(resolve));
    } finally {
      react.IS_REACT_ACT_ENVIRONMENT = before;
      watcher.disconnect();
    }

    expect(seen[0]).toEqual(['a']);
    expect(selectedValues(container)).toEqual(['a']);
    await act(async () => root.unmount());
    container.remove();
  });
});
