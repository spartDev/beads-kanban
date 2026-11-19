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

  it('la garde aussi d’un montage à l’autre quand le stockage ne lit ni n’écrit : on quitte l’accueil, on y revient', () => {
    vi.spyOn(window.localStorage, 'getItem').mockImplementation(unavailable);
    vi.spyOn(window.localStorage, 'setItem').mockImplementation(unavailable);
    const first = renderHook(() => useLastVisit());
    expect(first.result.current.lastVisit).toBeNull();
    act(() => first.result.current.markSeen('2026-11-02T19:00:00.000Z'));
    first.unmount();

    const second = renderHook(() => useLastVisit());

    expect(second.result.current.lastVisit).toBe('2026-11-02T19:00:00.000Z');
    expect(readLastVisit()).toBe('2026-11-02T19:00:00.000Z');
  });

  it('préfère la visite notée pendant la session à une valeur plus ancienne que le stockage n’a pas pu remplacer (quota)', () => {
    window.localStorage.setItem(LAST_VISIT_KEY, '2026-11-01T08:30:00.000Z');
    vi.spyOn(window.localStorage, 'setItem').mockImplementation(unavailable);
    const first = renderHook(() => useLastVisit());
    act(() => first.result.current.markSeen('2026-11-02T19:00:00.000Z'));
    first.unmount();

    expect(renderHook(() => useLastVisit()).result.current.lastVisit).toBe('2026-11-02T19:00:00.000Z');
  });

  it('est propre au navigateur, pas à l’onglet : une visite plus récente qu’un autre onglet a notée dans le stockage l’emporte au montage suivant', () => {
    const first = renderHook(() => useLastVisit());
    act(() => first.result.current.markSeen('2026-11-02T19:00:00.000Z'));
    first.unmount();
    // L'autre onglet clique « Tout vu » dix minutes plus tard : le stockage, partagé, porte sa visite.
    window.localStorage.setItem(LAST_VISIT_KEY, '2026-11-02T19:10:00.000Z');

    expect(renderHook(() => useLastVisit()).result.current.lastVisit).toBe('2026-11-02T19:10:00.000Z');
    expect(readLastVisit()).toBe('2026-11-02T19:10:00.000Z');
  });
});
