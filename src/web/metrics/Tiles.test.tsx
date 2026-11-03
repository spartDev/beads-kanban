import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it } from 'vitest';
import type { MetricsResponse } from '../../shared/api';
import { TooltipProvider } from '../ui/Tip';
import { describeComparison } from './comparison';
import { emptyMetricsFixture, metricsFixture, plain, trendOf } from './testing';
import { MetricTiles } from './Tiles';

/**
 * Les six tuiles. Chiffres du fixture (relevés de l'API réelle, 7 derniers jours) : Débit 18 contre 28, Lead Time
 * médian 6,9 j (contre 16 h 28), Cycle Time médian 2,1 j, Taux d'échec non significatif (Couverture 19 %), aucun bug
 * critique livré (contre un médian de 4 j), WIP 11, moyenne 10,6.
 */

function renderTiles(data: MetricsResponse = metricsFixture()) {
  return render(
    <TooltipProvider>
      <MetricTiles tiles={data.tiles} comparison={describeComparison(data)} />
    </TooltipProvider>,
  );
}

const tile = (name: string) => screen.getByRole('article', { name });
const text = (element: HTMLElement) => plain(element.textContent);

describe('MetricTiles : les six tuiles', () => {
  it('les montre dans l’ordre du ticket, sous « Indicateurs »', () => {
    renderTiles();

    expect(screen.getByRole('heading', { level: 2, name: 'Indicateurs' })).toBeTruthy();
    expect(screen.getAllByRole('article').map((article) => article.getAttribute('aria-labelledby')).map((id) => document.getElementById(id!)?.textContent)).toEqual([
      'Débit',
      'Lead Time',
      'Cycle Time',
      'Taux d’échec',
      'Temps de rétablissement',
      'WIP',
    ]);
  });

  it('Débit : le nombre de Livraisons, et sa tendance mauvaise puisqu’il baisse', () => {
    renderTiles();

    const debit = tile('Débit');
    expect(text(debit)).toContain('18Livraisons sur la période');
    const trend = debit.querySelector('[data-trend]')!;
    expect(trend.getAttribute('data-trend')).toBe('down');
    expect(trend.getAttribute('data-tone')).toBe('bad');
    expect(plain(trend.textContent)).toContain('−10');
    expect(plain(trend.textContent)).toContain('avant 28');
    expect(plain(trend.textContent)).toContain('En baisse de 10 (−36 %) : 18 contre 28 sur la période précédente.');
  });

  it('Lead Time : la médiane en grand, le P85 dessous, la taille de l’échantillon, une tendance pour chacun', () => {
    renderTiles();

    const leadTime = tile('Lead Time');
    expect(text(leadTime)).toContain('18 Livraisons');
    expect(text(leadTime)).toContain('6,9 jmédiane');
    expect(text(leadTime)).toContain('P8516 j');
    const trends = [...leadTime.querySelectorAll('[data-trend]')];
    expect(trends.map((trend) => [trend.getAttribute('data-trend'), trend.getAttribute('data-tone')])).toEqual([
      ['up', 'bad'],
      ['up', 'bad'],
    ]);
    // La médiane passe de 16 h 28 à 6,9 j.
    expect(plain(trends[0]?.textContent)).toContain('+6,2 j');
    expect(plain(trends[0]?.textContent)).toContain('avant 16 h 28');
    expect(plain(trends[0]?.textContent)).toContain('Médiane : en hausse de 6,2 jours (+903 %)');
    expect(plain(trends[1]?.textContent)).toContain('P85 : en hausse de 12 jours');
  });

  it('Cycle Time : une durée qui se raccourcit au P85 est une bonne tendance', () => {
    renderTiles();

    const trends = [...tile('Cycle Time').querySelectorAll('[data-trend]')];
    expect(trends.map((trend) => [trend.getAttribute('data-trend'), trend.getAttribute('data-tone')])).toEqual([
      ['up', 'bad'],
      ['down', 'good'],
    ]);
    expect(text(tile('Cycle Time'))).toContain('15 Livraisons');
  });

  it('Taux d’échec non significatif : le dit, avec la raison de l’API, sans tendance', () => {
    renderTiles();

    const failure = tile('Taux d’échec');
    expect(failure.hasAttribute('data-indicative')).toBe(true);
    expect(text(failure)).toContain('Non significatif');
    expect(text(failure)).toContain('Couverture insuffisante : 19 % des bugs ont une origine renseignée (minimum 50 %).');
    expect(text(failure)).toContain('Observé : 0 % (0 sur 18)');
    expect(failure.querySelector('[data-trend]')).toBeNull();
    // Un seul pictogramme d’alerte, décoratif.
    expect(failure.querySelectorAll('svg[aria-hidden="true"]').length).toBeGreaterThan(0);
  });

  it('Taux d’échec significatif : le taux, le nombre de Livraisons en échec, la Couverture, la tendance en points', () => {
    const data = metricsFixture();
    const significant = metricsFixture({
      tiles: {
        ...data.tiles,
        failureRate: {
          ...data.tiles.failureRate,
          deliveries: 16,
          failed: 2,
          rate: 0.125,
          coverage: { bugs: 40, linked: 30, ratio: 0.75 },
          significant: true,
          reasons: [],
          reason: null,
          trend: trendOf(0.125, 0.2),
        },
      },
    });
    renderTiles(significant);

    const failure = tile('Taux d’échec');
    expect(failure.hasAttribute('data-indicative')).toBe(false);
    expect(text(failure)).toContain('12,5 %');
    expect(text(failure)).toContain('2 sur 16 en échec');
    expect(text(failure)).toContain('Couverture 75 %');
    const trend = failure.querySelector('[data-trend]')!;
    expect([trend.getAttribute('data-trend'), trend.getAttribute('data-tone')]).toEqual(['down', 'good']);
    expect(plain(trend.textContent)).toContain('−7,5 pts');
    expect(plain(trend.textContent)).toContain('avant 20 %');
  });

  it('Temps de rétablissement : dit qu’aucun bug critique n’a été livré, et rappelle la valeur d’avant', () => {
    renderTiles();

    const recovery = tile('Temps de rétablissement');
    expect(text(recovery)).toContain('—');
    expect(text(recovery)).toContain('Aucun bug critique (P0 ou P1) livré sur la période.');
    expect(text(recovery)).toContain('0 bug critique');
    expect(text(recovery)).toContain('Avant : 4 j');
    expect(recovery.querySelector('[data-trend]')).toBeNull();
    expect(text(recovery)).not.toContain('P85');
  });

  it('WIP : le nombre de tickets en cours maintenant, la moyenne de la période, et une tendance stable sans couleur', () => {
    renderTiles();

    const wip = tile('WIP');
    expect(text(wip)).toContain('11en cours à 20:00');
    expect(text(wip)).toContain('moyenne10,6');
    const trend = wip.querySelector('[data-trend]')!;
    expect([trend.getAttribute('data-trend'), trend.getAttribute('data-tone')]).toEqual(['flat', 'neutral']);
    expect(plain(trend.textContent)).toContain('stable');
  });

  it('une période terminée parle de « fin de période » plutôt que de maintenant', () => {
    const data = metricsFixture({ asOf: '2026-11-02T23:00:00.000Z' });
    renderTiles(data);
    expect(text(tile('WIP'))).toContain('en cours à la fin de la période');
  });

  it('dit « Aucune Livraison » dans chaque tuile quand le Projet n’a rien livré', () => {
    renderTiles(emptyMetricsFixture());

    expect(text(tile('Débit'))).toContain('0Livraisons sur la période');
    expect(text(tile('Lead Time'))).toContain('Aucune Livraison sur la période.');
    expect(text(tile('Cycle Time'))).toContain('Aucune Livraison démarrée sur la période.');
    expect(text(tile('Temps de rétablissement'))).toContain('Aucun bug critique (P0 ou P1) livré sur la période.');
    // Pas de tendance entre deux périodes sans valeur.
    expect(tile('Lead Time').querySelector('[data-trend]')).toBeNull();
    expect(text(tile('Lead Time'))).not.toContain('Pas de période précédente');
  });

  it('dit une seule fois, pour la médiane et le P85, que la période précédente n’a pas de valeur à comparer', () => {
    const data = metricsFixture();
    renderTiles(
      metricsFixture({
        tiles: { ...data.tiles, leadTime: { ...data.tiles.leadTime, trend: { median: trendOf(1, null), p85: trendOf(2, null) } } },
      }),
    );

    expect(within(tile('Lead Time')).getAllByText('Pas de période précédente à comparer.')).toHaveLength(1);
    expect(tile('Lead Time').querySelector('[data-trend]')).toBeNull();
  });

  it('garde sa propre phrase au seul des deux qui n’a rien avant', () => {
    const data = metricsFixture();
    renderTiles(
      metricsFixture({
        tiles: { ...data.tiles, leadTime: { ...data.tiles.leadTime, trend: { median: trendOf(2 * 3_600_000, 3_600_000), p85: trendOf(2, null) } } },
      }),
    );

    // La médiane a sa tendance ; le P85 dit qu'il n'a rien à comparer.
    expect(tile('Lead Time').querySelectorAll('[data-trend]')).toHaveLength(1);
    expect(within(tile('Lead Time')).getAllByText('Pas de période précédente à comparer.')).toHaveLength(1);
  });

  it('explique la comparaison sous les tuiles, à voix haute et à l’écran', () => {
    renderTiles();

    expect(
      screen.getByText(/^Période en cours \(27 oct\. – 2 nov\. 2026\), comptée jusqu’au 2 nov\. à 20:00\. Les tendances la comparent/),
    ).toBeTruthy();
  });

  it('rappelle dans une infobulle, au survol d’une tendance, à quoi la valeur est comparée', async () => {
    const user = userEvent.setup();
    renderTiles();

    await user.hover(tile('Débit').querySelector('[data-trend]')!);

    const tooltip = await screen.findByRole('tooltip');
    expect(plain(tooltip.textContent)).toContain('Comparé à la période précédente à durée écoulée égale, jusqu’au 26 oct. à 19:00.');
    expect(plain(tooltip.textContent)).toContain('La période en cours n’est pas finie');
  });

  it('rend une tendance accessible au clavier', () => {
    renderTiles();

    const trend = tile('Débit').querySelector<HTMLElement>('[data-trend]')!;
    trend.focus();
    expect(document.activeElement).toBe(trend);
  });
});
