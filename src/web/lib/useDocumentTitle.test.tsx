import { renderHook } from '@testing-library/react';
import { beforeEach, describe, expect, it } from 'vitest';
import { INVISIBLE_TEXTS } from '../test/invisibleTexts';
import { useDocumentTitle } from './useDocumentTitle';

/**
 * Le titre de l'onglet (bdesk-38k.65). Une partie qu'on ne verrait pas (vide, faite d'espaces ou de caractères sans largeur) n'est pas une partie : écrite telle quelle, elle laisse un titre
 * qui commence ou se poursuit par du blanc (« Kanban ·    · beads-desktop »), comme si l'onglet avait un nom qu'on ne lit pas.
 */
beforeEach(() => {
  document.title = 'avant';
});

describe('useDocumentTitle', () => {
  it('écrit les parties dans l’ordre, puis le nom de l’application', () => {
    renderHook(() => useDocumentTitle('Kanban', 'bdesk'));

    expect(document.title).toBe('Kanban · bdesk · beads-desktop');
  });

  it('laisse l’onglet à la page qu’un parent affiche quand il n’a aucune partie à écrire', () => {
    renderHook(() => useDocumentTitle());
    expect(document.title).toBe('avant');

    renderHook(() => useDocumentTitle(undefined, ''));
    expect(document.title).toBe('avant');
  });

  it.each(INVISIBLE_TEXTS)('ne compte pas pour une partie un texte %s : les autres parties s’écrivent sans lui', (_kind, blank) => {
    renderHook(() => useDocumentTitle('Kanban', blank));

    expect(document.title).toBe('Kanban · beads-desktop');
  });

  it.each(INVISIBLE_TEXTS)('laisse l’onglet à la page qui l’avait quand la seule partie est un texte %s', (_kind, blank) => {
    renderHook(() => useDocumentTitle(blank));

    expect(document.title).toBe('avant');
  });

  it.each([
    ['un nom', 'Mon Projet'],
    ['un tiret', '-'],
    ['deux-points', ':'],
    ['une marque arabe qui se dessine (U+06DD)', '\u06dd'],
    ['un nom entre des remplisseurs et un blanc braille', '\u3164Kanban\u2800'],
  ])('écrit une partie qui se voit, %s, telle qu’elle est', (_kind, text) => {
    renderHook(() => useDocumentTitle(text));

    expect(document.title).toBe(`${text} · beads-desktop`);
  });
});
