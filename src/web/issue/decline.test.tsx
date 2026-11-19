import { screen, within } from '@testing-library/react';
import { beforeEach, describe, expect, it } from 'vitest';
import type { IssueOutcome } from '../data/types';
import { withAsyncTimeout } from '../test/asyncTimeout';
import { chronology, issue, issueDetail, projectsResponse } from '../test/fixtures';
import { setBrowserLanguages } from '../test/languages';
import { renderApp, stubApi } from '../test/render';
import { withTimeZone } from '../test/timeZone';

// Monter toute l'application prend plus d'une seconde quand la machine est chargée : voir `withAsyncTimeout`.
withAsyncTimeout(5_000);

withTimeZone('Europe/Paris');

const HOUR = 3_600_000;
const CLOSED_AT = '2026-10-05T09:00:00Z';

/** Le panneau d'un ticket fermé, Renoncement ou non (`declined`), et sa Chronologie, dont le résultat est `outcome`. */
async function openClosed(declined: boolean, outcome: IssueOutcome, languageSwitch?: boolean) {
  const base = { id: 'bdesk-2', title: 'Le ticket fermé', status: 'closed', closedAt: CLOSED_AT, ...(declined ? { declined: true as const } : {}) };
  stubApi({
    projects: projectsResponse,
    issues: { bdesk: [issue(base)] },
    details: { 'bdesk/bdesk-2': issueDetail({ ...base, labels: declined ? ['declined'] : [] }) },
    chronologies: {
      'bdesk/bdesk-2': chronology({
        transitions: [
          { status: 'open', at: '2026-10-01T09:00:00Z', duration: 4 * 24 * HOUR },
          { status: 'closed', at: CLOSED_AT, duration: null },
        ],
        outcome,
      }),
    },
  });
  renderApp('/p/bdesk/t/bdesk-2', languageSwitch ? { languageSwitch } : {});
  return screen.findByRole('dialog', { name: /Le ticket fermé/ });
}

/**
 * La fiche d'un Renoncement (ADR 0008) le dit comme la carte du kanban (la pastille « Renoncement »), l'explique d'une phrase et
 * le date dans la Chronologie. Une Livraison n'a rien de tel.
 */
describe('le panneau d’un Renoncement', () => {
  it('porte la pastille Renoncement à côté du statut, sans redire le motif que la phrase donne', async () => {
    const dialog = await openClosed(true, { kind: 'declined', at: CLOSED_AT });

    const status = within(dialog).getByText('fermé').closest('dd');
    const pill = status && within(status).getByText('Renoncement');

    expect(pill?.textContent).toBe('Renoncement');
    expect(pill?.getAttribute('title')).toBe('Renoncement : décidé de ne pas le faire');
  });

  it('dit que l’utilisateur a décidé de ne pas le faire, et que ce n’est pas une Livraison', async () => {
    const dialog = await openClosed(true, { kind: 'declined', at: CLOSED_AT });

    expect(within(dialog).getByText(/^Renoncement : l’utilisateur/).textContent).toBe(
      'Renoncement : l’utilisateur a décidé de ne pas le faire. Fermé sans être une Livraison.',
    );
  });

  it('le date dans la Chronologie, de sa clôture', async () => {
    const dialog = await openClosed(true, { kind: 'declined', at: CLOSED_AT });

    const timeline = await within(dialog).findByRole('region', { name: 'Chronologie' });

    expect(await within(timeline).findByText(/^Renoncement le 5 oct\. 2026/)).toBeTruthy();
  });

  it('n’existe pas pour une Livraison : ni pastille, ni phrase', async () => {
    const dialog = await openClosed(false, { kind: 'delivered', at: CLOSED_AT });

    expect(within(dialog).queryByText('Renoncement')).toBeNull();
    expect(within(dialog).queryByText(/décidé de ne pas le faire/)).toBeNull();
  });
});

describe('the panel of a Decline, in English', () => {
  beforeEach(() => {
    setBrowserLanguages(['en-US']);
  });

  it('tells a Decline in its header and in its Timeline', async () => {
    const dialog = await openClosed(true, { kind: 'declined', at: CLOSED_AT }, true);

    const status = within(dialog).getByText('closed').closest('dd');
    expect(status && within(status).getByText('Decline').getAttribute('title')).toBe('Decline: decided not to do it');
    expect(within(dialog).getByText(/^Decline: the user/).textContent).toBe('Decline: the user decided not to do it. Closed without being a Delivery.');
    const timeline = await within(dialog).findByRole('region', { name: 'Timeline' });
    expect(await within(timeline).findByText(/^Decline on Oct 5, 2026/)).toBeTruthy();
  });
});
