import { cleanup } from '@testing-library/react';
import { afterEach, beforeEach } from 'vitest';
import { installMatchMedia } from './matchMedia';

// jsdom n'implémente ni ResizeObserver ni scrollIntoView, dont cmdk et Radix se servent.
class ResizeObserverStub {
  observe() {}
  unobserve() {}
  disconnect() {}
}
globalThis.ResizeObserver ??= ResizeObserverStub;
Element.prototype.scrollIntoView ??= () => undefined;

// Node 25 expose son propre `localStorage` (sans fichier, donc inutilisable, et qui avertit à chaque lecture)
// qui masque celui de jsdom : on le remplace d'office par un stockage en mémoire, sans jamais le lire.
{
  const data = new Map<string, string>();
  const memoryStorage: Storage = {
    get length() {
      return data.size;
    },
    clear: () => data.clear(),
    getItem: (key) => data.get(String(key)) ?? null,
    key: (index) => [...data.keys()][index] ?? null,
    removeItem: (key) => void data.delete(String(key)),
    setItem: (key, value) => void data.set(String(key), String(value)),
  };
  Object.defineProperty(globalThis, 'localStorage', { configurable: true, value: memoryStorage });
}

// jsdom fournit son propre AbortSignal, que le `Request` natif de Node refuse : react-router crée une
// Request à chaque navigation. Les signaux d'annulation ne servent à rien ici, on les retire.
const NativeRequest = globalThis.Request;
globalThis.Request = class extends NativeRequest {
  constructor(input: RequestInfo | URL, init?: RequestInit) {
    super(input, init ? { ...init, signal: undefined } : init);
  }
} as typeof Request;

beforeEach(() => {
  installMatchMedia(false);
  window.localStorage.clear();
  document.documentElement.removeAttribute('data-theme');
});

afterEach(() => {
  cleanup();
});
