import type { Issue } from '../data/types';

/**
 * Ce que `7a0a9df` (HEAD quand bdesk-38k.70 s'est écrit) faisait des titres, copié tel quel et figé : `withoutInvisible`, `collapseSpaces`, `shortTitle`, `sameTitleKey` et `epicLabels`, avec la règle d'avant, « un blanc de
 * `\s` ou un caractère de catégorie `Cf` ». C'est l'oracle de `kanban/headParity.test.ts` : pour tout titre où aucun caractère ne change de classe, la règle commune doit rendre exactement ce que rendait cette copie.
 *
 * Ne pas la mettre à jour avec le code : si elle ne dit plus ce que fait le code, c'est le code qui a changé, et le test qui l'éprouve le dit. Rien d'autre ne l'importe.
 */

/** Ce que HEAD tenait pour invisible dans `withoutInvisible`, la série de blancs de `collapseSpaces` et les bords de la pastille : un blanc de `\s`, ou un caractère de catégorie `Cf`. */
export const HEAD_INVISIBLE = /[\s\p{Cf}]/u;

/** La règle des textes invisibles de HEAD (`isInvisibleText`, bdesk-38k.65), que bdesk-38k.70 ne change pas : elle sert `isBlankTitle`, donc `isUnnamed`. */
const HEAD_BLANK_TEXT = /^[\p{White_Space}\p{Default_Ignorable_Code_Point}\u2800]*$/u;

export const headWithoutInvisible = (text: string): string => text.replace(/\p{Cf}/gu, '');

const BLANK_RUN = /[\s\p{Cf}]+/gu;
const WHITESPACE = /\s/u;

export const headCollapseSpaces = (text: string): string =>
  text.replace(BLANK_RUN, (run, offset: number) => {
    // Une seule espace par série, et aucune au bord du texte : on la tient pour déjà posée.
    let spaced = offset === 0 || offset + run.length === text.length;
    let folded = '';
    for (const char of run) {
      if (!WHITESPACE.test(char)) folded += char;
      else if (!spaced) {
        folded += ' ';
        spaced = true;
      }
    }
    return folded;
  });

const MIN_HEAD = 3;
const SEPARATOR = /\s*[:–—]\s+|\s+-\s+/;
const SEPARATOR_SIGNS = /[:–—-]/gu;
const EDGE_BLANKS = /^[\s\p{Cf}]+|[\s\p{Cf}]+$/gu;
const segmenter = new Intl.Segmenter(undefined, { granularity: 'grapheme' });

const measure = (text: string): number => headWithoutInvisible(text).normalize('NFC').length;

function visiblePrefix(text: string, count: number): string {
  let seen = 0;
  let end = 0;
  for (const { segment } of segmenter.segment(text)) {
    const width = measure(segment);
    if (end > 0 && seen + width > count) break;
    seen += width;
    end += segment.length;
  }
  return text.slice(0, end);
}

const isBlank = (title: string): boolean => HEAD_BLANK_TEXT.test(title);
const isUnnamed = (title: string): boolean => isBlank(title.replace(SEPARATOR_SIGNS, ''));

export function headShortTitle(title: string, max = 24): string {
  if (isUnnamed(title)) return '';
  const clean = headCollapseSpaces(title).replace(EDGE_BLANKS, '');
  const head = clean.split(SEPARATOR)[0] ?? clean;
  const base = measure(head) >= MIN_HEAD ? head : clean;
  if (measure(base) <= max) return base;
  const cut = visiblePrefix(base, max - 1);
  if (isBlank(base.slice(cut.length))) return base;
  const lastSpace = cut.lastIndexOf(' ');
  const atWord = lastSpace >= 0 && measure(cut.slice(0, lastSpace)) >= max / 2;
  return `${(atWord ? cut.slice(0, lastSpace) : cut).replace(EDGE_BLANKS, '')}…`;
}

const sameTitleKey = (title: string): string => headCollapseSpaces(headWithoutInvisible(title)).toLowerCase().normalize('NFC');

const HEAD_ALL_EPICS = 'Toutes les Epics';

export function headEpicLabels(epics: readonly Pick<Issue, 'id' | 'title'>[], reserved: readonly string[] = [HEAD_ALL_EPICS]): Map<string, string> {
  const labels = new Map(epics.map(({ id, title }) => [id, isUnnamed(title) ? id : headCollapseSpaces(title)]));
  const taken = new Map<string, number>();
  for (const label of reserved) taken.set(sameTitleKey(label), (taken.get(sameTitleKey(label)) ?? 0) + 1);
  const undecorated = new Set(epics.filter(({ title }) => !isUnnamed(title)).map(({ id }) => id));
  for (;;) {
    const sharing = new Map(taken);
    for (const label of labels.values()) sharing.set(sameTitleKey(label), (sharing.get(sameTitleKey(label)) ?? 0) + 1);
    const clashing = [...undecorated].filter((id) => (sharing.get(sameTitleKey(labels.get(id) ?? '')) ?? 0) > 1);
    if (clashing.length === 0) return labels;
    for (const id of clashing) {
      labels.set(id, `${labels.get(id) ?? ''} (${id})`);
      undecorated.delete(id);
    }
  }
}
