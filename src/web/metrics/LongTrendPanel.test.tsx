import { render, screen, within } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { LanguageProvider } from '../i18n';
import { LANGUAGE_STORAGE_KEY } from '../i18n/language';
import { LongTrendPanel } from './LongTrendPanel';
import { ENOUGH_COVERAGE, longTrendFixture, plain, stubChartWidth } from './testing';

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

/** Le Débit sain des fixtures : chaque semaine, ses Livraisons moins une sur quatre, rouverte ; 44 sur les 54 Livraisons des 12 semaines. */
describe('LongTrendPanel : le Débit sain, quatrième série', () => {
  const NOTE = 'Non significatif. Couverture insuffisante : 19 % des bugs ont une origine renseignée (minimum 50 %).';

  it('montre le Débit sain de chaque semaine sous le Débit, à la même échelle, la semaine en cours hachurée', () => {
    render(<LongTrendPanel trend={longTrendFixture(undefined, ENOUGH_COVERAGE)} />);

    const sound = plot(/^Débit sain par semaine/);
    expect(sound.getAttribute('aria-label')).toBe('Débit sain par semaine : 44 Livraisons saines sur 12 semaines.');
    const bars = marks(sound, '[data-bar]');
    expect(bars).toHaveLength(11);
    expect(bars.map((bar) => bar.hasAttribute('data-partial'))).toEqual([...new Array<boolean>(10).fill(false), true]);
    // La semaine du 17 août : 4 Livraisons saines sur 5, à la même échelle que le Débit.
    const height = (bar: Element | undefined) => Number(bar?.getAttribute('height'));
    expect(height(bars[0]) / height(marks(plot(/^Débit par semaine/), '[data-bar]')[0])).toBeCloseTo(4 / 5, 10);
    expect(within(screen.getByRole('list', { name: 'Légende de la Tendance longue' })).getByText('Débit sain')).toBeTruthy();
  });

  it('significatif : ni remarque, ni barres pâlies', () => {
    render(<LongTrendPanel trend={longTrendFixture(undefined, ENOUGH_COVERAGE)} />);

    expect(document.querySelector('[data-note]')).toBeNull();
    expect(plot(/^Débit sain par semaine/).hasAttribute('data-faint')).toBe(false);
    expect(screen.getByRole('table').querySelector('caption')?.textContent).toBe('Débit, Débit sain, Lead Time au P85 et Taux de Réouverture de chacune des 12 dernières semaines');
  });

  it('non significatif : le dit sous son titre, dans son nom et dans la légende du tableau, et pâlit ses barres sans toucher à leur contour', () => {
    render(<LongTrendPanel trend={longTrendFixture()} />);

    expect(plain(document.querySelector('[data-note]')?.textContent)).toBe(NOTE);
    const sound = plot(/^Débit sain par semaine/);
    expect(plain(sound.getAttribute('aria-label'))).toBe(`Débit sain par semaine : 44 Livraisons saines sur 12 semaines. ${NOTE}`);
    expect(sound.hasAttribute('data-faint')).toBe(true);
    const bars = marks(sound, '[data-bar]');
    expect(bars.filter((bar) => !bar.hasAttribute('data-partial')).every((bar) => bar.getAttribute('fill-opacity') === '0.35')).toBe(true);
    // Le contour garde son contraste : mêlé à l'encre (`outlineOf`), sans transparence.
    expect(bars.every((bar) => bar.getAttribute('stroke')?.startsWith('color-mix(') && !bar.hasAttribute('stroke-opacity'))).toBe(true);
    expect(plain(screen.getByRole('table').querySelector('caption')?.textContent)).toContain('Débit sain non significatif. Couverture insuffisante');
    // Le Débit, lui, ne change pas.
    expect(plot(/^Débit par semaine/).hasAttribute('data-faint')).toBe(false);
  });

  it('donne le Débit sain de chaque semaine dans le tableau, à côté de ses Livraisons', () => {
    render(<LongTrendPanel trend={longTrendFixture()} />);

    const table = within(screen.getByRole('region', { name: 'Données : Tendance longue' }));
    expect(table.getAllByRole('columnheader').map((header) => header.textContent)).toEqual(['Semaine', 'Livraisons', 'Livraisons saines', 'Lead Time P85', 'Réouverture', 'Remarque']);
    const sound = table.getAllByRole('row').slice(1).map((row) => row.querySelector('[data-sound]')?.textContent);
    expect(sound).toEqual(['4', '5', '3', '0', '3', '6', '4', '6', '5', '3', '4', '1']);
  });

  it('en anglais', () => {
    window.localStorage.setItem(LANGUAGE_STORAGE_KEY, 'en');
    render(
      <LanguageProvider switchEnabled>
        <LongTrendPanel trend={longTrendFixture()} />
      </LanguageProvider>,
    );

    expect(plain(plot(/^Sound throughput per week/).getAttribute('aria-label'))).toBe(
      'Sound throughput per week: 44 Sound deliveries over 12 weeks. Not significant. Coverage too low: 19% of bugs have a recorded origin (minimum 50%).',
    );
    expect(screen.getByRole('columnheader', { name: 'Sound deliveries' })).toBeTruthy();
  });
});
