import { fireEvent, render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { BLANK_TITLES, UNTITLED } from '../test/blankTitles';
import { AgePanel } from './AgeChart';
import { CycleTimePanel } from './CycleTimeChart';
import { ReadyAgePanel } from './ReadyAgeChart';
import type { SeriesContext } from './series';
import { healthFixture, metricsFixture, stubChartWidth } from './testing';

/**
 * Les tickets sans titre dans les graphiques et leurs tableaux de données (bdesk-38k.54). Un ticket est nommé par son identifiant et son titre : vide, fait
 * d'espaces ou de caractères sans largeur, le titre ne laissait que son identifiant et un texte invisible, dans la liste des tickets en cours, celle des Prêts,
 * l'infobulle du nuage de points et chaque tableau. Chacun dit ce que disent le panneau et la carte du kanban (bdesk-38k.50) : « Sans titre » (`ticketTitle`),
 * puisque l'identifiant est écrit juste à côté.
 */

beforeEach(() => stubChartWidth(640));
afterEach(() => vi.restoreAllMocks());

const ctx: SeriesContext = {
  projectName: (id) => ({ bdesk: 'beads-desktop', mpm: 'My-Prompt-Manager' })[id] ?? id,
  projectHue: (id) => (id === 'bdesk' ? 200 : 40),
};

const renderInRouter = (ui: React.ReactElement) => render(<MemoryRouter>{ui}</MemoryRouter>);

describe.each(BLANK_TITLES)('les graphiques, pour un ticket dont le titre est %s', (_kind, blank) => {
  describe('la liste des tickets en cours', () => {
    const data = metricsFixture();
    const tickets = data.inProgress.map((ticket, index) => (index === 0 ? { ...ticket, title: blank } : ticket));

    it('écrit « Sans titre » pour ce ticket, et laisse aux autres leur titre', () => {
      renderInRouter(
        <AgePanel tickets={tickets} dimension="type" ctx={ctx} projectOrder={['bdesk', 'mpm']} median={data.tiles.cycleTime.median} p85={data.tiles.cycleTime.p85} showProject />,
      );

      const rows = within(screen.getByRole('list', { name: 'Tickets en cours, du plus ancien au plus récent' })).getAllByRole('listitem');

      expect(within(rows[0]!).getByText(UNTITLED)).toBeTruthy();
      expect(within(rows[0]!).getByText('mpm-old')).toBeTruthy();
      expect(within(rows[1]!).getByText('Un ticket bloqué')).toBeTruthy();
      expect(screen.getAllByText(UNTITLED)).toHaveLength(1);
    });
  });

  describe('la liste des Prêts qui stagnent et son tableau', () => {
    const base = healthFixture().readyAges;
    const ages = { ...base, tickets: base.tickets.map((ticket, index) => (index === 0 ? { ...ticket, title: blank } : ticket)) };
    const panel = (
      <ReadyAgePanel ages={ages} dimension="type" ctx={ctx} projectOrder={['bdesk', 'mpm']} showProject timeZone="Europe/Paris" moment="à 20:00" />
    );

    it('écrit « Sans titre » pour ce Prêt, dans la liste', () => {
      renderInRouter(panel);

      const rows = within(screen.getByRole('list', { name: 'Prêts, du plus ancien au plus récent' })).getAllByRole('listitem');

      expect(within(rows[0]!).getByText(UNTITLED)).toBeTruthy();
      expect(within(rows[0]!).getByText('mpm-r1')).toBeTruthy();
      expect(within(rows[1]!).getByText('Prêt mpm-r2')).toBeTruthy();
    });

    it('l’écrit aussi dans le tableau des données', async () => {
      renderInRouter(panel);
      await userEvent.setup().click(screen.getByText('Données du graphique'));

      const row = within(screen.getByRole('table', { name: 'Prêts à 20:00' })).getByRole('row', { name: /mpm-r1/ });

      expect(within(row).getByText(UNTITLED)).toBeTruthy();
      expect(within(row).getByText('mpm-r1')).toBeTruthy();
      expect(screen.getAllByText(UNTITLED)).toHaveLength(2); // la liste, puis le tableau
    });
  });

  describe('le nuage de points du Cycle Time et son tableau', () => {
    const data = metricsFixture();
    const points = data.cycleTimeScatter.map((point, index) => (index === 4 ? { ...point, title: blank } : point));
    const panel = (
      <CycleTimePanel
        points={points}
        span={{ from: data.period.from, days: data.period.days, start: Date.parse(data.period.start), end: Date.parse(data.asOf) }}
        dimension="type"
        ctx={ctx}
        projectOrder={['bdesk', 'mpm']}
        timeZone={data.timeZone}
        median={data.tiles.cycleTime.median}
        p85={data.tiles.cycleTime.p85}
        showProject
      />
    );

    it('écrit « Sans titre » dans l’infobulle de la Livraison, sous son identifiant', () => {
      const { container } = renderInRouter(panel);
      const dot = container.querySelectorAll<SVGCircleElement>('[data-dot]')[4]!;

      fireEvent.pointerMove(container.querySelector('[data-chart-hit]')!, {
        clientX: Number(dot.getAttribute('cx')) + 3,
        clientY: Number(dot.getAttribute('cy')) - 2,
        pointerType: 'mouse',
      });

      const tooltip = container.querySelector<HTMLElement>('[data-chart-tooltip]')!;
      expect(within(tooltip).getByText('mpm-e5')).toBeTruthy();
      expect(within(tooltip).getByText(UNTITLED)).toBeTruthy();
    });

    it('l’écrit aussi dans le tableau des données', async () => {
      renderInRouter(panel);
      await userEvent.setup().click(screen.getByText('Données du graphique'));

      const row = within(screen.getByRole('table')).getByRole('row', { name: /mpm-e5/ });

      expect(within(row).getByText(UNTITLED)).toBeTruthy();
      expect(within(row).getByText('mpm-e5')).toBeTruthy();
      expect(screen.getAllByText(UNTITLED)).toHaveLength(1);
    });
  });
});

describe('les graphiques, pour un titre qui a du texte', () => {
  it('range ses espaces : une seule espace entre les mots, aucune autour, comme dans la liste des tickets', () => {
    const base = healthFixture().readyAges;
    const ages = { ...base, tickets: base.tickets.map((ticket, index) => (index === 0 ? { ...ticket, title: '  Un   Prêt \t à   espaces ' } : ticket)) };

    renderInRouter(<ReadyAgePanel ages={ages} dimension="type" ctx={ctx} projectOrder={['bdesk', 'mpm']} showProject timeZone="Europe/Paris" moment="à 20:00" />);

    // Sans `normalizer` : Testing Library replie déjà les espaces du texte qu'elle compare, et ne verrait pas les doubles.
    expect(screen.getAllByText('Un Prêt à espaces', { normalizer: (text) => text })).toHaveLength(2); // la liste, puis le tableau (replié, mais dans la page)
    expect(screen.queryByText(UNTITLED)).toBeNull();
  });
});
