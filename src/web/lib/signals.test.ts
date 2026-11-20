import { describe, expect, it } from 'vitest';
import type { TicketSignals } from '../data/hooks';
import { shownSignals, signalKinds, signalSentence } from './signals';
import { NO_DECLARED_STATUSES } from '../../domain/statuses';

/** Les Signaux d'un ticket que montrent sa carte et son Panneau : une Dérive et un Blocage long, tels que le serveur les a calculés. */
const SIGNALS: TicketSignals = {
  drift: { kind: 'drift', project: 'p', ticket: { id: 't', title: 'T', type: 'task', priority: 2 }, cycleTime: 10, reference: 5, scope: 'type' },
  longBlockage: { kind: 'longBlockage', project: 'p', ticket: { id: 't', title: 'T', type: 'task', priority: 2 }, since: '2026-10-20T10:00:00.000Z', duration: 4 },
};

describe('shownSignals : les Signaux d’un ticket que l’écran montre', () => {
  it('montre ceux d’un ticket en statut de travail, Statuts de relais compris (bdesk-pz0.3)', () => {
    for (const status of ['in_progress', 'hooked', 'blocked', 'in_review', 'in_integration', 'awaiting_human']) {
      expect(shownSignals(status, SIGNALS, NO_DECLARED_STATUSES), status).toBe(SIGNALS);
    }
  });

  it('les tait pour un ticket qui n’est plus en statut de travail : la réponse des Signaux peut être en retard sur celle des tickets', () => {
    for (const status of ['open', 'deferred', 'pinned', 'closed', 'review', '']) expect(shownSignals(status, SIGNALS, NO_DECLARED_STATUSES), status).toEqual({});
  });

  it('ne montre rien tant que les Signaux manquent', () => {
    expect(shownSignals('in_review', undefined, NO_DECLARED_STATUSES)).toEqual({});
  });
});

describe('signalSentence : les Signaux de relais', () => {
  const ticket = { id: 't', title: 'T', type: 'task', priority: 2 };

  it('dit depuis quand un ticket est À valider, et combien de Retours il a subis, dans les deux langues', () => {
    const waiting = { kind: 'waitingValidation', project: 'p', ticket, since: '2026-10-20T10:00:00.000Z', duration: 2 * 86_400_000 } as const;
    const loop = { kind: 'sendBackLoop', project: 'p', ticket, sendBacks: 3 } as const;

    expect(signalSentence(waiting, 'fr').replaceAll('\u00a0', ' ')).toBe('À valider depuis 2 j');
    expect(signalSentence(waiting, 'en').replaceAll('\u00a0', ' ')).toBe('Awaiting validation for 2 d');
    expect(signalSentence(loop, 'fr')).toBe('3 Retours au développement, sans être fermé');
    expect(signalSentence(loop, 'en')).toBe('3 Send-backs to development, still not closed');
  });

  it('les range après les autres sortes, sous leurs noms du glossaire', () => {
    expect(signalKinds('fr').slice(-2)).toEqual([
      { kind: 'waitingValidation', label: 'Validation qui attend' },
      { kind: 'sendBackLoop', label: 'Boucle de Retours' },
    ]);
    expect(signalKinds('en').slice(-2).map(({ label }) => label)).toEqual(['Waiting validation', 'Send-back loop']);
  });
});
