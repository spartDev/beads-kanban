import { render, screen, within } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { LongTrendPanel } from './LongTrendPanel';
import { longTrendFixture, stubChartWidth } from './testing';

beforeEach(() => stubChartWidth(640));
afterEach(() => vi.restoreAllMocks());

const plot = (name: RegExp) => screen.getByRole('img', { name });
const marks = (svg: Element, selector: string) => [...svg.querySelectorAll(selector)];

describe('LongTrendPanel : la Tendance longue', () => {
  it('montre le Débit des 12 semaines, la semaine en cours hachurée', () => {
    render(<LongTrendPanel trend={longTrendFixture()} />);

    expect(screen.getByRole('region', { name: 'Tendance longue' })).toBeTruthy();
    const throughput = plot(/^Débit par semaine/);
    expect(throughput.getAttribute('aria-label')).toBe('Débit par semaine : 54 Livraisons sur 12 semaines.');
    const bars = marks(throughput, '[data-bar]');
    expect(bars).toHaveLength(11); // la semaine du 7 septembre n'a pas de Livraison
    expect(bars.map((bar) => bar.hasAttribute('data-partial'))).toEqual([...new Array<boolean>(10).fill(false), true]);
  });

  it('trace le Lead Time au P85 en pointillé là où la semaine a moins de 4 Livraisons, et le dit dans la légende', () => {
    render(<LongTrendPanel trend={longTrendFixture()} />);

    const points = marks(plot(/^Lead Time au P85 par semaine/), '[data-point]');
    expect(points).toHaveLength(11);
    // Sous 4 Livraisons : la semaine du 14 septembre (3) et la semaine en cours (1). Celle du 7 septembre n'en a aucune : pas de point.
    expect(points.filter((point) => point.hasAttribute('data-unreliable')).map((point) => point.getAttribute('data-week'))).toEqual(['2026-09-14', '2026-11-02']);
    expect(within(screen.getByRole('list', { name: 'Légende de la Tendance longue' })).getByText('Moins de 4 Livraisons')).toBeTruthy();
  });

  it('interrompt les courbes sur une semaine sans Livraison ni clôture, sans lisser', () => {
    render(<LongTrendPanel trend={longTrendFixture()} />);

    // 12 semaines, un trou la quatrième : deux morceaux de 3 et 8 semaines, soit 2 + 7 traits entre semaines voisines.
    expect(marks(plot(/^Lead Time au P85 par semaine/), '[data-segment]')).toHaveLength(9);
    expect(marks(plot(/^Taux de Réouverture par semaine/), '[data-segment]')).toHaveLength(9);
  });

  it('dessine en pointillé chaque trait qui touche une semaine sous 4 Livraisons', () => {
    render(<LongTrendPanel trend={longTrendFixture()} />);

    const dashed = marks(plot(/^Lead Time au P85 par semaine/), '[data-segment]').filter((segment) => segment.getAttribute('stroke-dasharray'));
    // Semaine du 14 septembre (3) : ses traits vers le 21. Semaine du 2 novembre (1) : son trait depuis le 26 octobre.
    expect(dashed.map((segment) => segment.getAttribute('data-to'))).toEqual(['2026-09-21', '2026-11-02']);
  });

  it('donne chaque semaine en tableau, avec ce qu’il faut savoir pour la lire', () => {
    render(<LongTrendPanel trend={longTrendFixture()} />);

    const rows = within(screen.getByRole('region', { name: 'Données : Tendance longue' })).getAllByRole('row').slice(1);
    expect(rows).toHaveLength(12);
    expect(rows[0]?.textContent).toContain('5');
    expect(rows[3]?.textContent).toContain('—');
    expect(rows[4]?.textContent).toContain('Moins de 4 Livraisons');
    expect(rows[11]?.textContent).toContain('En cours');
  });

  it('dit qu’il n’y a rien à montrer quand les 12 semaines n’ont ni Livraison ni clôture', () => {
    render(<LongTrendPanel trend={longTrendFixture(new Array<number>(12).fill(0))} />);

    expect(screen.getByText('Aucune Livraison ni clôture sur les 12 dernières semaines.')).toBeTruthy();
    expect(screen.queryByRole('img')).toBeNull();
  });
});
