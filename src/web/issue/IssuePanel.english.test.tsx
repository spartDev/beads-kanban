import { screen, within } from '@testing-library/react';
import { beforeEach, describe, expect, it } from 'vitest';
import { withAsyncTimeout } from '../test/asyncTimeout';
import { chronology, issue, issueDetail, projectsResponse } from '../test/fixtures';
import { setBrowserLanguages } from '../test/languages';
import { renderApp, stubApi } from '../test/render';
import { withTimeZone } from '../test/timeZone';

// Monter toute l'application prend plus d'une seconde quand la machine est chargée : voir `withAsyncTimeout`.
withAsyncTimeout(5_000);

/**
 * Le Panneau de ticket en anglais (« Ticket panel ») : un navigateur anglais et le sélecteur de langue activé, comme les tests du socle. Les termes
 * sont ceux de CONTEXT.md (Timeline, Blockage, Delivery, Dropped…) ; le contenu du ticket (titre, textes, étiquettes, commentaires) n'est jamais
 * traduit.
 */
withTimeZone('Europe/Paris');

beforeEach(() => {
  setBrowserLanguages(['en-US']);
});

const HOUR = 3_600_000;

const DETAIL = issueDetail({
  id: 'bdesk-9',
  title: 'Corriger le décalage du Débit',
  type: 'bug',
  priority: 0,
  status: 'closed',
  assignee: 'spartDev',
  closedAt: '2026-10-05T12:00:00Z',
  parentId: 'bdesk-e1',
  description: '- [x] reproduire\n- [ ] corriger',
  acceptanceCriteria: 'Le graphique **ne bouge plus**.',
  labels: ['métriques'],
  dependencies: [
    { to: 'bdesk-e1', type: 'parent-child' },
    { to: 'bdesk-1', type: 'blocks' },
    { to: 'ext-1', type: 'tracks' },
  ],
  linked: {
    'bdesk-e1': { id: 'bdesk-e1', title: 'Refonte des Métriques', type: 'epic', status: 'open', priority: 1 },
    'bdesk-1': { id: 'bdesk-1', title: 'Lire l’historique', type: 'task', status: 'closed', priority: 2 },
  },
  epic: { id: 'bdesk-e1', title: 'Refonte des Métriques' },
  comments: [{ author: 'spartDev', text: 'Vu sur **Firefox**.', createdAt: '2026-10-03T08:00:00Z' }],
});

const CHRONOLOGY = chronology({
  transitions: [
    { status: 'open', at: '2026-10-01T09:00:00Z', duration: 24 * HOUR },
    { status: 'in_progress', at: '2026-10-02T09:00:00Z', duration: 2 * 24 * HOUR },
    { status: 'closed', at: '2026-10-04T09:00:00Z', duration: 3 * HOUR },
    { status: 'open', at: '2026-10-04T12:00:00Z', duration: 24 * HOUR + 24 * HOUR },
    { status: 'closed', at: '2026-10-05T12:00:00Z', duration: null },
  ],
  blockages: [
    {
      from: '2026-10-01T09:00:00Z',
      to: '2026-10-03T09:00:00Z',
      blockedBy: ['bdesk-1'],
      statusBlocked: false,
      phases: [
        { kind: 'dependencyWait', from: '2026-10-01T09:00:00Z', to: '2026-10-02T09:00:00Z' },
        { kind: 'work', from: '2026-10-02T09:00:00Z', to: '2026-10-03T09:00:00Z' },
      ],
    },
  ],
  outcome: { kind: 'delivered', at: '2026-10-05T12:00:00Z' },
  leadTime: 4 * 24 * HOUR + 3 * HOUR,
  cycleTime: 2 * 24 * HOUR,
  blockedTime: 0,
  reopenings: 1,
});

const openPanel = async () => {
  stubApi({
    projects: projectsResponse,
    issues: { bdesk: [issue({ id: 'bdesk-e1', title: 'Refonte des Métriques', type: 'epic' }), issue({ id: 'bdesk-9', title: DETAIL.title })] },
    details: { 'bdesk/bdesk-9': DETAIL },
    chronologies: { 'bdesk/bdesk-9': CHRONOLOGY },
  });
  const app = renderApp('/p/bdesk/t/bdesk-9', { languageSwitch: true });
  const dialog = await screen.findByRole('dialog', { name: /Corriger le décalage du Débit/ });
  return { ...app, dialog };
};

describe('the Ticket panel, in English', () => {
  it('describes the ticket in English, its own words untouched', async () => {
    const { dialog } = await openPanel();

    expect(within(dialog).getByRole('button', { name: 'Close the panel' })).toBeTruthy();
    const terms = within(dialog).getAllByRole('term').map((term) => term.textContent);
    expect(terms).toEqual(expect.arrayContaining(['Type', 'Priority', 'Status', 'Assigned to', 'Parent', 'Progress']));
    expect(within(dialog).getByText('Status').nextElementSibling?.textContent).toBe('closed');
    expect(within(dialog).getByRole('link', { name: /^Epic: Refonte des Métriques/ })).toBeTruthy();
    expect(within(dialog).getByRole('link', { name: 'Epic page: Refonte des Métriques' }).getAttribute('title')).toBe(
      'Progress, Children, Lead Time and forecast of the Epic “Refonte des Métriques”',
    );
    expect(within(within(dialog).getByRole('list', { name: 'Labels' })).getByText('métriques')).toBeTruthy();
  });

  it('titles its text sections in English and reads the Markdown task list aloud in English', async () => {
    const { dialog } = await openPanel();

    expect(within(dialog).getByRole('heading', { level: 3, name: 'Description' })).toBeTruthy();
    expect(within(dialog).getByRole('heading', { level: 3, name: 'Acceptance criteria' })).toBeTruthy();
    expect(within(dialog).getByRole('heading', { level: 3, name: 'Comments 1' })).toBeTruthy();
    expect(within(dialog).getByText('Done:')).toBeTruthy();
    expect(within(dialog).getByText('To do:')).toBeTruthy();
    expect(within(dialog).getByText('reproduire')).toBeTruthy();
    expect(within(dialog).getByText('Oct 3, 2026, 10:00')).toBeTruthy();
  });

  it('groups its relations in English', async () => {
    const { dialog } = await openPanel();

    const relations = within(dialog).getByRole('region', { name: 'Relations' });
    expect(within(relations).getByRole('list', { name: 'Parent' })).toBeTruthy();
    // Le statut du ticket lié, dans la langue affichée.
    expect(within(within(relations).getByRole('list', { name: 'Blocked by' })).getByText('closed')).toBeTruthy();
    const other = within(relations).getByRole('list', { name: 'Depends on (tracks)' });
    expect(within(other).getByText('outside the Project')).toBeTruthy();
  });

  it('tells its Timeline in English, with the glossary’s terms and English durations', async () => {
    const { dialog } = await openPanel();

    const timeline = await within(dialog).findByRole('region', { name: 'Timeline' });
    expect(await within(timeline).findByText(`Delivery on Oct 5, 2026, 14:00 · Reopened once`)).toBeTruthy();
    expect(within(timeline).getByText('Lead Time')).toBeTruthy();
    expect(within(timeline).getByText('Blocked time during work')).toBeTruthy();
    expect(within(timeline).getByText('None')).toBeTruthy();
    expect(within(timeline).getByText('Times in the Europe/Paris time zone')).toBeTruthy();

    const transitions = within(timeline).getByRole('list', { name: 'Transitions' });
    const rows = within(transitions).getAllByRole('listitem').map((row) => row.textContent);
    expect(rows[0]).toMatch(/^Created.*Oct 1, 2026, 11:00.*for 1\sd/);
    expect(rows[1]).toMatch(/^In progress.*Oct 2, 2026, 11:00.*for 2\sd/);
    expect(rows[2]).toMatch(/^Closed/);
    expect(rows[3]).toMatch(/^Reopened/);
    expect(rows[4]).toMatch(/^Closed/);

    const blockages = within(timeline).getByRole('list', { name: 'Blockages' });
    expect(within(blockages).getByText(/waiting on/)).toBeTruthy();
    expect(within(blockages).getByText(/before the first start, then/)).toBeTruthy();
    expect(within(blockages).getByText(/during work/)).toBeTruthy();
    expect(within(timeline).getByText('Only the Blockage during work counts toward blocked time.')).toBeTruthy();
  });

  it('says a ticket is not found, in English, with a way back to the kanban', async () => {
    stubApi({ projects: projectsResponse, issues: { bdesk: [] } });
    renderApp('/p/bdesk/t/bdesk-404', { languageSwitch: true });

    const dialog = await screen.findByRole('dialog', { name: /Ticket not found/ });
    expect(within(dialog).getByRole('button', { name: 'Back to the kanban' })).toBeTruthy();
    expect(within(dialog).getByText(/the palette \(⌘K\) can search every Project/)).toBeTruthy();
  });
});
