import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router';
import { describe, expect, it } from 'vitest';
import type { MetricsInProgressTicket } from '../../shared/api';
import { AgePanel, VISIBLE_AGES, type AgePanelProps } from './AgeChart';
import type { SeriesContext } from './series';
import { metricsFixture, plain, shownText, spokenText } from './testing';

const DAY = 86_400_000;

const ctx: SeriesContext = {
  projectName: (id) => ({ bdesk: 'beads-desktop', mpm: 'My-Prompt-Manager' })[id] ?? id,
  projectHue: () => 120,
};

function props(overrides: Partial<AgePanelProps> = {}): AgePanelProps {
  const data = metricsFixture();
  return {
    tickets: data.inProgress,
    dimension: 'type',
    ctx,
    projectOrder: ['bdesk', 'mpm'],
    median: data.tiles.cycleTime.median,
    p85: data.tiles.cycleTime.p85,
    showProject: true,
    ...overrides,
  };
}

const renderPanel = (overrides: Partial<AgePanelProps> = {}) =>
  render(
    <MemoryRouter>
      <AgePanel {...props(overrides)} />
    </MemoryRouter>,
  );

const list = () => screen.getByRole('list', { name: 'Tickets en cours, du plus ancien au plus récent' });
const rows = () => within(list()).getAllByRole('listitem');

describe('AgePanel : l’âge des tickets en cours', () => {
  it('liste les tickets du plus ancien au plus récent, avec leur âge', () => {
    renderPanel();

    expect(rows().map((row) => row.getAttribute('data-ticket'))).toEqual(['mpm-old', 'bdesk-mid', 'bdesk-new']);
    expect(plain(rows()[0]?.textContent)).toContain('189 j');
    expect(plain(rows()[1]?.textContent)).toContain('34 j');
    expect(plain(rows()[2]?.textContent)).toContain('2 h');
  });

  it('mène chaque ticket à sa fiche', () => {
    renderPanel();

    expect(within(rows()[0]!).getByRole('link').getAttribute('href')).toBe('/p/mpm/t/mpm-old');
    expect(within(rows()[1]!).getByRole('link').getAttribute('href')).toBe('/p/bdesk/t/bdesk-mid');
  });

  it('dessine des barres proportionnelles à l’âge, sur une échelle commune', () => {
    const { container } = renderPanel();

    const widths = [...container.querySelectorAll<HTMLElement>('[data-age-bar]')].map((bar) => parseFloat(bar.style.width));
    // Le plus vieux (189 j) remplit presque la piste, le suivant (34 j) en fait 18 %, le plus récent (2 h) presque rien.
    expect(widths[0]).toBeGreaterThan(94);
    expect(widths[0]).toBeLessThan(100);
    expect(widths[1]).toBeCloseTo((widths[0]! * 34) / 189, 5);
    expect(widths[2]).toBeLessThan(0.5);
  });

  it('colore chaque barre du découpage choisi', () => {
    const { container } = renderPanel({ dimension: 'type' });

    expect([...container.querySelectorAll<HTMLElement>('[data-age-bar]')].map((bar) => bar.style.background)).toEqual([
      'var(--type-bug)',
      'var(--type-task)',
      'var(--type-feature)',
    ]);
  });

  it('marque la médiane et le P85 du Cycle Time sur chaque barre, aux mêmes positions', () => {
    const { container } = renderPanel();

    const medians = [...container.querySelectorAll<HTMLElement>('[data-age-marker="median"]')].map((marker) => parseFloat(marker.style.left));
    const p85s = [...container.querySelectorAll<HTMLElement>('[data-age-marker="p85"]')].map((marker) => parseFloat(marker.style.left));
    expect(medians).toHaveLength(3);
    expect(new Set(medians).size).toBe(1);
    expect(new Set(p85s).size).toBe(1);
    expect(p85s[0]).toBeGreaterThan(medians[0]!);
    expect(plain(screen.getByRole('list', { name: 'Repères' }).textContent)).toBe('Médiane du Cycle Time 2,1 jP85 2,3 j');
  });

  it('signale les tickets plus vieux que le P85 du Cycle Time', () => {
    renderPanel();

    expect(within(rows()[0]!).getByText('au-delà du P85')).toBeTruthy();
    expect(within(rows()[1]!).getByText('au-delà du P85')).toBeTruthy();
    expect(within(rows()[2]!).queryByText('au-delà du P85')).toBeNull();
  });

  it('signale un ticket bloqué et un ticket rattaché à un agent', () => {
    renderPanel();

    expect(within(rows()[1]!).getByText('Bloqué')).toBeTruthy();
    expect(within(rows()[2]!).getByText('Agent')).toBeTruthy();
    expect(within(rows()[0]!).queryByText('Bloqué')).toBeNull();
  });

  it('nomme le Projet de chaque ticket quand il y en a plusieurs', () => {
    renderPanel({ showProject: true });
    expect(within(rows()[0]!).getByText('My-Prompt-Manager')).toBeTruthy();
  });

  it('ne nomme pas le Projet quand il n’y en a qu’un', () => {
    renderPanel({ showProject: false });
    expect(within(rows()[0]!).queryByText('My-Prompt-Manager')).toBeNull();
  });

  it('se passe des repères quand le Cycle Time n’est pas défini', () => {
    const { container } = renderPanel({ median: null, p85: null });

    expect(screen.queryByRole('list', { name: 'Repères' })).toBeNull();
    expect(container.querySelectorAll('[data-age-marker]')).toHaveLength(0);
    expect(within(rows()[0]!).queryByText('au-delà du P85')).toBeNull();
  });

  it('dit qu’aucun ticket n’est en cours', () => {
    renderPanel({ tickets: [] });
    expect(screen.getByText('Aucun ticket en cours.')).toBeTruthy();
    expect(screen.queryByRole('list', { name: /Tickets en cours/ })).toBeNull();
  });

  it('replie la liste au-delà de douze tickets, et la déplie à la demande', async () => {
    const user = userEvent.setup();
    const many: MetricsInProgressTicket[] = Array.from({ length: 15 }, (_, index) => ({
      id: `bdesk-${index}`,
      title: `Ticket ${index}`,
      type: 'task',
      priority: 2,
      project: 'bdesk',
      status: 'in_progress',
      blocked: false,
      startedAt: '2026-10-01T09:00:00.000Z',
      age: (30 - index) * DAY,
    }));
    renderPanel({ tickets: many });

    expect(rows()).toHaveLength(VISIBLE_AGES);
    await user.click(screen.getByRole('button', { name: 'Afficher les 3 autres' }));
    expect(rows()).toHaveLength(15);
    await user.click(screen.getByRole('button', { name: 'Réduire la liste' }));
    expect(rows()).toHaveLength(VISIBLE_AGES);
  });
});

describe('AgePanel : ce que lit un lecteur d’écran', () => {
  /** Ce que l'œil lit, et ce que l'oreille entend : « < 1 min » s'écrit avec un chevron et se dit « moins d’une minute ». */
  const shown = (element: Element) => plain(shownText(element));
  const heard = (element: Element) => plain(spokenText(element));
  const times = (text: string, part: string) => text.split(part).length - 1;

  const quick = () => [{ ...metricsFixture().inProgress[0]!, id: 'x-1', age: 10_000 }];

  it('un ticket en cours depuis 10 s s’écrit « < 1 min » et se dit « moins d’une minute », une seule fois', () => {
    renderPanel({ tickets: quick(), median: null, p85: null, showProject: false });
    const item = rows()[0]!;

    expect(shown(item)).toContain('< 1 min');
    expect(heard(item)).not.toMatch(/[<>]/);
    // Ni le chevron puis les mots (« < 1 min (moins d’une minute) »), ni les mots deux fois.
    expect(times(heard(item), 'moins d’une minute')).toBe(1);
    expect(plain(item.textContent)).toContain('< 1 minmoins d’une minute');
  });

  it('les repères de la médiane et du P85 du Cycle Time sous 30 s s’écrivent « < 1 min » et se disent « moins d’une minute »', () => {
    renderPanel({ median: 10_000, p85: 20_000 });
    const markers = screen.getByRole('list', { name: 'Repères' });

    expect(shown(markers)).toBe('Médiane du Cycle Time < 1 minP85 < 1 min');
    expect(heard(markers)).toBe('Médiane du Cycle Time moins d’une minuteP85 moins d’une minute');
  });

  it('un âge qui s’écrit sans chevron garde sa version en toutes lettres : « 189 j (189 jours) », « 2 h (2 heures) »', () => {
    renderPanel();

    expect(heard(rows()[0]!)).toContain('189 j (189 jours)');
    expect(heard(rows()[2]!)).toContain('2 h (2 heures)');
    expect(shown(rows()[0]!)).not.toContain('189 jours');
  });

  // Le navigateur l'a montré : le <li> d'un repère est un conteneur flex (`inline-flex gap-1.5`), dont chaque enfant en flux est séparé du
  // suivant par l'écart. Une étiquette en plusieurs nœuds (« Médiane du Cycle Time » puis « < 1 min ») perdait son espace au profit de cet
  // écart. Le texte caché aux lecteurs d'écran (`sr-only`) est positionné hors flux : il n'est pas un enfant de la mise en page.
  it.each([
    ['sous 30 s (avec chevron)', 10_000, 20_000],
    ['sans chevron', 2 * DAY, 3 * DAY],
  ])('repères %s : un seul enfant en flux après le trait, pour que l’écart du conteneur flex ne coupe pas l’étiquette', (_name, median, p85) => {
    renderPanel({ median, p85 });

    const markers = [...screen.getByRole('list', { name: 'Repères' }).querySelectorAll('li')];
    expect(markers).toHaveLength(2);
    for (const marker of markers) {
      const inFlow = [...marker.childNodes].filter((node) => !(node instanceof HTMLElement && node.classList.contains('sr-only')));
      expect(inFlow).toHaveLength(2);
    }
  });

  it('les repères sans chevron restent un seul morceau de texte', () => {
    renderPanel();
    const markers = [...screen.getByRole('list', { name: 'Repères' }).querySelectorAll('li')];

    expect(markers.map((marker) => plain(marker.textContent))).toEqual(['Médiane du Cycle Time 2,1 j', 'P85 2,3 j']);
    expect(markers.every((marker) => marker.querySelector('.sr-only') === null)).toBe(true);
  });
});
