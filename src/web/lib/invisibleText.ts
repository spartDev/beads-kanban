/**
 * Des blancs (`White_Space` : l'espace insécable, les espaces larges, U+0085 que `\s` ignore), des caractères « ignorables par défaut » (`Default_Ignorable_Code_Point` : ceux qu'Unicode demande
 * de ne pas dessiner) et le blanc braille (U+2800), et rien d'autre.
 */
const INVISIBLE = /^[\p{White_Space}\p{Default_Ignorable_Code_Point}\u2800]*$/u;

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
