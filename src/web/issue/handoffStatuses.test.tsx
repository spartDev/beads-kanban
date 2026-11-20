import { screen, within } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { withAsyncTimeout } from '../test/asyncTimeout';
import { chronology, issue, issueDetail, projectsResponse } from '../test/fixtures';
import { setBrowserLanguages } from '../test/languages';
import { renderApp, stubApi } from '../test/render';
import { withTimeZone } from '../test/timeZone';

/**
 * Les Statuts de relais dans le Panneau de ticket et sa Chronologie (bdesk-pz0.4) : chacun écrit par son nom, en français et en anglais (les termes
 * de CONTEXT.md), jamais par le nom brut que porte le ticket.
 */

withAsyncTimeout(5_000);
withTimeZone('Europe/Paris');

const HOUR = 3_600_000;

const DETAIL = issueDetail({ id: 'bdesk-9', title: 'Brancher la recette', status: 'awaiting_human' });

const CHRONOLOGY = chronology({
  transitions: [
    { status: 'open', at: '2026-10-01T09:00:00Z', duration: 24 * HOUR },
    { status: 'in_progress', at: '2026-10-02T09:00:00Z', duration: 5 * HOUR },
    { status: 'in_review', at: '2026-10-02T14:00:00Z', duration: 2 * HOUR },
    { status: 'in_integration', at: '2026-10-02T16:00:00Z', duration: 3 * HOUR },
    { status: 'awaiting_human', at: '2026-10-02T19:00:00Z', duration: null },
  ],
});

async function openPanel(language?: 'en') {
  if (language) setBrowserLanguages(['en-US']);
  stubApi({
    projects: projectsResponse,
    issues: { bdesk: [issue({ id: 'bdesk-9', title: DETAIL.title, status: 'awaiting_human' })] },
    details: { 'bdesk/bdesk-9': DETAIL },
    chronologies: { 'bdesk/bdesk-9': CHRONOLOGY },
  });
  renderApp('/p/bdesk/t/bdesk-9', { languageSwitch: true });
  const dialog = await screen.findByRole('dialog', { name: /Brancher la recette/ });
  const transitions = await within(dialog).findByRole('list', { name: 'Transitions' });
  return { dialog, rows: within(transitions).getAllByRole('listitem').map((row) => row.textContent ?? '') };
}

describe('les Statuts de relais dans le Panneau de ticket', () => {
  it('écrit le statut du ticket et chaque étape de sa Chronologie par leur nom', async () => {
    const { dialog, rows } = await openPanel();

    expect(within(dialog).getByText('Statut').nextElementSibling?.textContent).toBe('à valider');
    expect(rows[2]).toMatch(/^En relecture/);
    expect(rows[3]).toMatch(/^En intégration/);
    expect(rows[4]).toMatch(/^À valider/);
    expect(rows.join(' ')).not.toMatch(/in_review|in_integration|awaiting_human/);
  });

  it('en anglais, avec les termes de CONTEXT.md', async () => {
    const { dialog, rows } = await openPanel('en');

    expect(within(dialog).getByText('Status').nextElementSibling?.textContent).toBe('awaiting validation');
    expect(rows[2]).toMatch(/^In review/);
    expect(rows[3]).toMatch(/^In integration/);
    expect(rows[4]).toMatch(/^Awaiting validation/);
    expect(rows.join(' ')).not.toMatch(/in_review|in_integration|awaiting_human/);
  });
});
