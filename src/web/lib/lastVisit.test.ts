import { act, renderHook } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { LAST_VISIT_KEY, readLastVisit, useLastVisit } from './lastVisit';

afterEach(() => vi.restoreAllMocks());

const unavailable = () => {
  throw new DOMException('Accès refusé', 'SecurityError');
};

describe('readLastVisit', () => {
  it('rend la Dernière visite enregistrée, en ISO 8601', () => {
    window.localStorage.setItem(LAST_VISIT_KEY, '2026-11-02T19:00:00.000Z');
    expect(readLastVisit()).toBe('2026-11-02T19:00:00.000Z');
  });

  it('rend `null` sans visite, sur une valeur qui n’est pas un instant, ou quand le stockage lève', () => {
    expect(readLastVisit()).toBeNull();
    window.localStorage.setItem(LAST_VISIT_KEY, 'hier');
    expect(readLastVisit()).toBeNull();
    vi.spyOn(window.localStorage, 'getItem').mockImplementation(unavailable);
    expect(readLastVisit()).toBeNull();
  });

  it('écrit en UTC une valeur lisible mais écrite autrement : c’est elle qu’on enverra au serveur', () => {
    window.localStorage.setItem(LAST_VISIT_KEY, '2026-11-02T20:00:00+01:00');
    expect(readLastVisit()).toBe('2026-11-02T19:00:00.000Z');
  });
});

describe('useLastVisit', () => {
  it('ne lit le stockage qu’au montage, et ne le change que sur « Tout vu »', () => {
    window.localStorage.setItem(LAST_VISIT_KEY, '2026-11-01T08:30:00.000Z');
    const { result } = renderHook(() => useLastVisit());
    expect(result.current.lastVisit).toBe('2026-11-01T08:30:00.000Z');

    act(() => result.current.markSeen('2026-11-02T19:00:00.000Z'));

    expect(result.current.lastVisit).toBe('2026-11-02T19:00:00.000Z');
    expect(window.localStorage.getItem(LAST_VISIT_KEY)).toBe('2026-11-02T19:00:00.000Z');
  });

  it('garde la visite notée pour la session quand le stockage refuse l’écriture', () => {
    vi.spyOn(window.localStorage, 'setItem').mockImplementation(unavailable);
    const { result } = renderHook(() => useLastVisit());

    act(() => result.current.markSeen('2026-11-02T19:00:00.000Z'));

    expect(result.current.lastVisit).toBe('2026-11-02T19:00:00.000Z');
  });
});
