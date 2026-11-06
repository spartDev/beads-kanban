/**
 * Des blancs, au sens d'Unicode (`White_Space` : l'espace insécable, les espaces larges, U+0085 que `\s` ignore) : on les voit comme un vide, et ils occupent leur place.
 */
const BLANKS = String.raw`\p{White_Space}`;

/**
 * Des caractères qu'on ne voit pas sans qu'ils soient des blancs : les caractères « ignorables par défaut » (`Default_Ignorable_Code_Point` : ceux qu'Unicode demande de ne pas dessiner) et le blanc
 * braille (U+2800).
 */
const SILENT = String.raw`\p{Default_Ignorable_Code_Point}\u2800`;

const INVISIBLE = new RegExp(`^[${BLANKS}${SILENT}]*$`, 'u');

/**
 * Un texte qu'on ne voit pas : vide, fait de blancs, ou de caractères que la police ne dessine pas. Un titre qui en est fait n'a aucun nom pour un lecteur d'écran, et rien ne le signale : `trim()` ne
 * retire que les blancs et U+FEFF, et un lien dont le nom est un caractère sans largeur (U+200B), un remplisseur hangul (U+3164) ou un blanc braille (U+2800) a un nom que ni axe ni aucun test ne dit vide.
 *
 * La règle suit Unicode plutôt qu'une liste écrite ici. La catégorie `Cf` (format) ne convient pas. Elle tient pour invisibles des signes qui se dessinent : ceux que l'écriture arabe, syriaque ou kaithi
 * pose devant un nombre ou un mot (U+0600 à U+0605, U+06DD, U+070F, U+0890, U+0891, U+08E2, U+110BD, U+110CD). Et elle laisse voir des caractères que la police ne dessine pas : le remplisseur hangul U+3164
 * et sa demi-chasse U+FFA0, les voyelles khmères inhérentes U+17B4 et U+17B5, le joint de graphèmes U+034F, les sélecteurs de variante. `Default_Ignorable_Code_Point` est `Cf` moins ces signes (et moins les
 * ancres d'annotation U+FFF9 à U+FFFB et les contrôles hiéroglyphiques U+13430 à U+1343F), plus ces caractères hors `Cf` : Unicode la tient à jour, la liste n'est pas à tenir ici. Le blanc braille, une
 * cellule sans point, est un symbole pour Unicode, pas un caractère ignorable : il s'ajoute à la règle. Les autres caractères de contrôle (U+0000 à U+0008, U+000E à U+001F, U+007F à U+009F) n'en font pas
 * partie : Unicode ne les dit ni blancs ni ignorables.
 *
 * Seul ce qu'on ne voit pas compte : une ponctuation (« - », « : ») se voit, c'est ce que l'auteur a écrit. C'est aussi la règle des titres de ticket (`isBlankTitle`, dans `data/helpers.ts`, qui l'appelle) :
 * leur titre est de plus rangé sur une ligne (`ticketTitle`), et le nom d'une Epic dit son identifiant quand son titre n'est fait que de séparateurs (`epicName`). Le titre d'une page est le nom d'un dossier,
 * d'une Epic, d'une page : `Page` l'écrit tel quel, sans l'une ni l'autre, sauf quand on n'en verrait rien.
 */
export const isInvisibleText = (text: string): boolean => INVISIBLE.test(text);

/** Un sélecteur de variante : U+FE00 à U+FE0F, U+E0100 à U+E01EF, U+180B à U+180D et U+180F. */
const SELECTOR = String.raw`\p{Variation_Selector}`;

/**
 * Un caractère qu'on voit : ni un blanc, ni un caractère qu'on ne voit pas (le complément de la classe). C'est à lui qu'un sélecteur de variante fait corps (`ATTACHED`).
 *
 * N'importe quel caractère qu'on voit, et non les seules bases d'une séquence de variation : ces bases sont dites par des fichiers de données d'Unicode (les séquences de variation normalisées, celles des
 * emoji, la base des idéogrammes), que les propriétés des expressions régulières ne donnent pas. Une liste écrite ici serait incomplète, et retirerait un sélecteur qui compte ; un sélecteur derrière une lettre
 * qui n'en a pas ne se dessine pas non plus, et le garder ne change rien à l'écran.
 */
const VISIBLE = String.raw`[^${BLANKS}${SILENT}]`;

/**
 * Un sélecteur de variante qui suit un caractère qu'on voit. Il change la façon de dessiner ce caractère (« ⚠ » suivi de U+FE0F est le signe en couleurs, un idéogramme suivi de U+E0100 l'une de ses formes) :
 * il fait corps avec lui, et ne se retire ni d'une mesure ni du bord d'un texte. Seul, ou derrière un blanc ou un caractère
 * invisible, il ne tient à rien et reste invisible comme les autres (`collapseSpaces`, lui, ne le met jamais dans une série de blancs : voir là). L'assertion « en arrière » demande Safari 16.4, comme `@property`, que la feuille de style de l'application (Tailwind 4) emploie déjà.
 */
const ATTACHED = String.raw`(?<=${VISIBLE})${SELECTOR}`;

/*
 * Les expressions qui rognent, mesurent et comparent les titres ne récrivent pas la classe : elles la prennent ici, et ne diffèrent que par leur forme. `withoutInvisible` et `collapseSpaces`
 * (`data/helpers.ts`), la pastille d'Epic (`kanban/epics.ts`) s'écrivaient par la catégorie `Cf` que la règle ci-dessus écarte : un remplisseur hangul restait au bord d'une pastille, U+06DD en était retiré. Ce sont
 * des sources d'expression régulière, à compiler avec le drapeau `u`. `data/invisibleClass.test.ts` éprouve leur accord avec `isInvisibleText` sur chaque point de code.
 */

/** Un blanc au sens d'Unicode. */
export const BLANK_CHAR = `[${BLANKS}]`;

/** Un caractère qu'on ne voit pas, blanc ou non (la classe de `isInvisibleText`), hors un sélecteur de variante qui fait corps avec le caractère qu'on voit devant lui. */
export const INVISIBLE_CHAR = `(?:(?!${ATTACHED})[${BLANKS}${SILENT}])`;

/** Un caractère qu'on ne voit pas et qui n'est pas un blanc (sans largeur, ou sans encre), hors un sélecteur de variante qui fait corps avec le caractère qu'on voit devant lui. */
export const SILENT_CHAR = `(?:(?!${ATTACHED})[${SILENT}])`;

/** Un sélecteur de variante, où qu'il soit : `collapseSpaces` n'en met jamais dans une série de blancs, et la pastille d'une Epic retire de sa tête ceux qu'une espace sépare de ce qui précède. */
export const SELECTOR_CHAR = `[${SELECTOR}]`;
