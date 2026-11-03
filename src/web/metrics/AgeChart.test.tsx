import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router';
import { describe, expect, it } from 'vitest';
import type { MetricsInProgressTicket } from '../../shared/api';
import { AgePanel, VISIBLE_AGES, type AgePanelProps } from './AgeChart';
import type { SeriesContext } from './series';
import { metricsFixture, plain } from './testing';

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
