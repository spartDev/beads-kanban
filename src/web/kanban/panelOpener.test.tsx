import { afterEach, describe, expect, it } from 'vitest';
import { focusContainer } from '../lib/focus';
import { openedFromCard, openedFromPalette, panelOpener } from './boardFocus';

/**
 * L'origine que retient le panneau d'un ticket qu'un choix de la palette ⌘K ouvre (bdesk-38k.76). Le choix écrit dans l'entrée d'historique qu'il ouvre qu'il en est l'auteur (`openedFromPalette`) ;
 * le panneau n'a alors aucune origine à l'ouverture, quel que soit l'élément qui a le focus à ce moment-là : le champ de la palette, qu'elle retire avec elle, ou l'élément d'où elle s'est ouverte, selon que le panneau
 * est rendu avant ou après le retrait de la palette (voir `IssuePanel.palette.test.tsx`). Le DOM seul, comme `Board.focus.test.tsx` pour les autres origines.
 */
describe('panelOpener : un panneau qu’un choix de la palette ouvre', () => {
  afterEach(() => {
    document.body.innerHTML = '';
  });

  /** Un lien hors du tableau, le contenu principal avec deux cartes (`x` et `y`) du Projet `a`, et une boîte de dialogue de palette (`data-overlay`) qui tient un champ. */
  function mount() {
    document.body.innerHTML =
      '<nav><button id="bouton" type="button">Rechercher</button></nav>' +
      '<main><ul><li data-card-id="x" data-card-project="a"><p><a id="carte" data-card-link="x" href="#x">X</a></p></li>' +
      '<li data-card-id="y" data-card-project="a"><p><a id="autre" data-card-link="y" href="#y">Y</a></p></li></ul></main>' +
      '<div role="dialog" data-overlay=""><input id="champ" /></div>';
    const $ = (selector: string) => document.querySelector<HTMLElement>(selector)!;
    return { $, main: $('main') };
  }

  it('l’état que la palette écrit est un objet simple, que l’historique du navigateur sait garder', () => {
    expect(openedFromPalette).toEqual({ openedFromPalette: true });
    expect(structuredClone(openedFromPalette)).toEqual(openedFromPalette);
  });

  it.each<readonly [string, string]>([
    ['son champ (le panneau est rendu pendant que la palette est encore là)', '#champ'],
    ['la carte d’où elle s’est ouverte (le panneau est rendu après son retrait, qui a rendu le focus)', '#carte'],
    ['le bouton d’où elle s’est ouverte', '#bouton'],
    ['une autre carte', '#autre'],
  ])('le focus est sur %s : aucune origine', (_where, selector) => {
    const { $ } = mount();
    $(selector).focus();

    expect(panelOpener(openedFromPalette, false)).toBeNull();
  });

  it('rien n’a le focus (le corps de la page) ou le contenu principal l’a : aucune origine non plus', () => {
    const { main } = mount();
    expect(document.activeElement).toBe(document.body);

    expect(panelOpener(openedFromPalette, false)).toBeNull();
    focusContainer(main);
    expect(panelOpener(openedFromPalette, false)).toBeNull();
  });

  it.each<readonly [string, unknown]>([
    ['aucun état', null],
    ['un état indéfini', undefined],
    ['un état vide', {}],
    ['du texte', 'openedFromPalette'],
    ['un nombre', 42],
    ['un état d’un autre auteur', { from: 'ailleurs' }],
    ['l’état d’une carte', openedFromCard('x', 'a')],
  ])('sans l’état de la palette (%s), l’élément qui a le focus reste l’origine, comme avant', (_kind, state) => {
    const { $ } = mount();
    $('#autre').focus();

    expect(panelOpener(state, false)).toBe($('#autre'));
  });

  it.each<readonly [string, unknown]>([
    ['faux', { openedFromPalette: false }],
    ['du texte', { openedFromPalette: 'true' }],
    ['un nombre', { openedFromPalette: 1 }],
    ['nul', { openedFromPalette: null }],
    ['un objet', { openedFromPalette: {} }],
  ])('l’état gardé par le navigateur n’est pas fiable : %s n’est pas celui de la palette, l’élément qui a le focus', (_kind, state) => {
    const { $ } = mount();
    $('#autre').focus();

    expect(panelOpener(state, false)).toBe($('#autre'));
  });

  /*
   * Le panneau resté ouvert : le choix de la palette remplace ou ajoute une entrée sans le remonter (un autre ticket prend sa place). L'appel se refait avec l'origine déjà retenue (`previous`), qui reste : la palette
   * n'est l'origine de rien, ni de ce panneau-ci ni de celui qu'elle vient d'ouvrir.
   */
  it('le panneau est resté ouvert : l’origine d’avant reste, la carte qui l’avait ouvert, et non l’élément qui a le focus', () => {
    const { $ } = mount();
    $('#champ').focus();

    expect(panelOpener(openedFromPalette, false, $('#carte'))).toBe($('#carte'));
  });

  it('le panneau était resté sans origine (`null`) : il n’en a toujours pas, que l’entrée soit celle de la palette ou non, et quel que soit l’élément qui a le focus', () => {
    const { $ } = mount();
    $('#carte').focus();

    expect(panelOpener(openedFromPalette, false, null)).toBeNull();
    expect(panelOpener(null, false, null)).toBeNull();
  });

  it('le navigateur rouvre l’entrée (« Retour », « Avancer », rechargement : POP) : la palette n’y est plus pour rien, l’élément qui a le focus est l’origine', () => {
    const { $ } = mount();
    $('#autre').focus();

    expect(panelOpener(openedFromPalette, true)).toBe($('#autre'));
    expect(panelOpener(openedFromPalette, true, $('#carte'))).toBe($('#carte'));
  });

  it('une carte cliquée pendant que le panneau est ouvert reprend la main : l’état de la carte, non celui de la palette, est celui de l’entrée qu’elle remplace', () => {
    const { $ } = mount();
    // Le lien d'une carte écrit sa carte à chaque clic (`openedFromCard`) : l'entrée n'est plus celle de la palette, et la carte prend la place de l'origine d'avant, comme à l'ordinaire.
    expect(panelOpener(openedFromCard('y', 'a'), false, null)).toBe($('#autre'));
  });
});
