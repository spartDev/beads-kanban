import { describe, expect, it } from 'vitest';
import { FLEX_SHRINK, flexShrinkOf, ownRules, selectorOf, type Rule } from './compiledCss';

/**
 * Ce que `ownRules` et `flexShrinkOf` (test/compiledCss.ts) lisent et refusent, sur des règles écrites ici (pas de classes : Tailwind lit aussi ce fichier). Ces deux lectures servent à plusieurs tests de mise en page et de taille de cible
 * (TopBar.targetSize, EpicView.targetSize, idLayout) : leur rigueur se prouve une fois, ici, et non par le test de l'un d'eux.
 */

const rule = (selector: string, declarations: Record<string, string>, within: string[] = []): Rule => ({ selector, within, layer: 'utilities', declarations });
const element = (...classes: string[]) => {
  const node = document.createElement('div');
  node.className = classes.join(' ');
  return node;
};

describe('ownRules : les règles qu’une classe de l’élément pose seule', () => {
  const READ = ['display', 'max-width'];

  it('garde, dans l’ordre de la feuille, celles dont le sélecteur est une classe de l’élément', () => {
    const rules = [rule('.a', { display: 'flex' }), rule('.autre', { display: 'none' }), rule('.b', { 'max-width': '100%' }), rule('.a', { 'max-width': '40ch' })];

    expect(ownRules(rules, element('a', 'b'), READ)).toEqual([rules[0], rules[2], rules[3]]);
  });

  it('écarte celles qui ne déclarent aucune propriété lue', () => {
    expect(ownRules([rule('.a', { color: 'red' })], element('a'), READ)).toEqual([]);
  });

  it('garde les règles sous condition (`declared` les lit, une largeur de fenêtre à la fois)', () => {
    const wide = rule('.a', { display: 'flex' }, ['@media (width >= 48rem)']);

    expect(ownRules([wide], element('a'), READ)).toEqual([wide]);
  });

  it('refuse une règle qui nomme une classe de l’élément sans en être seule et déclare une propriété lue', () => {
    expect(() => ownRules([rule('.a[open]', { display: 'flex' })], element('a'), READ)).toThrow(/« \.a\[open\] » déclare display et nomme une classe de l'élément sans en être seule/);
    expect(() => ownRules([rule('header .a', { 'max-width': '100%' })], element('a'), READ)).toThrow(/déclare max-width/);
    expect(() => ownRules([rule(`${selectorOf('md:a')}:hover`, { display: 'flex' })], element('md:a'), READ)).toThrow(/déclare display/);
  });

  it('laisse passer une règle composée qui ne déclare rien de lu', () => {
    expect(ownRules([rule('.a[open]', { color: 'red' })], element('a'), READ)).toEqual([]);
  });

  it('écarte une règle de pseudo-élément : elle ne dit rien de la boîte de l’élément', () => {
    expect(ownRules([rule('.a::before', { display: 'block' }), rule('.a:after', { display: 'block' })], element('a'), READ)).toEqual([]);
  });

  it('refuse une règle d’une classe de l’élément qui déclare une propriété qu’il dit ne pas lire, même seule', () => {
    expect(() => ownRules([rule('.a', { 'flex-flow': 'row wrap' })], element('a'), READ, ['flex-flow'])).toThrow(/déclare flex-flow, que ce test ne lit pas : il lit display, max-width/);
  });

  it('ne lit pas les règles des autres classes, ni une classe qui n’en est que le début', () => {
    expect(ownRules([rule('.a-plus-longue', { display: 'flex' }), rule('.b', { display: 'flex' })], element('a'), READ)).toEqual([]);
  });
});

describe('flexShrinkOf : le facteur de rétrécissement d’une boîte flex', () => {
  const sheet: Rule[] = [];
  const rateOf = (declarations: Record<string, string>, viewport = 375, variables: Rule[] = []) => flexShrinkOf(variables, [rule('.a', declarations)], viewport);

  it('vaut 1, sa valeur initiale, tant que rien ne le change', () => {
    expect(flexShrinkOf(sheet, [], 375)).toBe(1);
    expect(rateOf({ 'flex-basis': '10rem' })).toBe(1);
  });

  it('se lit dans `flex` : `none` et `0 0 auto` l’annulent, `1`, `auto` et `initial` le laissent à 1, le deuxième nombre le donne', () => {
    expect(rateOf({ flex: 'none' })).toBe(0);
    expect(rateOf({ flex: '0 0 auto' })).toBe(0);
    expect(rateOf({ flex: '1' })).toBe(1);
    expect(rateOf({ flex: 'auto' })).toBe(1);
    expect(rateOf({ flex: 'initial' })).toBe(1);
    expect(rateOf({ flex: '2 3 0%' })).toBe(3);
  });

  it('se lit dans sa propriété seule', () => {
    expect(rateOf({ [FLEX_SHRINK]: '0' })).toBe(0);
    expect(rateOf({ [FLEX_SHRINK]: '1.5' })).toBe(1.5);
    expect(rateOf({ [FLEX_SHRINK]: 'initial' })).toBe(1);
  });

  it('la dernière déclaration l’emporte, de `flex` ou de sa propriété seule, sauf devant un `!important`', () => {
    expect(flexShrinkOf(sheet, [rule('.a', { [FLEX_SHRINK]: '0' }), rule('.b', { flex: '1' })], 375)).toBe(1);
    expect(flexShrinkOf(sheet, [rule('.a', { flex: 'none' }), rule('.b', { [FLEX_SHRINK]: '2' })], 375)).toBe(2);
    expect(flexShrinkOf(sheet, [rule('.a', { [FLEX_SHRINK]: '0 !important' }), rule('.b', { flex: '1' })], 375)).toBe(0);
    expect(flexShrinkOf(sheet, [rule('.a', { [FLEX_SHRINK]: '0 !important' }), rule('.b', { [FLEX_SHRINK]: '3 !important' })], 375)).toBe(3);
  });

  it('lit les conditions de largeur de fenêtre, une largeur à la fois', () => {
    const rules = [rule('.a', { [FLEX_SHRINK]: '0' }), rule('.a', { [FLEX_SHRINK]: '1' }, ['@media (width >= 48rem)'])];

    expect(flexShrinkOf(sheet, rules, 375)).toBe(0);
    expect(flexShrinkOf(sheet, rules, 1280)).toBe(1);
  });

  it('résout les `var(--…)` dans la feuille que l’élément voit, et leur repli', () => {
    const variables = [rule(':root', { '--none': 'none' })];

    expect(rateOf({ flex: 'var(--none)' }, 375, variables)).toBe(0);
    expect(rateOf({ [FLEX_SHRINK]: 'var(--absent, 0)' }, 375, variables)).toBe(0);
  });

  it('refuse, au lieu de passer pour 1, ce qu’il ne sait pas lire : `inherit`, `unset`, `revert`, un facteur qui n’est pas un nombre, une variable sans valeur', () => {
    for (const value of ['inherit', 'unset', 'revert', 'revert-layer']) expect(() => rateOf({ flex: value }), `flex: ${value}`).toThrow(/Valeur de flex que ce test ne sait pas lire/);
    expect(() => rateOf({ [FLEX_SHRINK]: 'inherit' })).toThrow(/ne sait pas lire : inherit/);
    expect(() => rateOf({ [FLEX_SHRINK]: 'calc(1 - 1)' })).toThrow(/ne sait pas lire/);
    expect(() => rateOf({ flex: 'var(--absent)' })).toThrow(/Variable CSS sans valeur/);
  });

  it('refuse une condition qu’il ne sait pas lire, sur une règle qui déclare le facteur', () => {
    expect(() => flexShrinkOf(sheet, [rule('.a', { [FLEX_SHRINK]: '0' }, ['@supports (display: grid)'])], 375)).toThrow(/Condition que ce test ne sait pas lire/);
    expect(flexShrinkOf(sheet, [rule('.a', { color: 'red' }, ['@supports (display: grid)'])], 375)).toBe(1);
  });
});
