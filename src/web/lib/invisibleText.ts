/** Des blancs (`\s` : l'espace insécable aussi) et des caractères de mise en forme sans largeur (catégorie Unicode `Cf` : U+200B à U+200D, U+2060, U+00AD, U+FEFF…), et rien d'autre. */
const INVISIBLE = /^[\s\p{Cf}]*$/u;

/**
 * Un texte qu'on ne voit pas : vide, fait de blancs, ou de caractères sans largeur. Un titre qui en est fait n'a aucun nom pour un lecteur d'écran, et rien ne le signale : `trim()` ne
 * retire que les blancs et U+FEFF, pas U+200B à U+200D, U+2060 ni U+00AD, qui laissent un nom accessible invisible, que ni axe ni les lecteurs d'écran ne relèvent.
 *
 * Seul ce qu'on ne voit pas compte : une ponctuation (« - », « : ») se voit, c'est ce que l'auteur a écrit. C'est aussi la règle des titres de ticket (`isBlankTitle`, dans `data/helpers.ts`, écrite
 * là de son côté) : leur titre est de plus rangé sur une ligne (`ticketTitle`), et le nom d'une Epic dit son identifiant quand son titre n'est fait que de séparateurs (`epicName`). Le titre d'une
 * page est le nom d'un dossier, d'une Epic, d'une page : `Page` l'écrit tel quel, sans l'une ni l'autre.
 */
export const isInvisibleText = (text: string): boolean => INVISIBLE.test(text);
