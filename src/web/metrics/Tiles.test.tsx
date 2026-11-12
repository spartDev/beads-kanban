import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it } from 'vitest';
import type { MetricsResponse } from '../../shared/api';
import { TooltipProvider } from '../ui/Tip';
import { describeComparison } from './comparison';
import { emptyMetricsFixture, metricsFixture, plain, shownText, spokenText, trendOf } from './testing';
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

describe('MetricTiles : ce que lit un lecteur d’écran', () => {
  /** Ce que l'œil lit, et ce que l'oreille entend : « < 1 min » s'écrit avec un chevron et se dit « moins d’une minute ». */
  const shown = (element: Element) => plain(shownText(element));
  const heard = (element: Element) => plain(spokenText(element));
  const one = (element: Element, selector: string) => element.querySelector(selector)!;

  /** Un Lead Time d'une dizaine de secondes : l'arrondi à la minute le ramène à zéro, l'écran écrit « < 1 min ». */
  function renderQuickLeadTime(previous: [number | null, number | null] = [59_296_172.5, 345_927_383.55], current: [number | null, number | null] = [10_000, 20_000]) {
    const data = metricsFixture();
    const [median, p85] = current;
    const leadTime = { ...data.tiles.leadTime, median, p85, n: median === null ? 0 : 18, trend: { median: trendOf(median, previous[0]), p85: trendOf(p85, previous[1]) } };
    return renderTiles({ ...data, tiles: { ...data.tiles, leadTime } });
  }

  it('Lead Time : la médiane et le P85 sous 30 s s’écrivent « < 1 min » et se disent « moins d’une minute », chacun une fois', () => {
    renderQuickLeadTime();
    const leadTime = tile('Lead Time');

    expect([shown(one(leadTime, '[data-value]')), heard(one(leadTime, '[data-value]'))]).toEqual(['< 1 min', 'moins d’une minute']);
    expect([shown(one(leadTime, '[data-p85]')), heard(one(leadTime, '[data-p85]'))]).toEqual(['< 1 min', 'moins d’une minute']);
    expect(heard(leadTime)).not.toMatch(/[<>]/);
    // L'écran ne change pas : les deux valeurs s'écrivent toujours avec le chevron.
    expect(shown(leadTime).match(/< 1 min/g)).toHaveLength(2);
  });

  it('Lead Time : la médiane qui ne change pas d’une période à l’autre se dit « moins d’une minute comme sur la période précédente »', () => {
    renderQuickLeadTime([12_000, 25_000]);
    const [median, p85] = [...tile('Lead Time').querySelectorAll('[data-trend]')];

    expect(heard(median!)).toBe('Médiane : stable : moins d’une minute comme sur la période précédente.');
    expect(heard(p85!)).toBe('P85 : stable : moins d’une minute comme sur la période précédente.');
    // La puce garde « avant < 1 min » pour l'œil, que les lecteurs d'écran n'entendent pas.
    expect(shown(median!)).toContain('avant < 1 min');
  });

  it('« Avant : … » : la valeur de la période précédente sous 30 s s’écrit « < 1 min » et se dit « moins d’une minute »', () => {
    renderQuickLeadTime([10_000, 20_000], [null, null]);
    const leadTime = tile('Lead Time');

    expect(shown(leadTime)).toContain('Avant : < 1 min');
    expect(heard(leadTime)).toContain('Avant : moins d’une minute');
    expect(heard(leadTime)).not.toMatch(/[<>]/);
  });

  it('« Avant : … » : une durée qui s’écrit sans chevron reste seule, sans balise de plus', () => {
    renderQuickLeadTime([4 * 86_400_000, 9 * 86_400_000], [null, null]);
    const before = [...tile('Lead Time').querySelectorAll('p')].find((paragraph) => paragraph.textContent?.startsWith('Avant'))!;

    expect(plain(before.textContent)).toBe('Avant : 4 j');
    expect(before.children).toHaveLength(0);
  });

  it('Cycle Time et Temps de rétablissement : mêmes tuiles, même règle', () => {
    const data = metricsFixture();
    const quick = { median: 8_000, p85: 15_000, n: 5, trend: { median: trendOf(8_000, 9_000), p85: trendOf(15_000, 14_000) } };
    renderTiles({ ...data, tiles: { ...data.tiles, cycleTime: quick, recoveryTime: { ...quick, n: 2 } } });

    for (const name of ['Cycle Time', 'Temps de rétablissement']) {
      expect(heard(tile(name))).not.toMatch(/[<>]/);
      expect(shown(tile(name))).toContain('< 1 min');
    }
  });
});

describe('MetricTiles : ce que mesure chaque tuile', () => {
  it('Lead Time : survoler son icône info explique la métrique et à quoi elle sert', async () => {
    renderTiles();
    const user = userEvent.setup();

    await user.hover(within(tile('Lead Time')).getByRole('button', { name: 'À propos de Lead Time' }));

    const tooltip = plain((await screen.findByRole('tooltip')).textContent);
    expect(tooltip).toContain('création');
    expect(tooltip).toContain('clôture');
  });

  it('chacune des six tuiles a son icône info, et chaque explication lui est propre', async () => {
    const explanations: string[] = [];

    // Une page neuve par tuile : après un survol, Radix attend que le pointeur rejoigne l'infobulle ou s'en éloigne, ce que jsdom ne simule pas.
    for (const name of ['Débit', 'Lead Time', 'Cycle Time', 'Taux d’échec', 'Temps de rétablissement', 'WIP']) {
      const { unmount } = renderTiles();
      await userEvent.setup().hover(within(tile(name)).getByRole('button', { name: `À propos de ${name}` }));
      explanations.push(plain((await screen.findByRole('tooltip')).textContent));
      unmount();
    }

    expect(new Set(explanations).size).toBe(6);
    expect(explanations[2]).toContain('Lead Time'); // le Cycle Time se lit par rapport au Lead Time
  });

  it('l’explication s’ouvre aussi au clavier, et le bouton la donne comme description aux lecteurs d’écran', async () => {
    renderTiles();
    const user = userEvent.setup();
    const button = within(tile('Cycle Time')).getByRole('button', { name: 'À propos de Cycle Time' });

    while (document.activeElement !== button) await user.tab();

    const tooltip = await screen.findByRole('tooltip');
    expect(plain(tooltip.textContent)).toContain('travail');
    expect(button.getAttribute('aria-describedby')).toBe(tooltip.id);
  });
});
