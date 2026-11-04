import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import type { MetricsResponse } from '../../shared/api';
import { TooltipProvider } from '../ui/Tip';
import { describeComparison } from './comparison';
import { HealthTiles } from './HealthTiles';
import { emptyHealthFixture, emptyMetricsFixture, healthFixture, metricsFixture, plain, shownText, spokenText, trendOf } from './testing';

/**
 * Les cinq tuiles de la santé du flux. Chiffres du fixture (Vue globale, 7 derniers jours) : 20 Arrivées pour 18 Livraisons
 * (+2, contre +4), Efficacité du flux de 92 % (31 j de Cycle Time dont 2,5 j de Blocage, contre 97 %), 2 clôtures sur 21 suivies
 * d'une Réouverture (contre 4 %), 2 Abandons parmi 20 tickets fermés (contre 5 %), 3 Prêts sur 5 qui stagnent (contre 2).
 */

function renderTiles(data: MetricsResponse = metricsFixture()) {
  return render(
    <TooltipProvider>
      <HealthTiles tiles={data.tiles} health={data.health} comparison={describeComparison(data)} />
    </TooltipProvider>,
  );
}

const tile = (name: string) => screen.getByRole('article', { name });
const text = (element: HTMLElement) => plain(element.textContent);
/** Ce que l'œil lit, et ce que l'oreille entend : « > 99,9 % » s'écrit avec un chevron et se dit « plus de 99,9 % ». */
const shown = (element: Element) => plain(shownText(element));
const heard = (element: Element) => plain(spokenText(element));
const trends = (element: HTMLElement) => [...element.querySelectorAll('[data-trend]')].map((trend) => [trend.getAttribute('data-trend'), trend.getAttribute('data-tone')]);

describe('HealthTiles : la santé du flux', () => {
  it('montre cinq tuiles, sous « Santé du flux », dans l’ordre du ticket', () => {
    renderTiles();

    expect(screen.getByRole('heading', { level: 2, name: 'Santé du flux' })).toBeTruthy();
    expect(screen.getAllByRole('article').map((article) => document.getElementById(article.getAttribute('aria-labelledby')!)?.textContent)).toEqual([
      'Arrivées vs Débit',
      'Efficacité du flux',
      'Taux de Réouverture',
      'Taux d’abandon',
      'Prêts qui stagnent',
    ]);
  });

  describe('Arrivées vs Débit', () => {
    it('donne l’écart, les deux comptes, et une tendance sans bon ni mauvais sens', () => {
      renderTiles();

      const balance = tile('Arrivées vs Débit');
      expect(text(balance)).toContain('+2Arrivées moins Débit');
      expect(text(balance)).toContain('20 Arrivées · 18 Livraisons');
      // L'écart passe de +4 à +2 : en baisse, sans couleur d'approbation.
      expect(trends(balance)).toEqual([['down', 'neutral']]);
      expect(text(balance.querySelector('[data-trend]') as HTMLElement)).toContain('En baisse de 2 : +2 contre +4 sur la période précédente.');
    });

    it('écrit un écart négatif avec un vrai moins, et zéro sans signe', () => {
      const data = metricsFixture();
      renderTiles({ ...data, tiles: { ...data.tiles, arrivals: { total: 5, trend: trendOf(5, 8) }, throughput: { total: 12, trend: trendOf(12, 3) } } });
      expect(text(tile('Arrivées vs Débit'))).toContain('−7Arrivées moins Débit');
    });

    it('dit « 0 » quand les Arrivées valent le Débit', () => {
      const data = metricsFixture();
      renderTiles({ ...data, tiles: { ...data.tiles, arrivals: { total: 12, trend: trendOf(12, 12) }, throughput: { total: 12, trend: trendOf(12, 12) } } });
      expect(text(tile('Arrivées vs Débit'))).toContain('0Arrivées moins Débit');
    });
  });

  describe('Efficacité du flux', () => {
    it('donne la part hors Blocage, le Blocage en durée, le nombre de Livraisons bloquées, et une bonne tendance quand elle monte', () => {
      renderTiles();

      const efficiency = tile('Efficacité du flux');
      expect(text(efficiency)).toContain('15 Livraisons');
      expect(text(efficiency)).toContain('91,9 %du Cycle Time hors Blocage');
      expect(text(efficiency)).toContain('Blocage : 2,5 j sur 31 j de Cycle Time');
      expect(text(efficiency)).toContain('3 Livraisons avec du Blocage');
      // 91,9 % contre 97 % : en baisse, donc mauvais.
      expect(trends(efficiency)).toEqual([['down', 'bad']]);
    });

    it('écrit « > 99,9 % », jamais « 100 % », quand le Blocage n’est pas nul : 3,5 s de Blocage sur 124 j de Cycle Time', () => {
      const data = metricsFixture();
      const ratio = 1 - 3516 / 10_723_598_096;
      renderTiles({ ...data, health: healthFixture({ efficiency: { n: 75, cycleTime: 10_723_598_096, blockedTime: 3516, blockedDeliveries: 1, ratio, trend: trendOf(ratio, 1) } }) });

      const efficiency = tile('Efficacité du flux');
      expect(shown(efficiency.querySelector('[data-value]') as HTMLElement)).toBe('> 99,9 %');
      expect(shown(efficiency)).toContain('> 99,9 %du Cycle Time hors Blocage');
      expect(shown(efficiency)).not.toMatch(/^Efficacité du flux75 Livraisons100 %/);
      expect(shown(efficiency)).toContain('Blocage : < 1 min sur 124 j de Cycle Time');
      expect(text(efficiency)).toContain('1 Livraison avec du Blocage');
      // La période précédente n'avait aucun Blocage : exactement 100 %, et c'est ce qu'on lit. La phrase de la tendance dit les deux valeurs, comme la puce.
      const trend = efficiency.querySelector('[data-trend]') as HTMLElement;
      expect(shown(trend)).toContain('avant 100 %');
      expect(heard(trend)).toBe('Stable : plus de 99,9 % contre 100 % sur la période précédente.');
      expect(heard(trend)).not.toContain('comme sur la période précédente');
    });

    it('se lit « plus de 99,9 % » : l’écran écrit le chevron, le lecteur d’écran dit les mots, et « < 1 min » se dit « moins d’une minute »', () => {
      const data = metricsFixture();
      const ratio = 1 - 3516 / 10_723_598_096;
      renderTiles({ ...data, health: healthFixture({ efficiency: { n: 75, cycleTime: 10_723_598_096, blockedTime: 3516, blockedDeliveries: 1, ratio, trend: trendOf(ratio, 1) } }) });

      const efficiency = tile('Efficacité du flux');
      const value = efficiency.querySelector('[data-value]') as HTMLElement;
      expect(heard(value)).toBe('plus de 99,9 %');
      expect(heard(efficiency)).toContain('plus de 99,9 %du Cycle Time hors Blocage');
      expect(heard(efficiency)).toContain('Blocage : moins d’une minute sur 124 j de Cycle Time');
      expect(heard(efficiency)).not.toMatch(/[<>]/); // aucune valeur lue ne commence par un chevron
      // Le chevron écrit est caché aux lecteurs d'écran, qui ne le lisent donc pas en plus des mots.
      expect(plain(value.querySelector('[aria-hidden="true"]')?.textContent)).toBe('> 99,9 %');
      expect(plain(value.querySelector('.sr-only')?.textContent)).toBe('plus de 99,9 %');
    });

    it('ne double pas ce qui se lit tel quel : « 100 % » et « 91,9 % » n’ont qu’une seule version, la même pour l’œil et l’oreille', () => {
      const data = metricsFixture();
      const exact = healthFixture({ efficiency: { ...data.health.efficiency, blockedTime: 0, ratio: 1, blockedDeliveries: 0, trend: trendOf(1, 1) } });
      for (const health of [exact, data.health]) {
        const view = renderTiles({ ...data, health });
        const efficiency = tile('Efficacité du flux');
        const value = efficiency.querySelector('[data-value]') as HTMLElement;
        expect(value.querySelector('.sr-only, [aria-hidden]')).toBeNull();
        expect(shown(value)).toBe(heard(value));
        expect(heard(efficiency)).toContain(health === exact ? 'Aucun Blocage pendant le travail.' : 'Blocage : 2,5 j sur 31 j de Cycle Time');
        view.unmount();
      }
    });

    it('n’écrit « 100 % » que pour une efficacité exacte : 99,95 % de Blocage près s’écrit « > 99,9 % », 99,94 % s’écrit « 99,9 % »', () => {
      const data = metricsFixture();
      const render = (ratio: number) => {
        const view = renderTiles({ ...data, health: healthFixture({ efficiency: { n: 4, cycleTime: 1_000_000, blockedTime: Math.round((1 - ratio) * 1_000_000), blockedDeliveries: 1, ratio, trend: trendOf(ratio, ratio) } }) });
        const value = tile('Efficacité du flux').querySelector('[data-value]') as HTMLElement;
        const texts = { shown: shown(value), heard: heard(value) };
        view.unmount();
        return texts;
      };

      expect(render(0.9995)).toEqual({ shown: '> 99,9 %', heard: 'plus de 99,9 %' });
      expect(render(0.99949)).toEqual({ shown: '99,9 %', heard: '99,9 %' });
      expect(render(1)).toEqual({ shown: '100 %', heard: '100 %' });
    });

    it('explique pourquoi la part est souvent proche de 100 %, et renvoie à l’Attente de dépendance de la décomposition du Lead Time', () => {
      renderTiles();

      expect(text(tile('Efficacité du flux'))).toContain(
        'Souvent proche de 100 % : un ticket est démarré une fois débloqué. L’attente d’une dépendance se lit dans la Décomposition du Lead Time (Attente de dépendance).',
      );
    });

    it('dit la même explication quand rien n’a été bloqué : c’est là qu’on se demande pourquoi', () => {
      const data = metricsFixture();
      renderTiles({ ...data, health: healthFixture({ efficiency: { ...data.health.efficiency, blockedTime: 0, ratio: 1, blockedDeliveries: 0, trend: trendOf(1, 1) } }) });

      expect(text(tile('Efficacité du flux'))).toContain('Aucun Blocage pendant le travail.');
      expect(text(tile('Efficacité du flux'))).toContain('Souvent proche de 100 % : un ticket est démarré une fois débloqué.');
    });

    it('dit « aucun Blocage » plutôt qu’un temps nul quand le travail n’a jamais été bloqué', () => {
      const data = metricsFixture();
      renderTiles({ ...data, health: healthFixture({ efficiency: { ...data.health.efficiency, blockedTime: 0, ratio: 1, blockedDeliveries: 0, trend: trendOf(1, 1) } }) });

      const efficiency = tile('Efficacité du flux');
      expect(text(efficiency)).toContain('100 %du Cycle Time hors Blocage');
      expect(text(efficiency)).toContain('Aucun Blocage pendant le travail.');
      expect(text(efficiency)).not.toContain('Livraisons avec du Blocage');
      expect(trends(efficiency)).toEqual([['flat', 'neutral']]);
    });

    it('dit une seule Livraison au singulier', () => {
      const data = metricsFixture();
      renderTiles({ ...data, health: healthFixture({ efficiency: { ...data.health.efficiency, n: 1, blockedDeliveries: 1 } }) });

      expect(text(tile('Efficacité du flux'))).toContain('1 Livraison');
      expect(text(tile('Efficacité du flux'))).toContain('1 Livraison avec du Blocage');
    });

    it('dit qu’il n’y a rien à mesurer sans Livraison démarrée', () => {
      renderTiles(emptyMetricsFixture());

      const efficiency = tile('Efficacité du flux');
      expect(text(efficiency)).toContain('—');
      expect(text(efficiency)).toContain('Aucune Livraison démarrée sur la période.');
      expect(efficiency.querySelector('[data-trend]')).toBeNull();
      expect(text(efficiency)).not.toContain('Souvent proche de 100 %'); // rien à expliquer : pas de valeur
    });
  });

  describe('Taux de Réouverture', () => {
    it('donne le taux, le nombre de clôtures suivies d’une Réouverture, et une mauvaise tendance quand il monte', () => {
      renderTiles();

      const reopening = tile('Taux de Réouverture');
      expect(text(reopening)).toContain('21 clôtures');
      expect(text(reopening)).toContain('9,5 %2 sur 21 clôtures suivies d’une Réouverture');
      expect(trends(reopening)).toEqual([['up', 'bad']]);
      expect(text(reopening.querySelector('[data-trend]') as HTMLElement)).toContain('avant 4 %');
    });

    it.each([
      [1, 0, '0 sur 1 clôture suivie d’une Réouverture'],
      [1, 1, '1 sur 1 clôture suivie d’une Réouverture'],
      [2, 0, '0 sur 2 clôtures suivies d’une Réouverture'],
      [2, 1, '1 sur 2 clôtures suivies d’une Réouverture'],
      [21, 2, '2 sur 21 clôtures suivies d’une Réouverture'],
    ])('accorde « suivie » avec les clôtures : %i clôture(s), %i rouverte(s)', (closures, reopened, caption) => {
      const data = metricsFixture();
      renderTiles({ ...data, health: healthFixture({ reopening: { closures, reopened, rate: reopened / closures, trend: trendOf(reopened / closures, null) } }) });

      expect(text(tile('Taux de Réouverture'))).toContain(caption);
    });

    it('dit « aucune clôture » sans clôture', () => {
      renderTiles(emptyMetricsFixture());

      const reopening = tile('Taux de Réouverture');
      expect(text(reopening)).toContain('Aucune clôture sur la période.');
      expect(reopening.querySelector('[data-trend]')).toBeNull();
    });
  });

  describe('Taux d’abandon', () => {
    it('donne le taux, le nombre d’Abandons parmi les tickets fermés, et leur cause', () => {
      renderTiles();

      const abandonment = tile('Taux d’abandon');
      expect(text(abandonment)).toContain('20 tickets fermés');
      expect(text(abandonment)).toContain('10 %2 sur 20 tickets fermés');
      expect(text(abandonment)).toContain('1 doublon, 1 remplacé');
    });

    it('ne colore pas la hausse : fermer des doublons relève de la bonne hygiène, pas d’un recul', () => {
      renderTiles();

      // 10 % contre 5 % : en hausse, sans rouge ni vert. La Réouverture, elle, reste mauvaise quand elle monte.
      expect(trends(tile('Taux d’abandon'))).toEqual([['up', 'neutral']]);
      expect(tile('Taux d’abandon').querySelector('[data-trend]')?.className).not.toContain('text-danger');
      expect(trends(tile('Taux de Réouverture'))).toEqual([['up', 'bad']]);
    });

    it('dit que seuls les liens duplicates et supersedes sont reconnus : une clôture « Duplicate: … » sans lien compte comme une Livraison', () => {
      renderTiles();

      expect(text(tile('Taux d’abandon'))).toContain(
        'Seuls les liens duplicates et supersedes sont reconnus : un ticket fermé « Duplicate: … » sans lien compte comme une Livraison.',
      );
    });

    it('accorde les causes : plusieurs doublons, aucun remplacé', () => {
      const data = metricsFixture();
      renderTiles({ ...data, health: healthFixture({ abandonment: { ...data.health.abandonment, abandoned: 3, duplicates: 3, superseded: 0, rate: 0.15 } }) });

      expect(text(tile('Taux d’abandon'))).toContain('3 doublons');
      expect(text(tile('Taux d’abandon'))).not.toContain('remplacé');
    });

    it('n’écrit aucune cause sans Abandon : 0 %', () => {
      const data = metricsFixture();
      renderTiles({ ...data, health: healthFixture({ abandonment: { closed: 12, abandoned: 0, duplicates: 0, superseded: 0, rate: 0, trend: trendOf(0, 0) } }) });

      const abandonment = tile('Taux d’abandon');
      expect(text(abandonment)).toContain('0 %0 sur 12 tickets fermés');
      expect(text(abandonment)).not.toContain('doublon');
      // Pas de ligne de cause vide : rien à dire, rien d'écrit. Reste la limite de la mesure, qui vaut d'autant plus que le taux est à 0.
      expect([...abandonment.querySelectorAll('p')].every((paragraph) => (paragraph.textContent ?? '') !== '')).toBe(true);
      expect([...abandonment.querySelectorAll('.border-t p')].map((paragraph) => plain(paragraph.textContent))).toEqual([
        'Seuls les liens duplicates et supersedes sont reconnus : un ticket fermé « Duplicate: … » sans lien compte comme une Livraison.',
      ]);
    });

    it('n’écrit que la cause qui existe : un seul remplacé, aucun doublon', () => {
      const data = metricsFixture();
      renderTiles({ ...data, health: healthFixture({ abandonment: { ...data.health.abandonment, abandoned: 1, duplicates: 0, superseded: 1, rate: 0.05 } }) });

      expect(text(tile('Taux d’abandon'))).toContain('1 remplacé');
      expect(text(tile('Taux d’abandon'))).not.toContain('doublon');
    });

    it('dit « aucun ticket fermé » sans ticket fermé, sans note sur les liens : rien à mesurer', () => {
      renderTiles(emptyMetricsFixture());

      expect(text(tile('Taux d’abandon'))).toContain('Aucun ticket fermé sur la période.');
      expect(text(tile('Taux d’abandon'))).not.toContain('duplicates');
    });
  });

  describe('Prêts qui stagnent', () => {
    it('donne combien de Prêts stagnent parmi tous, depuis combien de temps, et une mauvaise tendance quand il en vient', () => {
      renderTiles();

      const ready = tile('Prêts qui stagnent');
      expect(text(ready)).toContain('5 Prêts');
      expect(text(ready)).toContain('3sur 5 Prêts, depuis plus de 14 j');
      expect(trends(ready)).toEqual([['up', 'bad']]);
    });

    it('dit qu’il n’y a aucun Prêt, plutôt qu’un zéro sans explication', () => {
      renderTiles(emptyMetricsFixture());

      const ready = tile('Prêts qui stagnent');
      expect(text(ready)).toContain('0Aucun ticket Prêt.');
    });

    it('dit zéro sur les Prêts qu’il y a quand tous sont récents', () => {
      const data = metricsFixture();
      renderTiles({ ...data, health: healthFixture({ readyAges: { ...data.health.readyAges, stagnant: 0, tickets: data.health.readyAges.tickets.slice(3).map((t) => ({ ...t, stagnant: false })), trend: trendOf(0, 0) } }) });

      expect(text(tile('Prêts qui stagnent'))).toContain('0sur 2 Prêts, depuis plus de 14 j');
    });
  });

  describe('mise en page : cinq tuiles, jamais de case vide', () => {
    /** Les trois états de la grille : 2 colonnes (sous 36rem), 6 colonnes (dès 36rem), 5 colonnes (dès 68rem). */
    const REGIMES = ['', '@min-[36rem]:', '@min-[68rem]:'];
    const classes = (element: Element) => (element.getAttribute('class') ?? '').split(/\s+/);
    /** La valeur d'un utilitaire à un état de la grille, avec la cascade : un état plus large reprend celui d'en dessous. */
    const at = (names: string[], utility: RegExp, regime: number, fallback: number) => {
      for (let index = regime; index >= 0; index--) {
        const found = names.map((name) => new RegExp(`^${REGIMES[index]!.replace(/[[\]]/g, '\\$&')}${utility.source}$`).exec(name)).find(Boolean);
        if (found) return Number(found[1]);
      }
      return fallback;
    };

    it.each([
      { regime: 0, label: 'sous 36rem : 2 colonnes' },
      { regime: 1, label: 'de 36rem à 68rem : 6 colonnes' },
      { regime: 2, label: 'dès 68rem : 5 colonnes' },
    ])('remplit chaque ligne de la grille, de bord à bord, $label', ({ regime }) => {
      renderTiles();

      const grid = screen.getByRole('heading', { level: 2, name: 'Santé du flux' }).closest('section')!.querySelector('.grid') as HTMLElement;
      const columns = at(classes(grid), /grid-cols-(\d+)/, regime, 1);
      const spans = screen.getAllByRole('article').map((article) => at(classes(article), /col-span-(\d+)/, regime, 1));

      // On range les tuiles de gauche à droite : une ligne se ferme quand la suivante ne tient plus.
      const rows: number[] = [];
      let used = 0;
      for (const span of spans) {
        if (used + span > columns) {
          rows.push(used);
          used = 0;
        }
        used += span;
      }
      rows.push(used);

      expect(spans).toHaveLength(5);
      expect(rows.every((row) => row === columns)).toBe(true);
    });
  });

  it('rend des tuiles vides mais complètes pour un Projet sans rien', () => {
    renderTiles({ ...emptyMetricsFixture(), health: emptyHealthFixture() });

    expect(screen.getAllByRole('article')).toHaveLength(5);
  });
});
