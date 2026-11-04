import { fireEvent, render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { BalancePanel } from './BalanceChart';
import { emptyMetricsFixture, metricsFixture, plain, stubChartWidth, weeklyMetricsFixture } from './testing';

beforeEach(() => stubChartWidth(640));
afterEach(() => vi.restoreAllMocks());

const hitArea = (container: HTMLElement) => container.querySelector<SVGRectElement>('[data-chart-hit]')!;

function renderPanel(data = metricsFixture(), overrides: { unit?: 'day' | 'week'; running?: boolean } = {}) {
  return render(<BalancePanel buckets={data.buckets} unit={overrides.unit ?? data.bucket} running={overrides.running ?? true} asOfTime="20:00" />);
}

describe('BalancePanel : Arrivées et Débit cumulés', () => {
  it('dit en une phrase les deux totaux, la façon de compter, et l’écart', () => {
    renderPanel();

    expect(screen.getByRole('region', { name: 'Arrivées et Débit cumulés' })).toBeTruthy();
    expect(screen.getByText('20 Arrivées et 18 Livraisons sur la période, cumulées par jour. L’écart est de +2.')).toBeTruthy();
  });

  it('résume le dessin pour les lecteurs d’écran', () => {
    renderPanel();

    expect(screen.getByRole('img', { name: 'Arrivées et Débit cumulés : 20 Arrivées et 18 Livraisons sur 7 tranches, écart +2.' })).toBeTruthy();
  });

  it('trace deux courbes qui finissent aux totaux de la période, de formes différentes (jamais la couleur seule)', () => {
    const { container } = renderPanel();

    const arrivals = container.querySelector<SVGPathElement>('[data-series="arrivals"]')!;
    const deliveries = container.querySelector<SVGPathElement>('[data-series="deliveries"]')!;
    expect(arrivals).toBeTruthy();
    expect(deliveries).toBeTruthy();
    expect(arrivals.getAttribute('stroke-dasharray')).toBeTruthy();
    expect(deliveries.getAttribute('stroke-dasharray')).toBeNull();
    // Sept tranches, donc huit bornes par courbe : de 0 aux totaux.
    expect([...container.querySelectorAll('[data-point="arrivals"]')].map((point) => point.getAttribute('data-value'))).toEqual(['0', '1', '4', '4', '6', '7', '12', '20']);
    expect([...container.querySelectorAll('[data-point="deliveries"]')].map((point) => point.getAttribute('data-value'))).toEqual(['0', '2', '4', '4', '4', '6', '6', '18']);
  });

  it('ne marque que les bornes de la fin quand les tranches sont nombreuses : 31 marques par courbe n’étaient plus que du bruit', () => {
    const data = metricsFixture();
    const month = Array.from({ length: 31 }, (_, index) => ({
      from: `2026-10-${String(index + 1).padStart(2, '0')}`,
      to: `2026-10-${String(index + 1).padStart(2, '0')}`,
      days: 1,
      deliveries: index % 3 === 0 ? 1 : 0,
      arrivals: index % 2 === 0 ? 2 : 0,
    }));
    const { container } = renderPanel({ ...data, buckets: month, bucket: 'day' });

    // 11 Livraisons et 32 Arrivées au total : seule la dernière borne de chaque courbe est marquée, les courbes restent entières.
    expect([...container.querySelectorAll('[data-point="arrivals"]')].map((point) => point.getAttribute('data-value'))).toEqual(['32']);
    expect([...container.querySelectorAll('[data-point="deliveries"]')].map((point) => point.getAttribute('data-value'))).toEqual(['11']);
    expect(container.querySelector('[data-series="arrivals"]')?.getAttribute('d')?.split('L')).toHaveLength(31 + 1);
  });

  it('marque les bornes de chaque tranche jusqu’à seize tranches, pas au-delà', () => {
    const data = metricsFixture();
    const make = (count: number) =>
      Array.from({ length: count }, (_, index) => ({ from: `2026-10-${String(index + 1).padStart(2, '0')}`, to: `2026-10-${String(index + 1).padStart(2, '0')}`, days: 1, deliveries: 1, arrivals: 1 }));

    expect(renderPanel({ ...data, buckets: make(16) }).container.querySelectorAll('[data-point="arrivals"]')).toHaveLength(17);
    expect(renderPanel({ ...data, buckets: make(17) }).container.querySelectorAll('[data-point="arrivals"]')).toHaveLength(1);
  });

  it('marque la borne de la tranche survolée même quand les tranches sont nombreuses', () => {
    const data = metricsFixture();
    const month = Array.from({ length: 31 }, (_, index) => ({
      from: `2026-10-${String(index + 1).padStart(2, '0')}`,
      to: `2026-10-${String(index + 1).padStart(2, '0')}`,
      days: 1,
      deliveries: 1,
      arrivals: 2,
    }));
    const { container } = renderPanel({ ...data, buckets: month, bucket: 'day' });

    // 592 px pour 31 tranches de 19,1 px : x = 100 est dans la sixième (indice 5), dont la fin est la borne 6 : 12 Arrivées, 6 Livraisons.
    fireEvent.pointerMove(hitArea(container), { clientX: 100, clientY: 80, pointerType: 'mouse' });

    expect([...container.querySelectorAll('[data-point="arrivals"]')].map((point) => point.getAttribute('data-value'))).toEqual(['12', '62']);
    expect([...container.querySelectorAll('[data-point="deliveries"]')].map((point) => point.getAttribute('data-value'))).toEqual(['6', '31']);
  });

  it('nomme les deux courbes dans la légende', () => {
    renderPanel();

    const legend = screen.getByRole('list', { name: 'Légende des Arrivées et du Débit' });
    expect(within(legend).getAllByRole('listitem').map((item) => item.textContent)).toEqual(['Arrivées', 'Livraisons']);
  });

  it('détaille une tranche au survol : ses comptes et le cumul à sa fin', () => {
    const { container } = renderPanel();

    // Largeur 640, marges 34 et 14 : 592 px pour 7 tranches de 84,6 px ; la deuxième va de 84,6 à 169,1.
    fireEvent.pointerMove(hitArea(container), { clientX: 100, clientY: 80, pointerType: 'mouse' });

    const tooltip = container.querySelector<HTMLElement>('[data-chart-tooltip]')!;
    expect(plain(tooltip.textContent)).toContain('mer. 28 oct. 2026');
    expect(plain(tooltip.textContent)).toContain('Arrivées 3 · Livraisons 2');
    expect(plain(tooltip.textContent)).toContain('Cumul : 4 Arrivées, 4 Livraisons');
  });

  it('efface l’infobulle quand la souris quitte le graphique', () => {
    const { container } = renderPanel();

    fireEvent.pointerMove(hitArea(container), { clientX: 100, clientY: 80, pointerType: 'mouse' });
    expect(container.querySelector('[data-chart-tooltip]')).toBeTruthy();
    fireEvent.pointerLeave(hitArea(container), { pointerType: 'mouse' });
    expect(container.querySelector('[data-chart-tooltip]')).toBeNull();
  });

  it('dit, dans l’infobulle, que la dernière tranche d’une période qui court n’est pas finie', () => {
    const { container } = renderPanel();

    fireEvent.pointerMove(hitArea(container), { clientX: 585, clientY: 80, pointerType: 'mouse' });

    expect(plain(container.querySelector('[data-chart-tooltip]')?.textContent)).toContain('Jour en cours, jusqu’à 20:00.');
  });

  it('range les mêmes valeurs en tableau, avec l’écart et le cumul de chaque tranche', async () => {
    const user = userEvent.setup();
    renderPanel();

    await user.click(screen.getByText('Données du graphique'));
    const table = screen.getByRole('table', { name: 'Arrivées et Livraisons de chaque tranche, et leur cumul' });
    const rows = within(table).getAllByRole('row');

    expect(rows).toHaveLength(8);
    expect(within(rows[0]!).getAllByRole('columnheader').map((header) => header.textContent)).toEqual([
      'Tranche',
      'Arrivées',
      'Livraisons',
      'Écart',
      'Arrivées cumulées',
      'Livraisons cumulées',
      'Écart cumulé',
      'Remarque',
    ]);
    // Dernière tranche : le 2 novembre, 8 Arrivées et 12 Livraisons, cumul 20 et 18.
    expect(within(rows.at(-1)!).getAllByRole('cell').map((cell) => plain(cell.textContent))).toEqual(['8', '12', '−4', '20', '18', '+2', 'Jour en cours, jusqu’à 20:00.']);
    expect(plain(within(rows[1]!).getByRole('rowheader').textContent)).toBe('mar. 27 oct. 2026');
  });

  it('signale les semaines incomplètes de 90 jours, comme l’histogramme du Débit', async () => {
    const user = userEvent.setup();
    const data = weeklyMetricsFixture();
    renderPanel(data, { unit: 'week' });

    expect(screen.getByText('23 Arrivées et 26 Livraisons sur la période, cumulées par semaine (du lundi au dimanche). L’écart est de −3.')).toBeTruthy();
    await user.click(screen.getByText('Données du graphique'));
    expect(plain(screen.getAllByRole('row')[1]?.textContent)).toContain('Semaine incomplète : 5 jours sur 7 dans la période.');
  });

  it('dit qu’il n’y a rien plutôt que de dessiner des courbes plates', () => {
    const data = emptyMetricsFixture();
    renderPanel(data);

    expect(screen.getByText('Aucune Arrivée ni Livraison sur cette période.')).toBeTruthy();
    expect(screen.queryByRole('img')).toBeNull();
  });
});
