import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router';
import { describe, expect, it } from 'vitest';
import type { MetricsReadyAges, MetricsReadyTicket } from '../../shared/api';
import { ReadyAgePanel, type ReadyAgePanelProps } from './ReadyAgeChart';
import type { SeriesContext } from './series';
import { emptyHealthFixture, healthFixture, plain, shownText, spokenText } from './testing';

const HOUR = 3_600_000;
const DAY = 24 * HOUR;

const ctx: SeriesContext = {
  projectName: (id) => ({ bdesk: 'beads-desktop', mpm: 'My-Prompt-Manager' })[id] ?? id,
  projectHue: () => 120,
};

function props(overrides: Partial<ReadyAgePanelProps> = {}): ReadyAgePanelProps {
  return { ages: healthFixture().readyAges, dimension: 'type', ctx, projectOrder: ['bdesk', 'mpm'], showProject: true, timeZone: 'Europe/Paris', moment: 'à 20:00', ...overrides };
}

const renderPanel = (overrides: Partial<ReadyAgePanelProps> = {}) =>
  render(
    <MemoryRouter>
      <ReadyAgePanel {...props(overrides)} />
    </MemoryRouter>,
  );

const list = () => screen.getByRole('list', { name: 'Prêts, du plus ancien au plus récent' });
const rows = () => within(list()).getAllByRole('listitem');

/** Fixture : cinq Prêts, de 40 j à 5 h ; trois stagnent (plus de 14 j). */
describe('ReadyAgePanel : les Prêts qui stagnent', () => {
  it('dit ce qu’est un Prêt, combien stagnent, et à partir de quand', () => {
    renderPanel();

    expect(screen.getByRole('region', { name: 'Prêts qui stagnent' })).toBeTruthy();
    expect(
      screen.getByText('Les tickets ouverts sans dépendance bloquante en suspens à 20:00, du plus ancien au plus récent. 3 des 5 le sont depuis plus de 14 j.'),
    ).toBeTruthy();
  });

  it('dit à quel instant les Prêts sont mesurés : maintenant, ou la fin d’une période terminée', async () => {
    const user = userEvent.setup();
    renderPanel({ moment: 'à la fin de la période' });

    expect(screen.getByText(/^Les tickets ouverts sans dépendance bloquante en suspens à la fin de la période, du plus ancien/)).toBeTruthy();
    await user.click(screen.getByText('Données du graphique'));
    expect(screen.getByRole('table', { name: 'Prêts à la fin de la période' })).toBeTruthy();
  });

  it.each([
    [0, 5, 'Aucun ne l’est depuis plus de 14 j.'],
    [1, 5, '1 des 5 l’est depuis plus de 14 j.'],
    [3, 5, '3 des 5 le sont depuis plus de 14 j.'],
    [5, 5, 'Tous le sont depuis plus de 14 j.'],
    [1, 1, 'Il l’est depuis plus de 14 j.'],
  ])('accorde la phrase : %i Prêt(s) qui stagnent sur %i', (stagnant, total, sentence) => {
    const base = healthFixture().readyAges;
    const tickets = Array.from({ length: total }, (_, index) => ({ ...base.tickets[0]!, id: `mpm-${index}`, stagnant: index < stagnant }));
    renderPanel({ ages: { ...base, tickets, stagnant } });

    expect(plain(screen.getByText(/^Les tickets ouverts/).textContent)).toBe(`Les tickets ouverts sans dépendance bloquante en suspens à 20:00, du plus ancien au plus récent. ${sentence}`);
  });

  it('liste les Prêts du plus ancien au plus récent, avec leur âge en jours et en heures', () => {
    renderPanel();

    expect(rows().map((row) => row.getAttribute('data-ticket'))).toEqual(['mpm-r1', 'mpm-r2', 'bdesk-r3', 'mpm-r4', 'bdesk-r5']);
    expect(plain(rows()[0]?.textContent)).toContain('40 j 10 h');
    expect(plain(rows()[3]?.textContent)).toContain('3 j 10 h');
    expect(plain(rows()[4]?.textContent)).toContain('5 h');
  });

  it('lit de quel côté du seuil est chaque Prêt : « 13 j 14 h » et « 14 j 10 h · stagne » ne s’écrivent pas tous deux « 14 j »', () => {
    const ticket = (id: string, age: number): MetricsReadyTicket => ({ id, title: id, type: 'task', priority: 2, project: 'bdesk', since: '2026-10-01T00:00:00.000Z', age, stagnant: age > 14 * DAY });
    const tickets = [ticket('a', 14 * DAY + 10 * HOUR), ticket('b', 13 * DAY + 14 * HOUR)];
    renderPanel({ ages: { stagnantAfter: 14 * DAY, tickets, stagnant: 1, trend: { previous: null, delta: null, ratio: null } }, showProject: false });

    const [stagnant, recent] = rows().map((row) => plain(row.textContent));
    // Les deux lignes se lisent différemment, et seule la première porte le repère.
    expect(stagnant).toBe('a14 j 10 h (14 jours 10 heures)astagne');
    expect(recent).toBe('b13 j 14 h (13 jours 14 heures)b');
    expect(plain(stagnant)).not.toMatch(/^a14 j \(/);
  });

  it('n’écrit jamais « 14 j » à côté de « stagne » : le premier quart d’heure au-delà du seuil se lit « 14 j 1 h »', () => {
    const ticket = (id: string, age: number): MetricsReadyTicket => ({ id, title: id, type: 'task', priority: 2, project: 'bdesk', since: '2026-10-01T00:00:00.000Z', age, stagnant: age > 14 * DAY });
    const tickets = [ticket('a', 14 * DAY + 15 * 60_000), ticket('b', 14 * DAY)];
    renderPanel({ ages: { stagnantAfter: 14 * DAY, tickets, stagnant: 1, trend: { previous: null, delta: null, ratio: null } }, showProject: false });

    expect(rows().map((row) => plain(row.textContent))).toEqual(['a14 j 1 h (14 jours 1 heure)astagne', 'b14 j (14 jours)b']);
  });

  it('dit l’âge en toutes lettres pour les lecteurs d’écran, comme à l’écran : jours et heures', () => {
    renderPanel();

    expect(rows().map((row) => plain(row.querySelector('.sr-only')?.textContent))).toEqual([
      ' (40 jours 10 heures)',
      ' (17 jours 10 heures)',
      ' (15 jours 10 heures)',
      ' (3 jours 10 heures)',
      ' (5 heures)',
    ]);
  });

  it('mène chaque ticket à sa fiche', () => {
    renderPanel();

    expect(within(rows()[0]!).getByRole('link').getAttribute('href')).toBe('/p/mpm/t/mpm-r1');
    expect(within(rows()[2]!).getByRole('link').getAttribute('href')).toBe('/p/bdesk/t/bdesk-r3');
  });

  it('dit en toutes lettres qu’un Prêt stagne, jamais par la seule couleur de la barre', () => {
    renderPanel();

    expect(rows().map((row) => /stagne/.test(plain(row.textContent)))).toEqual([true, true, true, false, false]);
    expect(rows().map((row) => row.getAttribute('data-stagnant'))).toEqual(['', '', '', null, null]);
  });

  it('dessine des barres proportionnelles à l’âge, avec un repère au seuil de stagnation', () => {
    const { container } = renderPanel();

    const widths = [...container.querySelectorAll<HTMLElement>('[data-age-bar]')].map((bar) => Number.parseFloat(bar.style.width));
    expect(widths[0]).toBeGreaterThan(widths[1]!);
    expect(widths[1]).toBeGreaterThan(widths[3]!);
    const marker = container.querySelector<HTMLElement>('[data-age-marker="stagnant"]');
    expect(marker).toBeTruthy();
    // Sur une échelle commune, le seuil de 14 j est sous la barre la plus longue (40 j) et au-dessus de la plus courte.
    expect(Number.parseFloat(marker!.style.left)).toBeLessThan(widths[0]!);
  });

  it('nomme le repère dans la légende', () => {
    renderPanel();

    expect(plain(screen.getByRole('list', { name: 'Repère' }).textContent)).toContain('Seuil de stagnation 14 j');
  });

  it('nomme le Projet des Prêts quand il y en a plusieurs, et pas autrement', () => {
    renderPanel();
    expect(plain(rows()[0]?.textContent)).toContain('My-Prompt-Manager');
  });

  it('ne nomme pas le Projet d’un Projet seul', () => {
    renderPanel({ showProject: false });
    expect(plain(rows()[0]?.textContent)).not.toContain('My-Prompt-Manager');
  });

  it('replie la liste au-delà de douze Prêts, et la déplie à la demande', async () => {
    const user = userEvent.setup();
    const many: MetricsReadyTicket[] = Array.from({ length: 15 }, (_, index) => ({
      id: `mpm-${index}`,
      title: `Prêt ${index}`,
      type: 'task',
      priority: 2,
      project: 'mpm',
      since: '2026-10-01T00:00:00.000Z',
      age: (30 - index) * DAY,
      stagnant: true,
    }));
    const ages: MetricsReadyAges = { ...healthFixture().readyAges, tickets: many, stagnant: 15 };
    renderPanel({ ages });

    expect(rows()).toHaveLength(12);
    await user.click(screen.getByRole('button', { name: 'Afficher les 3 autres' }));
    expect(rows()).toHaveLength(15);
    await user.click(screen.getByRole('button', { name: 'Réduire la liste' }));
    expect(rows()).toHaveLength(12);
  });

  it('n’offre pas de liste à déplier quand tous les Prêts tiennent : douze Prêts, pas de bouton', () => {
    const base = healthFixture().readyAges;
    const twelve = Array.from({ length: 12 }, (_, index) => ({ ...base.tickets[0]!, id: `mpm-${index}`, age: (30 - index) * DAY }));
    renderPanel({ ages: { ...base, tickets: twelve, stagnant: 12 } });

    expect(rows()).toHaveLength(12);
    expect(screen.queryByRole('button', { name: /autres|Réduire/ })).toBeNull();
  });

  it('range tous les Prêts en tableau, même ceux que la liste replie', async () => {
    const user = userEvent.setup();
    renderPanel();

    await user.click(screen.getByText('Données du graphique'));
    const table = screen.getByRole('table', { name: 'Prêts à 20:00' });
    const body = within(table).getAllByRole('row');

    expect(body).toHaveLength(6);
    expect(within(body[0]!).getAllByRole('columnheader').map((header) => header.textContent)).toEqual(['Ticket', 'Projet', 'Prêt depuis', 'Âge', 'Stagne']);
    expect(within(body[1]!).getAllByRole('cell').map((cell) => plain(cell.textContent))).toEqual(['My-Prompt-Manager', '23 sept. 2026', '40 j 10 h', 'Oui']);
    expect(within(body[5]!).getAllByRole('cell').map((cell) => plain(cell.textContent))).toEqual(['beads-desktop', '2 nov. 2026', '5 h', 'Non']);
  });

  it('dit qu’il n’y a aucun Prêt', () => {
    renderPanel({ ages: emptyHealthFixture().readyAges });

    expect(screen.getByText('Aucun ticket Prêt.')).toBeTruthy();
    expect(screen.queryByRole('list', { name: 'Prêts, du plus ancien au plus récent' })).toBeNull();
  });
});

describe('ReadyAgePanel : ce que lit un lecteur d’écran', () => {
  /** Ce que l'œil lit, et ce que l'oreille entend : « < 1 min » s'écrit avec un chevron et se dit « moins d’une minute ». */
  const shown = (element: Element) => plain(shownText(element));
  const heard = (element: Element) => plain(spokenText(element));
  const times = (text: string, part: string) => text.split(part).length - 1;

  /** Un Prêt créé il y a 10 s, et un autre il y a 12 min. */
  function renderFresh() {
    const base = healthFixture().readyAges;
    const tickets = [
      { ...base.tickets[0]!, id: 'x-2', age: 10_000, stagnant: false },
      { ...base.tickets[0]!, id: 'x-3', age: 12 * 60_000, stagnant: false },
    ];
    return renderPanel({ ages: { ...base, tickets, stagnant: 0 }, showProject: false });
  }

  it('un Prêt créé il y a 10 s s’écrit « < 1 min » et se dit « moins d’une minute », une seule fois', () => {
    renderFresh();
    const item = rows()[0]!;

    expect(shown(item)).toContain('< 1 min');
    expect(heard(item)).not.toMatch(/[<>]/);
    expect(times(heard(item), 'moins d’une minute')).toBe(1);
    expect(plain(item.textContent)).toContain('< 1 minmoins d’une minute');
  });

  it('un âge qui s’écrit sans chevron garde sa version en toutes lettres : « 12 min (12 minutes) »', () => {
    renderFresh();

    expect(heard(rows()[1]!)).toContain('12 min (12 minutes)');
    expect(shown(rows()[1]!)).not.toContain('12 minutes');
  });

  it('le tableau des données dit « moins d’une minute » d’un âge sous 30 s, sans le chevron, et garde « 12 min » tel quel', async () => {
    const user = userEvent.setup();
    renderFresh();

    await user.click(screen.getByText('Données du graphique'));
    const cells = within(screen.getByRole('table')).getAllByRole('row').slice(1).map((row) => within(row).getAllByRole('cell').at(-2)!);

    expect(cells.map((cell) => shown(cell))).toEqual(['< 1 min', '12 min']);
    expect(cells.map((cell) => heard(cell))).toEqual(['moins d’une minute', '12 min']);
  });
});
