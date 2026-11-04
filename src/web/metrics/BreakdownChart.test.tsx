import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it } from 'vitest';
import { BreakdownPanel } from './BreakdownChart';
import { emptyHealthFixture, healthFixture, plain } from './testing';

const HOUR = 3_600_000;

/**
 * Décomposition du Lead Time. Fixture : 18 Livraisons, 120 j de Lead Time cumulé, dont 21 j d'Attente de dépendance (6
 * Livraisons ont attendu : médiane 2,1 j, P85 6 j), 52 j d'Attente en Prêt, 16 j d'autre attente, 28,5 j de travail et 2,5 j de Blocage.
 */

/** Une comparaison d'un nom accessible, espaces insécables (« 17,5 % ») comprises comme des espaces. */
const named = (expected: string) => (name: string) => plain(name) === expected;

const renderPanel = (breakdown = healthFixture().leadTimeBreakdown) => render(<BreakdownPanel breakdown={breakdown} />);

describe('BreakdownPanel : la décomposition du Lead Time', () => {
  it('dit ce qu’elle répartit : le Lead Time cumulé des Livraisons, en cinq parts', () => {
    renderPanel();

    expect(screen.getByRole('region', { name: 'Décomposition du Lead Time' })).toBeTruthy();
    expect(screen.getByText('Le Lead Time cumulé de 18 Livraisons (120 j), réparti en cinq parts qui s’additionnent.')).toBeTruthy();
  });

  it('résume la barre pour les lecteurs d’écran, avec les parts', () => {
    renderPanel();

    expect(
      screen.getByRole('img', {
        name: named('Décomposition du Lead Time : Attente de dépendance 17,5 %, Attente en Prêt 43,3 %, Autre attente 13,3 %, Travail 23,8 %, Blocage 2,1 %.'),
      }),
    ).toBeTruthy();
  });

  it('dessine cinq segments dans l’ordre de la vie d’un ticket, larges de leur part', () => {
    const { container } = renderPanel();

    const segments = [...container.querySelectorAll<HTMLElement>('[data-part]')];
    expect(segments.map((segment) => segment.getAttribute('data-part'))).toEqual(['dependencyWait', 'readyWait', 'otherWait', 'work', 'blocked']);
    expect(segments.map((segment) => Number.parseFloat(segment.style.width))).toEqual([
      expect.closeTo((21 / 120) * 100, 6),
      expect.closeTo((52 / 120) * 100, 6),
      expect.closeTo((16 / 120) * 100, 6),
      expect.closeTo((28.5 / 120) * 100, 6),
      expect.closeTo((2.5 / 120) * 100, 6),
    ]);
  });

  it('distingue l’autre attente de l’Attente de dépendance, qui a la même couleur de colonne : par des hachures, pas par la couleur seule', () => {
    const { container } = renderPanel();

    const segment = (key: string) => container.querySelector<HTMLElement>(`[data-part="${key}"]`)!;
    expect(segment('otherWait').style.background).toContain('repeating-linear-gradient');
    expect(segment('dependencyWait').style.background).not.toContain('repeating-linear-gradient');
    expect(segment('readyWait').style.background).not.toContain('repeating-linear-gradient');
    // La pastille de la légende dessine les mêmes hachures que le segment.
    const swatches = within(screen.getByRole('list', { name: 'Parts du Lead Time' })).getAllByRole('listitem').map((item) => item.querySelector<HTMLElement>('span[aria-hidden="true"]')!.style.background);
    expect(swatches.map((background) => background.includes('repeating-linear-gradient'))).toEqual([false, false, true, false, false]);
  });

  it('ne dessine pas une part nulle : pas de segment d’un pixel pour un Blocage qui n’a pas eu lieu, mais sa ligne reste dans la légende', () => {
    const base = healthFixture().leadTimeBreakdown;
    const { container } = renderPanel({ ...base, blocked: 0, otherWait: base.otherWait + base.blocked });

    expect([...container.querySelectorAll('[data-part]')].map((segment) => segment.getAttribute('data-part'))).toEqual(['dependencyWait', 'readyWait', 'otherWait', 'work']);
    expect(within(screen.getByRole('list', { name: 'Parts du Lead Time' })).getAllByRole('listitem')).toHaveLength(5);
  });

  it('écrit « Aucun » et « 0 % » pour un Blocage exactement nul, jamais « < 1 min » : la tuile de l’Efficacité dit « Aucun Blocage »', () => {
    const base = healthFixture().leadTimeBreakdown;
    renderPanel({ ...base, blocked: 0, otherWait: base.otherWait + base.blocked });

    const blocage = within(screen.getByRole('list', { name: 'Parts du Lead Time' })).getAllByRole('listitem')[4];
    expect(plain(blocage?.firstElementChild?.textContent)).toBe('BlocageAucun0 %');
    expect(plain(blocage?.firstElementChild?.textContent)).not.toContain('< 1 min');
  });

  it('accorde « Aucune » avec les parts féminines : une Attente de dépendance, une Attente en Prêt, une autre attente nulles', () => {
    const base = healthFixture().leadTimeBreakdown;
    renderPanel({ ...base, dependencyWait: 0, readyWait: 0, otherWait: 0, total: base.work + base.blocked, deliveries: 1 });

    const legend = within(screen.getByRole('list', { name: 'Parts du Lead Time' })).getAllByRole('listitem');
    expect(legend.map((item) => plain(item.firstElementChild?.textContent))).toEqual(['Attente de dépendanceAucune0 %', 'Attente en PrêtAucune0 %', 'Autre attenteAucune0 %', 'Travail29 j91,9 %', 'Blocage2,5 j8,1 %']);
  });

  it('garde « < 1 min » pour une part qui n’est pas nulle : 3,5 s de Blocage ont bien eu lieu', () => {
    const base = healthFixture().leadTimeBreakdown;
    renderPanel({ ...base, blocked: 3516, otherWait: base.otherWait - 3516 });

    expect(plain(within(screen.getByRole('list', { name: 'Parts du Lead Time' })).getAllByRole('listitem')[4]?.firstElementChild?.textContent)).toBe('Blocage< 1 min0 %');
  });

  it('nomme chaque part dans la légende avec sa durée cumulée et sa part du Lead Time', () => {
    renderPanel();

    const legend = screen.getByRole('list', { name: 'Parts du Lead Time' });
    expect(within(legend).getAllByRole('listitem').map((item) => plain(item.firstElementChild?.textContent))).toEqual([
      'Attente de dépendance21 j17,5 %',
      'Attente en Prêt52 j43,3 %',
      'Autre attente16 j13,3 %',
      'Travail29 j23,8 %',
      'Blocage2,5 j2,1 %',
    ]);
  });

  it('explique chaque part en une phrase visible : « autre attente » est un reste, qu’il faut pouvoir lire sans survol', () => {
    renderPanel();

    const legend = screen.getByRole('list', { name: 'Parts du Lead Time' });
    expect(within(legend).getAllByRole('listitem').map((item) => plain(item.lastElementChild?.textContent))).toEqual([
      'Le temps en Backlog avant le premier démarrage : le ticket dépendait d’un ticket non fermé.',
      'Le temps passé Prêt : le ticket pouvait être démarré et ne l’était pas.',
      'Le reste : Backlog après un premier démarrage, différé, ou fermé avant une Réouverture.',
      'Le Cycle Time hors Blocage.',
      'Le Cycle Time passé en Blocage : statut bloqué, ou dépendance non fermée pendant le travail.',
    ]);
  });

  it('dit combien de Livraisons ont attendu une dépendance, et combien de temps', () => {
    renderPanel();

    expect(screen.getByText('6 Livraisons sur 18 ont attendu une dépendance avant de démarrer : médiane 2,1 j, P85 6 j.')).toBeTruthy();
  });

  it('accorde la phrase d’une seule Livraison qui a attendu', () => {
    const base = healthFixture().leadTimeBreakdown;
    renderPanel({ ...base, waited: 1, waits: { median: 3 * HOUR, p85: 3 * HOUR, n: 1 } });

    expect(screen.getByText('1 Livraison sur 18 a attendu une dépendance avant de démarrer : médiane 3 h, P85 3 h.')).toBeTruthy();
  });

  it('dit qu’aucune Livraison n’a attendu une dépendance, quand c’est le cas', () => {
    const base = healthFixture().leadTimeBreakdown;
    renderPanel({ ...base, dependencyWait: 0, waited: 0, waits: { median: null, p85: null, n: 0 } });

    expect(screen.getByText('Aucune Livraison n’a attendu une dépendance avant de démarrer.')).toBeTruthy();
  });

  it('explique chaque part dans le tableau des données, avec leur total', async () => {
    const user = userEvent.setup();
    renderPanel();

    await user.click(screen.getByText('Données du graphique'));
    const table = screen.getByRole('table', { name: 'Parts du Lead Time cumulé des Livraisons de la période' });
    const rows = within(table).getAllByRole('row');

    expect(rows).toHaveLength(7);
    expect(within(rows[0]!).getAllByRole('columnheader').map((header) => header.textContent)).toEqual(['Part', 'Durée cumulée', 'Part du Lead Time']);
    expect(rows.slice(1).map((row) => [within(row).getByRole('rowheader').textContent, ...within(row).getAllByRole('cell').map((cell) => plain(cell.textContent))])).toEqual([
      ['Attente de dépendance', '21 j', '17,5 %'],
      ['Attente en Prêt', '52 j', '43,3 %'],
      ['Autre attente', '16 j', '13,3 %'],
      ['Travail', '29 j', '23,8 %'],
      ['Blocage', '2,5 j', '2,1 %'],
      ['Lead Time cumulé', '120 j', '100 %'],
    ]);
  });

  it('écrit « Aucun » dans le tableau des données pour un Blocage nul, comme dans la légende', async () => {
    const user = userEvent.setup();
    const base = healthFixture().leadTimeBreakdown;
    renderPanel({ ...base, blocked: 0, otherWait: base.otherWait + base.blocked });

    await user.click(screen.getByText('Données du graphique'));
    const rows = within(screen.getByRole('table', { name: 'Parts du Lead Time cumulé des Livraisons de la période' })).getAllByRole('row');
    expect([within(rows[5]!).getByRole('rowheader').textContent, ...within(rows[5]!).getAllByRole('cell').map((cell) => plain(cell.textContent))]).toEqual(['Blocage', 'Aucun', '0 %']);
  });

  describe('sans Livraison : un état vide', () => {
    it('dit « Aucune Livraison sur la période », sans durée ni pourcentage ni dessin', () => {
      const { container } = renderPanel(emptyHealthFixture().leadTimeBreakdown);

      expect(screen.getByText('Aucune Livraison sur la période.')).toBeTruthy();
      expect(container.querySelector('[data-part]')).toBeNull();
      expect(screen.queryByRole('img')).toBeNull();
      expect(screen.queryByRole('list', { name: 'Parts du Lead Time' })).toBeNull();
      expect(plain(screen.getByRole('region', { name: 'Décomposition du Lead Time' }).textContent)).not.toContain('< 1 min');
    });

    it('ne compte pas « 0 Livraison (< 1 min) » : la description dit seulement ce que la carte répartit', () => {
      renderPanel(emptyHealthFixture().leadTimeBreakdown);

      expect(screen.getByText('Le Lead Time cumulé des Livraisons de la période, réparti en cinq parts qui s’additionnent.')).toBeTruthy();
      expect(screen.queryByText('Le Lead Time cumulé de 0 Livraison (< 1 min), réparti en quatre parts qui s’additionnent.', { normalizer: plain })).toBeNull();
      expect(plain(screen.getByRole('region', { name: 'Décomposition du Lead Time' }).textContent)).not.toContain('0 Livraison');
    });

    it('ne propose pas de tableau des données : il n’aurait que des « < 1 min » et des tirets', () => {
      renderPanel(emptyHealthFixture().leadTimeBreakdown);

      expect(screen.queryByText('Données du graphique')).toBeNull();
      expect(screen.queryByRole('table')).toBeNull();
    });

    it('dit qu’il n’y a pas de Lead Time à répartir quand les Livraisons en ont un nul, sans dire qu’il n’y en a pas', () => {
      renderPanel({ ...emptyHealthFixture().leadTimeBreakdown, deliveries: 2 });

      expect(screen.getByText('Aucun Lead Time à décomposer : les Livraisons de la période ont toutes un Lead Time nul.')).toBeTruthy();
      expect(screen.queryByText('Aucune Livraison sur la période.')).toBeNull();
      expect(screen.queryByRole('table')).toBeNull();
    });
  });
});
