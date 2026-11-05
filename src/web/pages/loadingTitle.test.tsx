import { screen, within } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { bdeskIssues, projectsResponse } from '../test/fixtures';
import { renderApp, stubApi } from '../test/render';

/**
 * Le titre du squelette de la porte du Projet et de la page d'une Epic a un nom (bdesk-38k.53) : pendant le chargement, ces deux pages montraient un `<h1>` vide
 * (axe : `empty-heading`, 5 occurrences mesurées sur HEAD en bdesk-38k.40). `Page` dessine le squelette du titre (`title={null}`) et le nomme (voir `Page.test.tsx`) ; ici, les deux
 * pages réelles, montées dans l'application entière, requête retenue. Chacune garde la largeur de son squelette (`w-40` pour la porte, `w-2/3` pour l'Epic) : le nom
 * ne change rien à l'écran.
 */
afterEach(() => {
  vi.unstubAllGlobals();
});

const PROJECTS = /\/api\/projects$/;
const ISSUES = /\/api\/projects\/bdesk\/issues$/;

/** Retient les réponses dont l'adresse passe `pattern` jusqu'à `release()` : la page reste sous son squelette. */
function hold(fetchMock: ReturnType<typeof stubApi>, pattern: RegExp) {
  const healthy = fetchMock.getMockImplementation();
  if (!healthy) throw new Error('stubApi devait installer un faux fetch.');
  let release = () => {};
  const gate = new Promise<void>((resolve) => {
    release = resolve;
  });
  fetchMock.mockImplementation(async (input) => {
    if (pattern.test(String(input))) await gate;
    return healthy(input);
  });
  return release;
}

const main = () => screen.getByRole('main', { name: 'Contenu' });
const emptyHeadings = () => screen.queryAllByRole('heading', { name: '' });
/** La hauteur et la largeur du squelette d'un titre (ses classes `h-…` et `w-…`). */
const sizeOf = (title: HTMLElement) => [...(title.firstElementChild?.classList ?? [])].filter((name) => /^[hw]-/.test(name));

describe('la porte du Projet, Projets en chargement', () => {
  it('son titre est nommé « Chargement… », la région qui le suit garde son nom et son état occupé : aucun titre vide', async () => {
    const release = hold(stubApi({ projects: projectsResponse, issues: { bdesk: bdeskIssues } }), PROJECTS);
    try {
      renderApp('/p/bdesk/kanban');

      const loading = await within(main()).findByRole('status', { name: 'Chargement du Projet' });

      const title = within(main()).getByRole('heading', { level: 1, name: 'Chargement…' });
      expect(title.hasAttribute('data-skeleton')).toBe(true); // le focus ne le prend pas (bdesk-38k.40)
      expect(title.querySelector('[aria-hidden="true"]')).toBeTruthy(); // le squelette est toujours là, à l'écran : le nom ne le remplace pas
      expect(sizeOf(title)).toEqual(['h-7', 'w-40']); // et il a sa largeur : le nom ne change rien à l'écran
      expect(loading.getAttribute('aria-busy')).toBe('true');
      expect(emptyHeadings()).toEqual([]);
    } finally {
      release(); // même si une assertion a échoué : la lecture retenue ne reste pas en suspens
    }
  });

  it('les Projets arrivent : le titre de la page prend la place du squelette, plus rien ne s’appelle « Chargement… »', async () => {
    const release = hold(stubApi({ projects: projectsResponse, issues: { bdesk: bdeskIssues } }), PROJECTS);
    try {
      renderApp('/p/bdesk/kanban');
      await within(main()).findByRole('status', { name: 'Chargement du Projet' });

      release();

      const title = await within(main()).findByRole('heading', { level: 1, name: 'Kanban' });
      expect(title.hasAttribute('data-skeleton')).toBe(false);
      expect(title.hasAttribute('aria-label')).toBe(false);
      expect(screen.queryByRole('heading', { name: 'Chargement…' })).toBeNull();
      expect(emptyHeadings()).toEqual([]);
    } finally {
      release();
    }
  });
});

describe('la page d’une Epic, tickets en chargement', () => {
  it('son titre est nommé « Chargement… », la région qui le suit garde son nom et son état occupé : aucun titre vide', async () => {
    const release = hold(stubApi({ projects: projectsResponse, issues: { bdesk: bdeskIssues } }), ISSUES);
    try {
      renderApp('/p/bdesk/epics?epic=bdesk-38k');

      const loading = await within(main()).findByRole('status', { name: 'Chargement de l’Epic' });

      const title = within(main()).getByRole('heading', { level: 1, name: 'Chargement…' });
      expect(title.hasAttribute('data-skeleton')).toBe(true);
      expect(title.querySelector('[aria-hidden="true"]')).toBeTruthy(); // le squelette est toujours là, à l'écran : le nom ne le remplace pas
      expect(sizeOf(title)).toEqual(['h-7', 'w-2/3']); // et il a sa largeur, celle d'un titre d'Epic : le nom ne change rien à l'écran
      expect(loading.getAttribute('aria-busy')).toBe('true');
      expect(emptyHeadings()).toEqual([]);
    } finally {
      release();
    }
  });

  it('les tickets arrivent : le titre de l’Epic prend la place du squelette, plus rien ne s’appelle « Chargement… »', async () => {
    const release = hold(stubApi({ projects: projectsResponse, issues: { bdesk: bdeskIssues } }), ISSUES);
    try {
      renderApp('/p/bdesk/epics?epic=bdesk-38k');
      await within(main()).findByRole('status', { name: 'Chargement de l’Epic' });

      release();

      const title = await within(main()).findByRole('heading', { level: 1, name: /^beads-desktop V1/ });
      expect(title.hasAttribute('data-skeleton')).toBe(false);
      expect(title.hasAttribute('aria-label')).toBe(false);
      expect(screen.queryByRole('heading', { name: 'Chargement…' })).toBeNull();
      expect(emptyHeadings()).toEqual([]);
    } finally {
      release();
    }
  });
});
