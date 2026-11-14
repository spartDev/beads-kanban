import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router';
import { describe, expect, it } from 'vitest';
import type { MetricsReworkTicket } from '../../shared/api';
import { ReworkPanel, type ReworkPanelProps } from './ReworkPanel';
import type { SeriesContext } from './series';
import { healthFixture } from './testing';

const ctx: SeriesContext = {
  projectName: (id) => ({ bdesk: 'beads-desktop', mpm: 'My-Prompt-Manager' })[id] ?? id,
  projectHue: () => 120,
};

const renderPanel = (overrides: Partial<ReworkPanelProps> = {}) =>
  render(
    <MemoryRouter>
      <ReworkPanel rework={healthFixture().rework} ctx={ctx} showProject {...overrides} />
    </MemoryRouter>,
  );

const list = () => screen.getByRole('list', { name: 'Tickets en Retravail' });
const rows = () => within(list()).getAllByRole('listitem');

const reworked = (index: number): MetricsReworkTicket => ({
  id: `bdesk-${index}`,
  title: `Ticket ${index}`,
  type: 'task',
  priority: 2,
  project: 'bdesk',
  reopenings: 1,
  returns: 0,
  originBugs: [],
  lastAt: '2026-10-20T09:00:00.000Z',
});

describe('ReworkPanel : les tickets qui reviennent', () => {
  it('nomme chaque ticket, son Projet et ses causes, et mène à sa fiche', () => {
    renderPanel();

    expect(screen.getByRole('region', { name: 'Retravail' })).toBeTruthy();
    const [first, second] = rows();
    const link = within(first as HTMLElement).getByRole('link', { name: /^Palette ⌘K/ });
    expect(link.getAttribute('href')).toBe('/p/bdesk/t/bdesk-r1');
    expect(first?.textContent).toContain('beads-desktop');
    expect(first?.textContent).toContain('2 Réouvertures');
    expect(first?.textContent).toContain('Bug d’origine bdesk-b9');
    expect(second?.textContent).toContain('1 Prise rendue');
    expect(second?.textContent).toContain('My-Prompt-Manager');
  });

  it('tait le Projet quand la page n’en mesure qu’un', () => {
    renderPanel({ showProject: false });

    expect(rows()[0]?.textContent).not.toContain('beads-desktop');
  });

  it('montre les 10 premiers et déplie les autres à la demande', async () => {
    const user = userEvent.setup();
    renderPanel({ rework: { tickets: Array.from({ length: 13 }, (_, i) => reworked(i + 1)) } });

    expect(rows()).toHaveLength(10);
    await user.click(screen.getByRole('button', { name: 'Afficher les 3 autres' }));
    expect(rows()).toHaveLength(13);
  });

  it('dit qu’aucun ticket n’est revenu sur la période', () => {
    renderPanel({ rework: { tickets: [] } });

    expect(screen.getByText('Aucun ticket n’est revenu sur la période : ni Réouverture, ni Prise rendue, ni Bug d’origine.')).toBeTruthy();
    expect(screen.queryByRole('list', { name: 'Tickets en Retravail' })).toBeNull();
  });
});
