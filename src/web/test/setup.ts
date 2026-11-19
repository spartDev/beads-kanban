import { cleanup } from '@testing-library/react';
import { afterEach, beforeEach } from 'vitest';
import { installEventLoopYield } from '../../testing/event-loop';
import { forgetNotedVisit } from '../lib/lastVisit';
import { setBrowserLanguages } from './languages';
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

// Rendre la main à la boucle d'événements avant chaque test : sans cela, une suite de tests synchrones la tient bloquée assez longtemps pour que vitest
// échoue sur « Timeout calling "onTaskUpdate" » (bdesk-8g5, voir `src/testing/event-loop.ts`).
installEventLoopYield();

beforeEach(() => {
  installMatchMedia(false);
  window.localStorage.clear();
  forgetNotedVisit(); // la Dernière visite notée pendant la session, que le module garde à côté du stockage
  document.documentElement.removeAttribute('data-theme');
  // La suite est en français (ADR 0006) : un navigateur français, même une fois le sélecteur de langue activé.
  setBrowserLanguages(['fr-FR', 'fr']);
  document.documentElement.lang = 'fr';
});

afterEach(() => {
  cleanup();
});
