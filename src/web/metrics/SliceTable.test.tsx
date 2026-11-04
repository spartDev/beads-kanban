import { render, screen, within } from '@testing-library/react';
import { MemoryRouter } from 'react-router';
import { describe, expect, it } from 'vitest';
import type { MetricsResponse } from '../../shared/api';
import type { Dimension } from './params';
import type { SeriesContext } from './series';
import { SliceTable } from './SliceTable';
import { describeSlices } from './slices';
import { emptyMetricsFixture, metricsFixture, plain, trendOf } from './testing';

const ctx: SeriesContext = {
  projectName: (id) => id,
  projectHue: () => 120,
};

function renderTable(data: MetricsResponse, dimension: Dimension) {
  const view = describeSlices({
    slices: data.slices[dimension],
    dimension,
    tiles: data.tiles,
    ctx,
    projectHref: (id) => `/p/${id}/metrics?range=7d`,
  });
  return render(
    <MemoryRouter>
      <SliceTable view={view} dimension={dimension} />
    </MemoryRouter>,
  );
}

const table = () => screen.getByRole('table');
const rows = () => within(table()).getAllByRole('row').slice(1);
const cells = (row: HTMLElement) => within(row).getAllByRole('cell').map((cell) => plain(cell.textContent));

describe('SliceTable : le découpage', () => {
  it('titre la section par le découpage choisi, et nomme le tableau', () => {
    renderTable(metricsFixture(), 'type');

    expect(screen.getByRole('heading', { level: 2, name: 'Découpage par type' })).toBeTruthy();
    expect(screen.getByRole('table', { name: 'Métriques de la période par type' })).toBeTruthy();
  });

  it('liste une ligne par type, dans l’ordre de l’API, puis l’ensemble', () => {
    renderTable(metricsFixture(), 'type');

    expect(rows().map((row) => within(row).getByRole('rowheader').textContent)).toEqual(['Bug', 'Tâche', 'Fonctionnalité', 'Ensemble']);
  });

  it('donne le Débit, le Lead Time, le Cycle Time et le WIP de chaque ligne, sans la colonne du Taux d’échec non significatif', () => {
    renderTable(metricsFixture(), 'type');

    expect(within(table()).getAllByRole('columnheader').map((header) => header.textContent)).toEqual(['Type', 'Débit', 'Lead Time', 'Cycle Time', 'WIP']);
    // 3 j de médiane et 9 j au P85 pour le fixture.
    expect(cells(rows()[0]!)).toEqual(['10', '3 j P85 9 j', '1 j P85 4 j', '5']);
  });

  it('dit une fois, sous le tableau, pourquoi le Taux d’échec n’est pas montré : la Couverture est celle de tous les Projets', () => {
    renderTable(metricsFixture(), 'type');

    const note = screen.getByText(/Taux d’échec non affiché, car non significatif/);
    expect(plain(note.textContent)).toContain('Couverture insuffisante : 19 % des bugs ont une origine renseignée (minimum 50 %).');
    expect(note.textContent).toContain('tous les Projets mesurés');
    expect(screen.queryByText('n. s.')).toBeNull();
  });

  it('reprend les tuiles en dernière ligne : le total des Livraisons se recoupe', () => {
    const data = metricsFixture();
    renderTable(data, 'type');

    const overall = rows().at(-1)!;
    expect(cells(overall)[0]).toBe(String(data.tiles.throughput.total));
    expect(cells(overall)[3]).toBe(String(data.tiles.wip.current));
    expect(within(table()).getAllByRole('rowgroup')).toHaveLength(3);
  });

  it('nomme les priorités avec leur libellé', () => {
    renderTable(metricsFixture(), 'priority');

    expect(rows().map((row) => within(row).getByRole('rowheader').textContent)).toEqual(['P1 · Haute', 'P2 · Moyenne', 'P3 · Basse', 'Ensemble']);
    expect(screen.getByRole('heading', { level: 2, name: 'Découpage par priorité' })).toBeTruthy();
  });

  it('lie chaque Projet à sa page Métriques, période comprise', () => {
    renderTable(metricsFixture(), 'project');

    const links = within(table()).getAllByRole('link');
    expect(links.map((link) => [link.textContent, link.getAttribute('href')])).toEqual([
      ['beads-desktop', '/p/bdesk/metrics?range=7d'],
      ['My-Prompt-Manager', '/p/mpm/metrics?range=7d'],
    ]);
  });

  it('montre le Taux d’échec de chaque Projet quand l’un d’eux a une Couverture suffisante, et « n. s. » pour les autres', () => {
    const data = metricsFixture();
    const mixed: MetricsResponse = {
      ...data,
      slices: {
        ...data.slices,
        project: [
          { ...data.slices.project[0]!, throughput: 2, failureRate: 0, failedDeliveries: 0, significant: false, coverage: { bugs: 1, linked: 0, ratio: 0 } },
          { ...data.slices.project[1]!, throughput: 16, failureRate: 0.125, failedDeliveries: 2, significant: true, coverage: { bugs: 36, linked: 30, ratio: 30 / 36 } },
        ],
      },
    };
    renderTable(mixed, 'project');

    expect(within(table()).getAllByRole('columnheader').map((header) => header.textContent)).toContain('Taux d’échec');
    const [bdesk, mpm] = rows();
    expect(cells(bdesk!)[3]).toBe('n. s. : non significatif (Couverture 0 % (minimum 50 %) ; 1 bug (minimum 5))');
    expect(bdesk!.querySelector('[title]')?.getAttribute('title')).toBe('Couverture 0 % (minimum 50 %) ; 1 bug (minimum 5)');
    expect(cells(mpm!)[3]).toBe('12,5 % 2 sur 16');
    expect(screen.getByText(/^n\. s\. : Taux d’échec non significatif, faute de Couverture ou de bugs/)).toBeTruthy();
  });

  it('explique « n. s. » sans parler d’un Projet quand seule la ligne Ensemble est marquée n. s.', () => {
    const data = metricsFixture();
    const onlyOverall: MetricsResponse = {
      ...data,
      // Les deux Projets ont un taux ; l'ensemble, lui, garde la Couverture insuffisante de la fixture.
      slices: {
        ...data.slices,
        project: [
          { ...data.slices.project[0]!, throughput: 2, failureRate: 0, failedDeliveries: 0, significant: true, coverage: { bugs: 6, linked: 6, ratio: 1 } },
          { ...data.slices.project[1]!, throughput: 16, failureRate: 0.125, failedDeliveries: 2, significant: true, coverage: { bugs: 36, linked: 30, ratio: 30 / 36 } },
        ],
      },
    };
    renderTable(onlyOverall, 'project');

    const [bdesk, mpm, all] = rows();
    expect([bdesk!, mpm!].map((row) => cells(row)[3])).toEqual(['0 % 0 sur 2', '12,5 % 2 sur 16']);
    expect(cells(all!)[3]).toMatch(/^n\. s\. : non significatif/);
    const legend = screen.getByText(/^n\. s\. : Taux d’échec non significatif/);
    expect(plain(legend.textContent)).toBe(
      'n. s. : Taux d’échec non significatif, faute de Couverture ou de bugs (moins de 50 % des bugs avec une origine, ou moins de 5 bugs).',
    );
    expect(legend.textContent).not.toContain('Projet');
  });

  it('n’écrit pas la légende « n. s. » quand aucune ligne n’est marquée n. s.', () => {
    const data = metricsFixture();
    const allSignificant: MetricsResponse = {
      ...data,
      tiles: {
        ...data.tiles,
        failureRate: { ...data.tiles.failureRate, significant: true, reasons: [], reason: null, coverage: { bugs: 42, linked: 36, ratio: 36 / 42 }, deliveries: 18, failed: 2, rate: 2 / 18 },
      },
      slices: {
        ...data.slices,
        project: [
          { ...data.slices.project[0]!, throughput: 2, failureRate: 0, failedDeliveries: 0, significant: true, coverage: { bugs: 6, linked: 6, ratio: 1 } },
          { ...data.slices.project[1]!, throughput: 16, failureRate: 0.125, failedDeliveries: 2, significant: true, coverage: { bugs: 36, linked: 30, ratio: 30 / 36 } },
        ],
      },
    };
    renderTable(allSignificant, 'project');

    expect(within(table()).getAllByRole('columnheader').map((header) => header.textContent)).toContain('Taux d’échec');
    const [bdesk, mpm, all] = rows();
    expect([bdesk!, mpm!, all!].map((row) => cells(row)[3])).toEqual(['0 % 0 sur 2', '12,5 % 2 sur 16', '11,1 % 2 sur 18']);
    // Ni cellule « n. s. » ni légende pour en expliquer une.
    expect(screen.queryByText(/n\. s\./)).toBeNull();
  });

  it('retire la colonne du Taux d’échec quand aucun Projet n’a de taux, et le dit', () => {
    renderTable(metricsFixture(), 'project');

    expect(within(table()).queryByRole('columnheader', { name: 'Taux d’échec' })).toBeNull();
    expect(screen.getByText(/aucun Projet n’a assez de Couverture/)).toBeTruthy();
  });

  it('montre le Taux d’échec de chaque type quand la Couverture de l’ensemble suffit, et dit que c’est celle de l’ensemble', () => {
    const data = metricsFixture();
    const covered: MetricsResponse = {
      ...data,
      tiles: {
        ...data.tiles,
        failureRate: { ...data.tiles.failureRate, significant: true, reasons: [], reason: null, coverage: { bugs: 40, linked: 30, ratio: 0.75 }, deliveries: 18, failed: 3, rate: 3 / 18 },
      },
      slices: { ...data.slices, type: data.slices.type.map((row) => ({ ...row, significant: true, failureRate: 0.1, failedDeliveries: 1, coverage: { bugs: 40, linked: 30, ratio: 0.75 } })) },
    };
    renderTable(covered, 'type');

    expect(within(table()).getAllByRole('columnheader').map((header) => header.textContent)).toContain('Taux d’échec');
    expect(cells(rows()[0]!)[3]).toBe('10 % 1 sur 10');
    expect(screen.getByText(/Couverture de 75 % des bugs, celle de tous les Projets mesurés/)).toBeTruthy();
    expect(screen.queryByText('n. s.')).toBeNull();
  });

  it('écrit un tiret pour une durée sans Livraison', () => {
    const data = emptyMetricsFixture();
    renderTable(data, 'project');

    const [row] = rows();
    expect(cells(row!).slice(0, 3)).toEqual(['0', '—', '—']);
  });

  it('nomme chaque cellule par sa colonne, pour l’affichage en fiches des écrans étroits', () => {
    renderTable(metricsFixture(), 'type');

    expect(within(rows()[0]!).getAllByRole('cell').map((cell) => cell.getAttribute('data-label'))).toEqual(['Débit', 'Lead Time', 'Cycle Time', 'WIP']);
  });

  it('n’échoue pas sans aucune ligne', () => {
    const data = metricsFixture();
    renderTable({ ...data, slices: { ...data.slices, type: [] }, tiles: { ...data.tiles, failureRate: { ...data.tiles.failureRate, trend: trendOf(0, 0) } } }, 'type');

    expect(rows().map((row) => within(row).getByRole('rowheader').textContent)).toEqual(['Ensemble']);
  });
});
