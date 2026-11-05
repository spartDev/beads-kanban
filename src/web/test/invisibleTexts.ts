/**
 * Des textes qu'on ne voit pas (bdesk-38k.61) : vides, faits de blancs de toute sorte, ou de caractères de mise en forme sans largeur (catégorie Unicode `Cf`), que `trim()` ne retire
 * pas tous et qu'axe ne signale pas : un titre qui en est fait n'a aucun nom pour un lecteur d'écran. Écrits ici et non importés du code qu'ils éprouvent : un test ne doit pas dépendre
 * de ce qu'il éprouve.
 */
export const INVISIBLE_TEXTS = [
  ['vide', ''],
  ['fait d’espaces', '   '],
  ['fait d’une tabulation et d’un saut de ligne', '\t\n '],
  ['fait d’une espace insécable', '\u00a0'],
  ['fait d’une espace sans largeur (U+200B)', '\u200b'],
  ['fait d’une marque d’ordre des octets (U+FEFF)', '\ufeff'],
  ['fait d’un antiliant et d’un liant sans chasse (U+200C, U+200D)', '\u200c\u200d'],
  ['fait d’un lien de mots (U+2060)', '\u2060'],
  ['fait d’un trait d’union conditionnel (U+00AD)', '\u00ad'],
  ['mêlé d’espaces et de caractères sans largeur', ' \u200b\t\u2060 '],
] as const;

/**
 * Des textes qui se voient, donc ce que l'auteur a écrit : ils ne sont pas invisibles, et une page les écrit tels quels, jusqu'à leurs blancs. De la ponctuation seule en est : un dossier
 * peut s'appeler « - » ou « : », et les règles d'une autre partie de l'interface (le titre d'un ticket, dont la règle peut prendre un séparateur seul pour un titre vide) ne sont pas les siennes.
 */
export const VISIBLE_TEXTS = [
  ['un tiret', '-'],
  ['deux tirets', '--'],
  ['deux-points', ':'],
  ['un tiret demi-cadratin', '–'],
  ['un tiret demi-cadratin entre des espaces', ' – '],
  ['un tiret cadratin', '—'],
  ['des points d’interrogation', '???'],
  ['des points de suspension', '…'],
  ['un chiffre', '0'],
  ['un nom', 'Mon Projet'],
  ['un nom entouré d’espaces', '  Mon Projet  '],
  ['un nom aux espaces qui se suivent', 'Mon  Projet'],
  ['un caractère sans largeur au milieu d’un nom', 'Kan\u200bban'],
] as const;
