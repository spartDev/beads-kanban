import { fireEvent, render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { CycleTimePanel, type CycleTimePanelProps } from './CycleTimeChart';
import type { SeriesContext } from './series';
import { emptyMetricsFixture, metricsFixture, plain, stubChartWidth } from './testing';

beforeEach(() => stubChartWidth(640));
afterEach(() => vi.restoreAllMocks());

const ctx: SeriesContext = {
  projectName: (id) => ({ bdesk: 'beads-desktop', mpm: 'My-Prompt-Manager' })[id] ?? id,
  projectHue: (id) => (id === 'bdesk' ? 200 : 40),
};

function props(overrides: Partial<CycleTimePanelProps> = {}): CycleTimePanelProps {
  const data = metricsFixture();
  return {
    points: data.cycleTimeScatter,
    span: { from: data.period.from, days: data.period.days, start: Date.parse(data.period.start), end: Date.parse(data.asOf) },
    dimension: 'type',
    ctx,
    projectOrder: ['bdesk', 'mpm'],
    timeZone: data.timeZone,
    median: data.tiles.cycleTime.median,
    p85: data.tiles.cycleTime.p85,
    showProject: true,
    ...overrides,
  };
}

const renderPanel = (overrides: Partial<CycleTimePanelProps> = {}) =>
  render(
    <MemoryRouter>
      <CycleTimePanel {...props(overrides)} />
    </MemoryRouter>,
  );

const dots = (container: HTMLElement) => [...container.querySelectorAll<SVGCircleElement>('[data-dot]')];
const hitArea = (container: HTMLElement) => container.querySelector<SVGRectElement>('[data-chart-hit]')!;

describe('CycleTimePanel : le nuage de points du Cycle Time', () => {
  it('dessine un point par Livraison, et nomme le dessin', () => {
    const { container } = renderPanel();

    expect(dots(container)).toHaveLength(5);
    expect(screen.getByRole('img', { name: 'Nuage de points du Cycle Time : 5 Livraisons, médiane 2,1 jours, P85 2,3 jours, échelle logarithmique.' })).toBeTruthy();
  });

  it('colore les points du découpage choisi : le code couleur des types', () => {
    const { container } = renderPanel({ dimension: 'type' });

    // bdesk-a1 est un bug, mpm-b2 une tâche.
    expect(dots(container).map((dot) => dot.getAttribute('fill'))).toEqual([
      'var(--type-bug)',
      'var(--type-task)',
      'var(--type-feature)',
      'var(--type-chore)',
      'var(--type-bug)',
    ]);
    expect(dots(container)[0]?.getAttribute('stroke')).toBe('color-mix(in oklab, var(--type-bug) 60%, var(--ink))');
  });

  it('colore les points par priorité, ou par Projet', () => {
    const byPriority = renderPanel({ dimension: 'priority' });
    expect(dots(byPriority.container).map((dot) => dot.getAttribute('fill'))).toEqual([
      'var(--prio-1)',
      'var(--prio-2)',
      'var(--prio-2)',
      'var(--prio-3)',
      'var(--prio-0)',
    ]);
    byPriority.unmount();

    const byProject = renderPanel({ dimension: 'project' });
    expect(dots(byProject.container)[0]?.getAttribute('fill')).toBe('oklch(var(--series-l) var(--series-c) 200)');
    expect(dots(byProject.container)[1]?.getAttribute('fill')).toBe('oklch(var(--series-l) var(--series-c) 40)');
  });

  it('range la légende des couleurs dans l’ordre du code couleur, sans doublon', () => {
    renderPanel({ dimension: 'type' });

    const legend = screen.getByRole('list', { name: 'Couleurs : type' });
    expect(within(legend).getAllByRole('listitem').map((item) => item.textContent)).toEqual(['Bug', 'Fonctionnalité', 'Tâche', 'Maintenance']);
  });

  it('trace la médiane et le P85 et les nomme sur le dessin : l’étiquette est posée contre sa ligne', () => {
    renderPanel();

    const chart = screen.getByRole('img', { name: /Nuage de points/ });
    const labels = [...chart.querySelectorAll('text')].map((text) => plain(text.textContent));
    expect(labels).toContain('Médiane 2,1 j');
    expect(labels).toContain('P85 2,3 j');
    expect(chart.querySelectorAll('line[stroke-dasharray]')).toHaveLength(2);
  });

  it('dessine les étiquettes « Médiane » et « P85 » après les points : dans un SVG, ce qui vient plus tard recouvre ce qui vient avant', () => {
    renderPanel();

    // Avant, les points étaient dessinés par-dessus les étiquettes et en masquaient des lettres (« Médiane 7 h 0▮ »).
    const chart = screen.getByRole('img', { name: /Nuage de points/ });
    const drawn = [...chart.querySelectorAll('circle[data-dot], text')];
    const lastDot = drawn.findLastIndex((node) => node.matches('circle'));
    const labelAt = (prefix: string) => drawn.findIndex((node) => node.tagName.toLowerCase() === 'text' && node.textContent?.startsWith(prefix));

    expect(lastDot).toBeGreaterThan(-1);
    expect(labelAt('Médiane')).toBeGreaterThan(lastDot);
    expect(labelAt('P85')).toBeGreaterThan(lastDot);
  });

  it('garde les lignes de repère sous les points, et la zone de survol au-dessus de tout', () => {
    const { container } = renderPanel();

    const chart = screen.getByRole('img', { name: /Nuage de points/ });
    const drawn = [...chart.querySelectorAll('line[stroke-dasharray], circle[data-dot], [data-chart-hit]')];
    const firstDot = drawn.findIndex((node) => node.matches('circle'));
    const lastLine = drawn.findLastIndex((node) => node.matches('line'));
    expect(lastLine).toBeLessThan(firstDot);
    expect(drawn.at(-1)).toBe(container.querySelector('[data-chart-hit]'));
  });

  it('se passe des repères quand le Cycle Time n’est pas défini', () => {
    renderPanel({ median: null, p85: null });

    const chart = screen.getByRole('img', { name: /Nuage de points/ });
    expect(chart.getAttribute('aria-label')).toBe('Nuage de points du Cycle Time : 5 Livraisons, échelle logarithmique.');
    expect(chart.querySelectorAll('line[stroke-dasharray]')).toHaveLength(0);
  });

  it('gradue l’axe en durées rondes, de celle qui précède la Livraison la plus courte à celle qui suit la plus longue', () => {
    renderPanel();

    // Les Livraisons vont de 1 h 30 à 10 jours : l'axe va de 1 h à 14 j.
    const chart = screen.getByRole('img', { name: /Nuage de points/ });
    const ticks = [...chart.querySelectorAll('text')].map((text) => plain(text.textContent)).filter((text) => /^\d+ (min|h|j)$/.test(text));
    expect(ticks[0]).toBe('1 h');
    expect(ticks.at(-1)).toBe('14 j');
    expect(ticks).not.toContain('1 min');
    expect(ticks.length).toBeGreaterThanOrEqual(4);
  });

  it('détaille la Livraison la plus proche du pointeur : ticket, titre, Cycle Time, jour et heure de Livraison', () => {
    const { container } = renderPanel();
    const dot = dots(container)[4]!;

    fireEvent.pointerMove(hitArea(container), { clientX: Number(dot.getAttribute('cx')) + 3, clientY: Number(dot.getAttribute('cy')) - 2, pointerType: 'mouse' });

    const tooltip = container.querySelector<HTMLElement>('[data-chart-tooltip]')!;
    expect(tooltip.textContent).toContain('mpm-e5');
    expect(tooltip.textContent).toContain('Ticket mpm-e5');
    expect(plain(tooltip.textContent)).toContain('Cycle Time 10 j');
    expect(tooltip.textContent).toContain('P0');
    // Livré le 2 novembre à 10:00 UTC, soit 11:00 à Paris.
    expect(tooltip.textContent).toContain('Livré lun. 2 nov. à 11:00');
  });

  it('nomme le Projet de la Livraison quand le découpage est par Projet', () => {
    const { container } = renderPanel({ dimension: 'project' });
    const dot = dots(container)[1]!;

    fireEvent.pointerMove(hitArea(container), { clientX: Number(dot.getAttribute('cx')), clientY: Number(dot.getAttribute('cy')), pointerType: 'mouse' });

    expect(container.querySelector('[data-chart-tooltip]')?.textContent).toContain('My-Prompt-Manager');
  });

  it('n’affiche rien quand aucune Livraison n’est assez proche, et retire l’infobulle', () => {
    const { container } = renderPanel();
    const dot = dots(container)[0]!;

    fireEvent.pointerMove(hitArea(container), { clientX: Number(dot.getAttribute('cx')), clientY: Number(dot.getAttribute('cy')), pointerType: 'mouse' });
    expect(container.querySelector('[data-chart-tooltip]')).not.toBeNull();

    fireEvent.pointerMove(hitArea(container), { clientX: 300, clientY: 1, pointerType: 'mouse' });
    expect(container.querySelector('[data-chart-tooltip]')).toBeNull();
  });

  it('désigne une Livraison au toucher, et la garde quand le doigt se lève', () => {
    const { container } = renderPanel();
    const dot = dots(container)[2]!;

    fireEvent.pointerDown(hitArea(container), { clientX: Number(dot.getAttribute('cx')), clientY: Number(dot.getAttribute('cy')), pointerType: 'touch' });
    fireEvent.pointerLeave(hitArea(container), { pointerType: 'touch' });

    expect(container.querySelector('[data-chart-tooltip]')?.textContent).toContain('bdesk-c3');
  });

  it('donne les mêmes Livraisons en tableau, avec un lien vers chaque ticket', async () => {
    const user = userEvent.setup();
    renderPanel();

    await user.click(screen.getByText('Données du graphique'));
    const table = screen.getByRole('table', { name: 'Livraisons de la période et leur Cycle Time' });
    const rows = within(table).getAllByRole('row');
    expect(rows).toHaveLength(1 + 5);

    const link = within(rows[1]!).getByRole('link');
    expect(link.getAttribute('href')).toBe('/p/bdesk/t/bdesk-a1');
    expect(within(rows[1]!).getAllByRole('cell').map((cell) => plain(cell.textContent))).toEqual(['Bug', 'P1', 'beads-desktop', 'mar. 27 oct. à 11:00', '1 h 30']);
  });

  it('ne montre la colonne Projet que s’il y a plusieurs Projets', async () => {
    const user = userEvent.setup();
    renderPanel({ showProject: false });

    await user.click(screen.getByText('Données du graphique'));
    expect(within(screen.getByRole('table')).queryByRole('columnheader', { name: 'Projet' })).toBeNull();
  });

  it('explique pourquoi il n’y a rien à tracer quand aucune Livraison n’a été démarrée', () => {
    const { container } = renderPanel({ points: emptyMetricsFixture().cycleTimeScatter, median: null, p85: null });

    expect(screen.getByText(/Aucune Livraison démarrée sur cette période/)).toBeTruthy();
    expect(container.querySelector('svg')).toBeNull();
  });

  it('dessine une durée nulle au pied de l’axe, sans casser l’échelle logarithmique', () => {
    const data = metricsFixture();
    const { container } = renderPanel({ points: [{ ...data.cycleTimeScatter[0]!, cycleTime: 0 }], median: null, p85: null });

    const dot = dots(container)[0]!;
    expect(Number.isFinite(Number(dot.getAttribute('cy')))).toBe(true);
    expect(Number.isFinite(Number(dot.getAttribute('cx')))).toBe(true);
  });
});
