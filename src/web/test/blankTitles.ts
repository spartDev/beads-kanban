/**
 * Ce que l'interface écrit à la place du titre d'un ticket qui n'en a pas (bdesk-38k.50). Écrit ici et non importé de `ticketTitle` : un test ne
 * doit pas dépendre du code qu'il éprouve.
 */
export const UNTITLED = 'Sans titre';

/**
 * Les titres qui ne disent rien : vide, espaces, tabulation et saut de ligne, espace insécable (que `trim` retire aussi), et les caractères sans
 * largeur, que `trim` ne retire pas (catégorie Unicode `Cf` : U+200B à U+200D, U+2060, U+00AD) et qu'axe ne voit pas non plus : un lien nommé d'une
 * espace sans largeur n'a aucun nom pour un lecteur d'écran, sans qu'aucune règle automatique ne le signale.
 */
export const BLANK_TITLES = [
  ['vide', ''],
  ['fait d’espaces', '   '],
  ['fait d’une tabulation et d’un saut de ligne', '\t\n '],
  ['fait d’une espace insécable', ' '],
  ['fait d’une espace sans largeur (U+200B)', '​'],
  ['fait d’une marque d’ordre des octets (U+FEFF)', '﻿'],
  ['fait d’un antiliant et d’un liant sans chasse (U+200C, U+200D)', '‌‍'],
  ['fait d’un lien de mots (U+2060)', '⁠'],
  ['fait d’un trait d’union conditionnel (U+00AD)', '­'],
  ['mêlé d’espaces et de caractères sans largeur', ' ​\t⁠ '],
] as const;

/** Trois de ces titres, un par genre (vide, blanc, sans largeur) : de quoi éprouver un endroit qui monte toute l'application sans la monter dix fois. */
export const BLANK_SAMPLE = [BLANK_TITLES[0], BLANK_TITLES[3], BLANK_TITLES[4]] as const;
