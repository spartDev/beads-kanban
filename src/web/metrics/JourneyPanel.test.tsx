import { render, screen, within } from '@testing-library/react';
import { MemoryRouter } from 'react-router';
import { describe, expect, it } from 'vitest';
import type { MetricsResponse } from '../../shared/api';
import { TooltipProvider } from '../ui/Tip';
import { describeComparison } from './comparison';
import { JourneyPanel } from './JourneyPanel';
import { emptyHealthFixture, emptyMetricsFixture, metricsFixture, plain, spokenText } from './testing';

/**
 * Le parcours d'un ticket, en tête des métriques. Chiffres du fixture (Vue globale, 7 derniers jours, période en cours) : 20 Arrivées, 18 Livraisons (28 avant) ;
 * Lead Time médian de 6,9 j, Cycle Time médian de 2,1 j ; 120 j de Lead Time cumulé, dont 18 % en Backlog, 43 % en Prêt, 26 % en cours et 13 % d'autre attente ;
 * 5 tickets en Backlog, 33 Prêts dont 3 stagnent, 11 en cours.
 */

function renderJourney(data: MetricsResponse = metricsFixture(), signalsHref = '/signals') {
  return render(
    <MemoryRouter>
      <TooltipProvider>
        <JourneyPanel tiles={data.tiles} health={data.health} cfd={data.cfd} comparison={describeComparison(data, 'fr')} signalsHref={signalsHref} />
      </TooltipProvider>
    </MemoryRouter>,
  );
}

const panel = () => screen.getByRole('region', { name: 'Le parcours d’un ticket' });
const text = (element: Element) => plain(element.textContent);
const stage = (key: string) => panel().querySelector(`[data-stage="${key}"]`) as HTMLElement;

describe('JourneyPanel : le parcours d’un ticket', () => {
  it('est une région nommée par son titre', () => {
    renderJourney();

    expect(within(panel()).getByRole('heading', { level: 2, name: 'Le parcours d’un ticket' })).toBeTruthy();
  });

  it('nomme les cinq étapes dans l’ordre : ce qui entre, les trois états, ce qui sort', () => {
    renderJourney();

    expect(within(panel()).getAllByRole('heading', { level: 3 }).map((heading) => heading.textContent)).toEqual(['Arrivées', 'Backlog', 'Prêt', 'En cours', 'Livraisons']);
  });

  it('pose les Arrivées à l’entrée et les Livraisons à la sortie, avec la tendance du Débit', () => {
    renderJourney();

    expect(panel().querySelector('[data-flow="arrivals"]')?.textContent).toBe('20');
    expect(panel().querySelector('[data-flow="deliveries"]')?.textContent).toBe('18');
    const trend = panel().querySelector('.journey-flow-out [data-trend]') as HTMLElement;
    expect([trend.getAttribute('data-trend'), trend.getAttribute('data-tone')]).toEqual(['down', 'bad']);
    expect(text(trend)).toContain('Livraisons : en baisse de 10');
  });

  it('cote le Lead Time et le Cycle Time par leur médiane, chacun avec sa tendance', () => {
    renderJourney();

    const [lead, cycle] = [...panel().querySelectorAll('.journey-dim')] as HTMLElement[];
    expect(text(lead!)).toContain('Lead Time6,9 jde la création à la Livraison, en médiane');
    expect(text(cycle!)).toContain('Cycle Time2,1 jde travail, en médiane');
    // Plus longs qu'avant : une hausse, dans le mauvais sens.
    for (const dimension of [lead!, cycle!]) {
      const trend = dimension.querySelector('[data-trend]') as HTMLElement;
      expect([trend.getAttribute('data-trend'), trend.getAttribute('data-tone')]).toEqual(['up', 'bad']);
    }
    expect(text(lead!.querySelector('[data-trend]')!)).toContain('Lead Time, médiane : en hausse de');
  });

  it('écrit pour chaque état la part du temps qui s’y passe et les tickets qui s’y trouvent', () => {
    renderJourney();

    expect(text(stage('backlog'))).toBe('Backlog18 % du temps, à attendre une dépendance5 tickets en ce moment');
    expect(text(stage('ready'))).toBe('Prêt43 % du temps, à attendre d’être démarré33 tickets en ce moment, dont 3 stagnent depuis plus de 14 j');
    expect(text(stage('work'))).toBe('En cours26 % du temps, au travail11 tickets en ce moment');
  });

  it('mène des Prêts qui stagnent à la page « À regarder » de ce que la page mesure', () => {
    renderJourney(metricsFixture(), '/p/bdesk/signals');

    expect(within(stage('ready')).getByRole('link', { name: '3 stagnent' }).getAttribute('href')).toBe('/p/bdesk/signals');
  });

  it('ne parle pas de Prêts qui stagnent quand aucun ne stagne', () => {
    const data = metricsFixture();
    renderJourney({ ...data, health: { ...data.health, readyAges: { ...data.health.readyAges, stagnant: 0 } } });

    expect(within(stage('ready')).queryByRole('link')).toBeNull();
    expect(text(stage('ready'))).toBe('Prêt43 % du temps, à attendre d’être démarré33 tickets en ce moment');
  });

  it('dit les tickets en Blocage parmi ceux en cours', () => {
    const data = metricsFixture();
    renderJourney({ ...data, cfd: [...data.cfd.slice(0, -1), { ...data.cfd.at(-1)!, inProgress: 9, blocked: 2 }] });

    expect(text(stage('work'))).toBe('En cours26 % du temps, au travail11 tickets en ce moment, dont 2 en Blocage');
  });

  it('accorde au singulier un seul ticket, et une seule Arrivée', () => {
    const data = metricsFixture();
    renderJourney({
      ...data,
      tiles: { ...data.tiles, arrivals: { ...data.tiles.arrivals, total: 1 } },
      cfd: [{ ...data.cfd.at(-1)!, backlog: 1 }],
    });

    expect(text(stage('backlog'))).toContain('1 ticket en ce moment');
    expect(text(panel().querySelector('.journey-flow')!)).toBe('1Arrivéesticket créé');
  });

  it('dit « à la fin de la période » quand la période est terminée', () => {
    const data = metricsFixture();
    // Mesurée après sa fin : les tickets comptés sont ceux de la fin de la période, pas ceux de maintenant.
    renderJourney({ ...data, asOf: data.period.end, generatedAt: data.period.end });

    expect(text(stage('ready'))).toContain('33 tickets à la fin de la période');
  });

  it('résume en une phrase la part d’attente, où elle se passe, et sur quoi les parts sont comptées', () => {
    renderJourney();

    const insight = text(panel().querySelector('p.border-t')!);
    expect(insight).toContain('Un ticket livré a passé 74 % de sa vie à attendre, surtout en Prêt.');
    expect(insight).toContain('Les parts sont celles du Lead Time cumulé des 18 Livraisons de la période, soit 120 j.');
    expect(insight).toContain('Le reste, 13 %, est une autre attente');
    expect(insight).toContain('Le Blocage compte pour 2,1 %, dans le tronçon En cours.');
  });

  it('cache le dessin du fil aux lecteurs d’écran : tout ce qu’il montre est écrit', () => {
    renderJourney();

    for (const drawing of panel().querySelectorAll('.journey-tube, .journey-stub, .journey-brace')) expect(drawing.getAttribute('aria-hidden')).toBe('true');
    expect(plain(spokenText(panel()))).toContain('18 % du temps, à attendre une dépendance');
  });

  describe('sans Livraison sur la période', () => {
    const empty = () => emptyMetricsFixture({ health: emptyHealthFixture() });

    it('dessine le fil sans proportions et le dit', () => {
      renderJourney(empty());

      expect(text(panel().querySelector('p.border-t')!)).toBe('Aucune Livraison sur la période : le fil est dessiné sans proportions.');
      for (const key of ['backlog', 'ready', 'work']) expect(stage(key).querySelector('[data-share]')).toBeNull();
    });

    it('dit pourquoi les délais n’ont pas de valeur, sans tendance', () => {
      renderJourney(empty());

      const [lead, cycle] = [...panel().querySelectorAll('.journey-dim')] as HTMLElement[];
      expect(text(lead!)).toContain('Aucune Livraison sur la période.');
      expect(text(cycle!)).toContain('Aucune Livraison démarrée sur la période.');
      expect(panel().querySelector('.journey-dim [data-trend]')).toBeNull();
    });
  });
});
