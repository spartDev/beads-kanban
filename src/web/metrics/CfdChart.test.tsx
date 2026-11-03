import { fireEvent, render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { CfdPanel } from './CfdChart';
import { emptyMetricsFixture, metricsFixture, stubChartWidth } from './testing';

const NBSP = ' ';

beforeEach(() => stubChartWidth(640));
afterEach(() => vi.restoreAllMocks());

const hitArea = (container: HTMLElement) => container.querySelector<SVGRectElement>('[data-chart-hit]')!;

describe('CfdPanel : le flux cumulé', () => {
  it('dessine une bande par colonne du kanban, et nomme le dessin par son résumé', () => {
    const { container } = render(<CfdPanel points={metricsFixture().cfd} />);

    const chart = screen.getByRole('img', { name: /^Flux cumulé du 27 oct\. au 2 nov\. 2026\./ });
    expect(chart.getAttribute('aria-label')).toContain('Dernier jour : 170 Terminé, 11 En cours, 0 Bloqué, 33 Prêt, 5 Backlog.');
    // Cinq aplats, et leurs cinq lignes de crête.
    expect(chart.querySelectorAll('path[fill^="var(--flow-"]')).toHaveLength(5);
    expect(container.querySelector('[data-chart-frame]')).not.toBeNull();
  });

  it('range la légende comme les bandes, du haut de la pile vers le bas', () => {
    render(<CfdPanel points={metricsFixture().cfd} />);

    const legend = screen.getByRole('list', { name: 'Colonnes du flux' });
    expect(within(legend).getAllByRole('listitem').map((item) => item.textContent)).toEqual(['Backlog', 'Prêt', 'Bloqué', 'En cours', 'Terminé']);
  });

  it('masque Terminé à la demande, pour agrandir les bandes du travail en cours', async () => {
    const user = userEvent.setup();
    render(<CfdPanel points={metricsFixture().cfd} />);

    const toggle = screen.getByRole('button', { name: 'Masquer Terminé' });
    expect(toggle.getAttribute('aria-pressed')).toBe('false');
    await user.click(toggle);

    expect(toggle.getAttribute('aria-pressed')).toBe('true');
    const chart = screen.getByRole('img', { name: /Flux cumulé/ });
    expect(chart.querySelectorAll('path[fill^="var(--flow-"]')).toHaveLength(4);
    expect(chart.querySelector('path[fill="var(--flow-done)"]')).toBeNull();
    const legend = screen.getByRole('list', { name: 'Colonnes du flux' });
    expect(within(legend).queryByText('Terminé')).toBeNull();
  });

  it('détaille un jour au survol : sa date et le nombre de tickets de chaque colonne', () => {
    const { container } = render(<CfdPanel points={metricsFixture().cfd} />);

    expect(container.querySelector('[data-chart-tooltip]')).toBeNull();
    // Largeur 640, marges 36 et 14 : le tracé fait 590 px, le dernier jour est au bord droit.
    fireEvent.pointerMove(hitArea(container), { clientX: 590, clientY: 60, pointerType: 'mouse' });

    const tooltip = container.querySelector<HTMLElement>('[data-chart-tooltip]')!;
    expect(tooltip.textContent).toContain('lun. 2 nov. 2026');
    expect(within(tooltip).getByText('Terminé').parentElement?.textContent).toBe('Terminé170');
    expect(within(tooltip).getByText('En cours').parentElement?.textContent).toBe('En cours11');
    expect(within(tooltip).getByText('Prêt').parentElement?.textContent).toBe('Prêt33');

    // Au premier jour.
    fireEvent.pointerMove(hitArea(container), { clientX: 0, clientY: 60, pointerType: 'mouse' });
    expect(container.querySelector('[data-chart-tooltip]')?.textContent).toContain('mar. 27 oct. 2026');
  });

  it('retire l’infobulle quand la souris sort, la garde quand le doigt se lève', () => {
    const { container } = render(<CfdPanel points={metricsFixture().cfd} />);

    fireEvent.pointerMove(hitArea(container), { clientX: 300, clientY: 60, pointerType: 'mouse' });
    expect(container.querySelector('[data-chart-tooltip]')).not.toBeNull();
    fireEvent.pointerLeave(hitArea(container), { pointerType: 'mouse' });
    expect(container.querySelector('[data-chart-tooltip]')).toBeNull();

    fireEvent.pointerDown(hitArea(container), { clientX: 300, clientY: 60, pointerType: 'touch' });
    fireEvent.pointerLeave(hitArea(container), { pointerType: 'touch' });
    expect(container.querySelector('[data-chart-tooltip]')).not.toBeNull();

    // Toucher ailleurs la ferme.
    fireEvent.pointerDown(document.body, { pointerType: 'touch' });
    expect(container.querySelector('[data-chart-tooltip]')).toBeNull();
  });

  it('donne les mêmes valeurs en tableau, avec le total de chaque jour', async () => {
    const user = userEvent.setup();
    const { cfd } = metricsFixture();
    render(<CfdPanel points={cfd} />);

    await user.click(screen.getByText('Données du graphique'));
    const table = screen.getByRole('table', { name: 'Tickets par colonne du kanban à la fin de chaque jour' });
    const rows = within(table).getAllByRole('row');
    expect(rows).toHaveLength(1 + cfd.length);

    const last = cfd.at(-1)!;
    const cells = within(rows.at(-1)!).getAllByRole('cell').map((cell) => cell.textContent);
    // Backlog, Prêt, En cours, Bloqué, Terminé, Total.
    expect(cells).toEqual([last.backlog, last.ready, last.inProgress, last.blocked, last.done, last.backlog + last.ready + last.inProgress + last.blocked + last.done].map(String));
    expect(within(rows.at(-1)!).getByRole('rowheader').textContent).toBe('2 nov. 2026');
  });

  it('dit qu’il n’y a rien à montrer plutôt que de dessiner des bandes vides', () => {
    const { container } = render(<CfdPanel points={emptyMetricsFixture().cfd} />);

    expect(screen.getByText('Aucun ticket sur cette période.')).toBeTruthy();
    expect(container.querySelector('svg')).toBeNull();
  });

  it('ne coupe pas les nombres en milliers dans le tableau ni dans l’infobulle', () => {
    const points = metricsFixture().cfd.map((point) => ({ ...point, done: 1234 }));
    const { container } = render(<CfdPanel points={points} />);

    fireEvent.pointerMove(hitArea(container), { clientX: 590, clientY: 60, pointerType: 'mouse' });
    expect(container.querySelector('[data-chart-tooltip]')?.textContent).toContain(`1${NBSP}234`);
  });
});
