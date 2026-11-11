/**
 * Des textes qu'on ne voit pas (bdesk-38k.61, bdesk-38k.65) : vides, faits de blancs de toute sorte, de caractères sans largeur (de mise en forme, ou ignorables par défaut selon Unicode),
 * ou de ces caractères que la police laisse blancs sans en avoir l'air : le remplisseur hangul (U+3164), le blanc braille (U+2800). `trim()` n'en retire pas tous, et axe ne signale pas un
 * nom qui en est fait : un titre qui en est fait n'a aucun nom pour un lecteur d'écran. Écrits ici, un à un, et non importés ni dérivés du code qu'ils éprouvent : un test ne doit pas
 * dépendre de ce qu'il éprouve. Chaque caractère de ces textes a été dessiné dans Chromium 156, un à un, dans la police de l'application : aucun ne laisse un seul pixel.
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
  // Ce que la police laisse blanc, et que ni `trim()` ni la catégorie `Cf` ne prennent pour tel (bdesk-38k.65).
  ['fait d’un blanc braille (U+2800)', '\u2800'],
  ['fait d’un remplisseur hangul (U+3164)', '\u3164'],
  ['fait d’un remplisseur hangul demi-chasse (U+FFA0)', '\uffa0'],
  ['fait d’un joint de graphèmes (U+034F)', '\u034f'],
  ['fait de voyelles khmères inhérentes (U+17B4, U+17B5)', '\u17b4\u17b5'],
  ['fait d’un sélecteur de variante (U+FE0F)', '\ufe0f'],
  ['fait d’un sélecteur de variante étendu (U+E0100)', '\u{e0100}'],
  ['fait d’une espace de contrôle (U+0085)', '\u0085'],
  // Les ancres d'annotation (bdesk-38k.77) : `Cf`, que `Default_Ignorable_Code_Point` exclut. Chromium n'en dessine aucun pixel, à aucune graisse, et la catégorie `Cf` les disait déjà invisibles.
  ['fait d’une ancre d’annotation (U+FFF9)', '\ufff9'],
  ['fait d’un séparateur et d’un terminateur d’annotation (U+FFFA, U+FFFB)', '\ufffa\ufffb'],
  // Ce que la catégorie `Cf` comptait déjà, et que la règle garde.
  ['fait d’un séparateur de voyelle mongol (U+180E)', '\u180e'],
  ['fait d’une marque de lettre arabe (U+061C)', '\u061c'],
  ['fait d’opérateurs mathématiques invisibles (U+2061 à U+2064)', '\u2061\u2062\u2063\u2064'],
  ['fait d’une marque de sens d’écriture (U+200E)', '\u200e'],
  ['fait d’espaces larges (U+2003, U+3000)', '\u2003\u3000'],
  ['mêlé d’un remplisseur, d’un blanc braille et d’espaces', ' \u3164\u2800 \u200b'],
] as const;

/**
 * Des textes qui se voient, donc ce que l'auteur a écrit : ils ne sont pas invisibles, et une page les écrit tels quels, jusqu'à leurs blancs. De la ponctuation seule en est : un dossier
 * peut s'appeler « - » ou « : », et les règles d'une autre partie de l'interface (le nom d'une Epic, `epicName`, qui dit son identifiant quand son titre n'est fait que de séparateurs) ne sont pas les siennes.
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
  // Ce qui se dessine, alors que la catégorie `Cf` le tenait pour invisible : des signes que l'écriture arabe et syriaque pose devant un nombre (bdesk-38k.65).
  ['une marque arabe qui se dessine (U+06DD)', '\u06dd'],
  ['un signe arabe qui se dessine (U+0600)', '\u0600'],
  ['un signe d’abréviation syriaque (U+070F)', '\u070f'],
  // Ce qui touche un caractère qu'on ne voit pas, sans en être un : un seul caractère visible, où qu'il soit, suffit.
  ['un point braille (U+2801), voisin du blanc braille', '\u2801'],
  ['une lettre hangul (U+3163), voisine du remplisseur', '\u3163'],
  ['un nom entre des remplisseurs et des blancs', '\u3164Kanban\u2800'],
] as const;
