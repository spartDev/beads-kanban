import { describe, expect, it } from 'vitest';
import type { TicketSignals } from '../data/hooks';
import { shownSignals } from './signals';

/** Les Signaux d'un ticket que montrent sa carte et son Panneau : une Dérive et un Blocage long, tels que le serveur les a calculés. */
const SIGNALS: TicketSignals = {
  drift: { kind: 'drift', project: 'p', ticket: { id: 't', title: 'T', type: 'task', priority: 2 }, cycleTime: 10, reference: 5, scope: 'type' },
  longBlockage: { kind: 'longBlockage', project: 'p', ticket: { id: 't', title: 'T', type: 'task', priority: 2 }, since: '2026-10-20T10:00:00.000Z', duration: 4 },
};

describe('shownSignals : les Signaux d’un ticket que l’écran montre', () => {
  it('montre ceux d’un ticket en statut de travail, Statuts de relais compris (bdesk-pz0.3)', () => {
    for (const status of ['in_progress', 'hooked', 'blocked', 'in_review', 'in_integration', 'awaiting_human']) {
      expect(shownSignals(status, SIGNALS), status).toBe(SIGNALS);
    }
  });

  it('les tait pour un ticket qui n’est plus en statut de travail : la réponse des Signaux peut être en retard sur celle des tickets', () => {
    for (const status of ['open', 'deferred', 'pinned', 'closed', 'review', '']) expect(shownSignals(status, SIGNALS), status).toEqual({});
  });

  it('ne montre rien tant que les Signaux manquent', () => {
    expect(shownSignals('in_review', undefined)).toEqual({});
  });
});
