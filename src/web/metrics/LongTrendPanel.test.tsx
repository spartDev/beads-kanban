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

  it('montre le Débit sain de chaque semaine sous le Débit, la semaine en cours hachurée', () => {
    render(<LongTrendPanel trend={longTrendFixture(undefined, ENOUGH_COVERAGE)} />);

    const sound = plot(/^Débit sain par semaine/);
    expect(sound.getAttribute('aria-label')).toBe('Débit sain par semaine : 44 Livraisons saines sur 12 semaines.');
    const bars = marks(sound, '[data-bar]');
    expect(bars).toHaveLength(11);
    expect(bars.map((bar) => bar.hasAttribute('data-partial'))).toEqual([...new Array<boolean>(10).fill(false), true]);
    expect(within(screen.getByRole('list', { name: 'Légende de la Tendance longue' })).getByText('Débit sain')).toBeTruthy();
  });

  it('dessine le Débit sain à l’échelle du Débit, même quand ses propres barres en appelleraient une autre', () => {
    // Un Débit de 12 au plus (axe jusqu'à 20) et un Débit sain de 9 au plus (il aurait son axe jusqu'à 10) : seules les barres d'une même échelle sont dans le
    // rapport 9/12. Deux axes séparés donneraient 9/10 contre 12/20, soit 3/2.
    render(<LongTrendPanel trend={longTrendFixture([12, 4, 4, 4, 4, 4, 4, 4, 4, 4, 4, 1], ENOUGH_COVERAGE)} />);

    const height = (name: RegExp) => Number(marks(plot(name), '[data-bar]')[0]?.getAttribute('height'));
    expect(height(/^Débit sain par semaine/)).toBeGreaterThan(0);
    expect(height(/^Débit sain par semaine/) / height(/^Débit par semaine/)).toBeCloseTo(9 / 12, 10);
  });

  it('significatif : ni remarque, ni barres pâlies, au Débit comme au Débit sain', () => {
    render(<LongTrendPanel trend={longTrendFixture(undefined, ENOUGH_COVERAGE)} />);

    expect(document.querySelector('[data-note]')).toBeNull();
    expect(plot(/^Débit sain par semaine/).hasAttribute('data-faint')).toBe(false);
    for (const name of [/^Débit par semaine/, /^Débit sain par semaine/]) {
      const bars = marks(plot(name), '[data-bar]');
      expect(bars.length).toBeGreaterThan(0);
      expect(bars.filter((bar) => bar.hasAttribute('fill-opacity'))).toEqual([]);
    }
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
    // Le Débit, lui, ne change pas : aucune de ses barres ne pâlit.
    expect(plot(/^Débit par semaine/).hasAttribute('data-faint')).toBe(false);
    expect(marks(plot(/^Débit par semaine/), '[data-bar]').filter((bar) => bar.hasAttribute('fill-opacity'))).toEqual([]);
  });

  it('dit provisoire le Débit sain de la semaine en cours, dans l’infobulle de sa barre et dans la remarque de sa ligne', () => {
    render(<LongTrendPanel trend={longTrendFixture(undefined, ENOUGH_COVERAGE)} />);

    const titles = marks(plot(/^Débit sain par semaine/), '[data-bar] title').map((title) => plain(title.textContent));
    expect(titles.at(-1)).toBe('Semaine du 2 nov. – 8 nov. 2026 : 1 Livraison saine, provisoire : des Livraisons peuvent encore revenir');
    expect(titles.slice(0, -1).some((title) => title.includes('provisoire'))).toBe(false);
    // Le Débit, lui, n'est pas provisoire : sa semaine en cours n'est qu'incomplète.
    expect(marks(plot(/^Débit par semaine/), '[data-bar] title').some((title) => title.textContent?.includes('provisoire'))).toBe(false);
    const rows = within(screen.getByRole('region', { name: 'Données : Tendance longue' })).getAllByRole('row').slice(1);
    expect(plain(rows.at(-1)?.querySelector('td:last-child')?.textContent)).toBe('En cours, Débit sain provisoire, Moins de 4 Livraisons');
    expect(rows.slice(0, -1).some((row) => row.textContent?.includes('provisoire'))).toBe(false);
  });

  it('dit provisoire la semaine en cours dont la seule Livraison a été rouverte avant sa clôture : 0 saine sur 1', () => {
    // La règle tient aux Livraisons, pas aux saines : tant qu'une Livraison de la semaine peut encore revenir, son Débit sain peut bouger.
    const trend = longTrendFixture(undefined, ENOUGH_COVERAGE);
    const current = trend.weeks.at(-1)!;
    expect([current.partial, current.throughput]).toEqual([true, 1]);
    render(<LongTrendPanel trend={{ ...trend, weeks: [...trend.weeks.slice(0, -1), { ...current, soundThroughput: 0, reopened: 1, reopeningRate: 1 }] }} />);

    const rows = within(screen.getByRole('region', { name: 'Données : Tendance longue' })).getAllByRole('row').slice(1);
    expect(rows.at(-1)?.querySelector('[data-sound]')?.textContent).toBe('0');
    expect(plain(rows.at(-1)?.querySelector('td:last-child')?.textContent)).toBe('En cours, Débit sain provisoire, Moins de 4 Livraisons');
  });

  it('ne dit pas provisoire une semaine en cours sans Livraison : rien ne peut en revenir', () => {
    render(<LongTrendPanel trend={longTrendFixture([5, 6, 4, 0, 3, 7, 5, 8, 6, 4, 5, 0], ENOUGH_COVERAGE)} />);

    const rows = within(screen.getByRole('region', { name: 'Données : Tendance longue' })).getAllByRole('row').slice(1);
    expect(plain(rows.at(-1)?.querySelector('td:last-child')?.textContent)).toBe('En cours');
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
    const titles = marks(plot(/^Sound throughput per week/), '[data-bar] title').map((title) => plain(title.textContent));
    expect(titles.at(-1)).toBe('Week of Nov 2 – Nov 8, 2026: 1 Sound delivery, provisional: Deliveries may still come back');
    const rows = within(screen.getByRole('region', { name: 'Data: Long trend' })).getAllByRole('row').slice(1);
    expect(plain(rows.at(-1)?.querySelector('td:last-child')?.textContent)).toBe('In progress, Sound throughput provisional, Fewer than 4 Deliveries');
  });
});
