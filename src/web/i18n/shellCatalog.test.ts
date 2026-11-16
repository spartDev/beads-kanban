import { afterEach, describe, expect, it, vi } from 'vitest';
import { ApiError, apiGet, describeError } from '../data/client';
import { ticketTitle } from '../data/helpers';
import { projectInSentence, projectLabel, projectList, withProjectNames } from '../data/projectNames';
import { keyCaps } from '../lib/platform';
import { signalKinds, signalSentence, SIGNAL_KINDS } from '../lib/signals';
import { abandonReason } from '../ui/IssueBadges';

/** Les fonctions pures de la zone shell que les autres zones appellent : françaises par défaut, anglaises sur demande (bdesk-ewr.2). */

const DAY = 86_400_000;
const NBSP = ' ';
const unnamed = { name: 'Sans titre', unnamed: true as const };
const ticket = { id: 'p-1', title: 't', type: 'task', priority: 2 };

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('the shared helpers of the shell zone, in English', () => {
  it('names an untitled ticket or project', () => {
    expect(ticketTitle({ title: ' \u200b ' }, 'en')).toBe('Untitled');
    expect(ticketTitle({ title: ' \u200b ' })).toBe('Sans titre');
    expect(withProjectNames([{ name: '' }], 'en')).toEqual([{ name: 'Untitled', unnamed: true }]);
  });

  it('writes projects in a sentence', () => {
    expect(projectInSentence({ name: 'Untitled', unnamed: true }, 'en')).toBe('this project');
    expect(projectInSentence({ name: 'beads-desktop' }, 'en')).toBe('beads-desktop');
    expect(projectList([{ name: 'alpha' }, unnamed], 'en')).toBe('“alpha”, an unnamed project');
    expect(projectList([unnamed, unnamed, { name: 'alpha' }], 'en')).toBe('“alpha”, 2 unnamed projects');
    expect(projectList([unnamed, unnamed, { name: 'alpha' }])).toBe('« alpha », 2 Projets sans nom');
    expect(projectLabel(unnamed, [unnamed], 'en')).toBe('An unnamed project');
    expect(projectLabel({ name: 'alpha' }, [unnamed], 'en')).toBe('“alpha”');
  });

  it('describes loading errors, without translating what the server says', () => {
    expect(describeError(new ApiError('Serveur injoignable', 0), 'en')).toEqual({
      title: 'The beads-desktop server is unreachable',
      detail: 'Check that the beads-desktop command is still running, then try again.',
    });
    expect(describeError(new ApiError('verrou', 503, { reason: 'database is locked' }), 'en')).toEqual({
      title: 'Unreadable project',
      detail: 'database is locked',
      specific: true,
    });
    expect(describeError(new ApiError('Ticket inconnu', 404), 'en')).toEqual({ title: 'Resource not found', detail: 'Ticket inconnu' });
    expect(describeError(new ApiError('Erreur HTTP 502', 502, { bare: true }), 'en')).toEqual({
      title: 'The server ran into an error',
      detail: 'HTTP error 502',
    });
    expect(describeError(new ApiError('Erreur HTTP 502', 502, { bare: true }), 'fr')).toEqual({
      title: 'Le serveur a rencontré une erreur',
      detail: 'Erreur HTTP 502',
    });
    expect(describeError(new Error('boom'), 'en')).toEqual({ title: 'Loading failed', detail: 'boom' });
  });

  it('writes an error response that says nothing but its status in the displayed language', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => new Response('', { status: 502 })));
    const error = await apiGet('/api/projects').catch((caught: unknown) => caught);

    expect(error).toBeInstanceOf(ApiError);
    expect(describeError(error, 'en')).toEqual({ title: 'The server ran into an error', detail: 'HTTP error 502' });
    expect(describeError(error, 'fr')).toEqual({ title: 'Le serveur a rencontré une erreur', detail: 'Erreur HTTP 502' });
  });

  it('says the signals', () => {
    expect(signalKinds('en').map(({ label }) => label)).toEqual(['Drift', 'Long blockage', 'Stale ready', 'Unusual WIP']);
    expect(SIGNAL_KINDS.map(({ label }) => label)).toEqual(['Dérive', 'Blocage long', 'Prêt qui stagne', 'WIP inhabituel']);
    expect(signalSentence({ kind: 'longBlockage', project: 'p', ticket, since: '', duration: 4 * DAY }, 'en')).toBe(
      `blocked while in progress for 4${NBSP}d`,
    );
    expect(signalSentence({ kind: 'unusualWip', project: 'p', wip: 1, threshold: 0 }, 'en')).toBe(
      '1 ticket in progress, above 0, the P85 of daily WIP over the last 90 days',
    );
    expect(signalSentence({ kind: 'unusualWip', project: 'p', wip: 1, threshold: 0 })).toBe(
      '1 ticket en cours, au-delà de 0, le P85 du WIP quotidien des 90 derniers jours',
    );
    expect(signalSentence({ kind: 'unusualWip', project: 'p', wip: 1200, threshold: 1000 }, 'en')).toBe(
      '1,200 tickets in progress, above 1,000, the P85 of daily WIP over the last 90 days',
    );
    expect(signalSentence({ kind: 'drift', project: 'p', ticket, cycleTime: 2 * DAY, reference: DAY, scope: 'project' }, 'en')).toBe(
      `2${NBSP}d of Cycle Time so far, above 1${NBSP}d, the P85 of the project’s deliveries`,
    );
  });

  it('writes the keys that are words; the keys themselves do not change', () => {
    expect(keyCaps('escape', false, 'en')).toEqual(['Esc']);
    expect(keyCaps('shift+space', false, 'en')).toEqual(['Shift', 'Space']);
    expect(keyCaps('shift+space', false)).toEqual(['Maj', 'Espace']);
    expect(keyCaps('mod+k', true, 'en')).toEqual(['⌘', 'K']);
  });

  it('says why a ticket was dropped', () => {
    expect(abandonReason({ cause: 'duplicate', of: 'p-2' }, 'en')).toBe('duplicate of p-2');
    expect(abandonReason({ cause: 'superseded', of: 'p-2' }, 'en')).toBe('superseded by p-2');
  });
});
