import { classesOf, declared, FLEX_SHRINK, flexShrinkOf, lengthOf, ownRules, rulesFor, seenBy, type Rule } from './compiledCss';

/**
 * Ce que le navigateur fera d'un identifiant de ticket trop long pour sa ligne (bdesk-38k.90), lu dans la feuille de style de l'application (test/compiledCss.ts) : jsdom ne met rien en page. Un identifiant de 100 à 255 caractères
 * peut n'avoir aucune occasion de passer à la ligne (ni espace, ni tiret) : il déborde de son conteneur, qui défile alors d'un côté, ou rogne sans barre, quand l'une des trois choses suivantes manque.
 *
 * 1. Le texte doit pouvoir se couper n'importe où : `overflow-wrap: anywhere` ou `word-break: break-all`, posé sur l'élément ou hérité d'un ancêtre (ce sont des propriétés héritées), et un `white-space` ou un mode de retour à la ligne du texte qui le laisse passer à la ligne. Sans cela,
 *    la plus petite largeur du texte est celle de l'identifiant entier : rien ne peut rétrécir en dessous.
 * 2. Chaque boîte entre l'identifiant et la ligne qui le porte doit pouvoir être plus étroite que lui, quand elle est un élément d'une boîte flex qui range en ligne. Soit elle rétrécit (un facteur de rétrécissement non nul, et une largeur minimale nulle,
 *    ou réduite à rien par la coupure du texte quand elle reste « auto »). Soit elle est plafonnée à la largeur de la ligne (`max-width: 100%`) ET la boîte flex passe à la ligne (`flex-wrap: wrap`) : un plafond ne réduit que cet élément, et sur une ligne qui ne
 *    passe pas à la ligne ses voisins (pictogramme, écart, statut) prennent leur place et le contenu déborde quand même (à 152 caractères, le panneau défilait de 818 px pour 670). Une largeur minimale posée en ligne (`style`) ne l'est que si elle est elle-même
 *    plafonnée (`min(…, 100%)`) : à 152 caractères, la colonne d'identifiants alignée de `ChildRow` faisait 152ch, et la largeur minimale l'emporte sur toute largeur maximale. Dans une boîte flex en colonne, ou hors d'une boîte flex, la largeur de la boîte est celle
 *    du conteneur : il n'y a rien à lire.
 * 3. Une largeur que la mise en page s'est donnée doit s'appliquer : `max-width` n'agit pas sur un élément en ligne (un `span` dans un lien), seulement sur un bloc, un élément en ligne-bloc ou un élément d'une boîte flex. Le tableau de données plafonne
 *    l'identifiant à 40 caractères par `max-width` : le lien qui le porte est une boîte flex en colonne, et sans elle le plafond ne ferait rien (la région de données défilait de 1 309 px pour 589).
 *
 * Ce que ce module ne voit pas : la mise en page elle-même (le nombre de lignes du texte, ce qu'une boîte voisine prend), les règles de `styles.css` écrites par nom d'élément, un conteneur qui ne serait ni un élément flex ni un bloc (une grille, `display: contents` :
 * refusés plutôt qu'ignorés), et la largeur du conteneur de la ligne (celle des listes, du panneau, de la page : mesurées en navigateur, voir la preuve de bdesk-38k.90). Il lit les classes comme les tests de taille de cible (`ownRules`, `flexShrinkOf`,
 * test/compiledCss.ts) : une règle qui nomme une classe de l'élément autrement que seule et déclare l'une des propriétés qu'il lit, une écriture qu'il ne sait pas lire (`flex-flow`, le mode du retour à la ligne, les largeurs logiques…), un `style` en ligne qui en pose une
 * (sauf `min-width`, qu'il lit) ou un facteur de rétrécissement qu'il ne sait pas résoudre le font échouer, au lieu de passer en silence.
 */

const OVERFLOW_WRAP = 'overflow-wrap';
const WORD_BREAK = 'word-break';
const WHITE_SPACE = 'white-space';
/** La propriété du retour à la ligne du texte (`nowrap` l'interdit), écrite en morceaux : Tailwind lit aussi ce module, et le nom écrit d'un bloc y ferait naître la classe de même nom dans la feuille de style de l'application. */
const TEXT_WRAP = ['text', 'wrap'].join('-');
const TEXT_WRAP_MODE = [TEXT_WRAP, 'mode'].join('-');

/** Ce qu'il lit pour couper le texte (des propriétés héritées), et ce qu'il refuse : l'ancien nom de `overflow-wrap`, l'écriture séparée du mode de retour à la ligne, `white-space-collapse`. */
const TEXT = { read: [OVERFLOW_WRAP, WORD_BREAK, WHITE_SPACE, TEXT_WRAP], unread: ['word-wrap', TEXT_WRAP_MODE, 'white-space-collapse'] };
/** Ce qu'il lit d'une boîte : sa nature, son rangement (flex), ses largeurs et son rétrécissement ; et ce qu'il refuse : le raccourci du rangement, les largeurs logiques. */
const BOX = { read: ['display', 'flex-direction', 'flex-wrap', 'max-width', 'min-width', 'flex', FLEX_SHRINK], unread: ['flex-flow', 'inline-size', 'min-inline-size', 'max-inline-size'] };
/** Ce qu'un `style` en ligne ne doit pas poser : tout ce qui précède, hors `min-width`, que `faultsOf` lit. */
const NOT_INLINE = [...TEXT.read, ...TEXT.unread, ...BOX.read.filter((property) => property !== 'min-width'), ...BOX.unread];

/** Les valeurs de coupure que ce module connaît : une autre fait échouer le test, au lieu de passer pour « ne coupe pas ». */
const KNOWN_WRAP = ['normal', 'anywhere', 'break-word'];
const KNOWN_BREAK = ['normal', 'break-all', 'keep-all', 'break-word'];
/** Les éléments « remplacés » : leur largeur s'applique même en ligne. */
const REPLACED = ['img', 'svg', 'video', 'canvas', 'iframe'];

/** La feuille de style de ces éléments : celle de l'application, compilée pour toutes les classes qu'ils portent. */
const sheets = new Map<string, Promise<Rule[]>>();
function sheetOf(elements: readonly Element[]): Promise<Rule[]> {
  const classes = [...new Set(elements.flatMap(classesOf))].sort();
  const key = classes.join(' ');
  if (!sheets.has(key)) sheets.set(key, rulesFor(classes));
  return sheets.get(key) as Promise<Rule[]>;
}

/** Les ancêtres d'un élément, lui compris, du plus proche au plus lointain. */
function chainOf(element: Element): Element[] {
  const chain: Element[] = [];
  for (let at: Element | null = element; at; at = at.parentElement) chain.push(at);
  return chain;
}

/**
 * Une largeur minimale nulle (`min-w-0`). `auto` et les valeurs qui ne sont pas des longueurs (`100%`, `min-content`…) n'en sont pas une ; toute autre valeur se lit par `lengthOf` et fait échouer le test si elle ne sait pas la lire (`em`, `vw`…).
 * Ses variables (`--spacing`) se lisent dans la feuille de style que l'élément voit (`seenBy` : le thème, lui, ses ancêtres), non dans celle des classes de toute la chaîne.
 */
function isZero(seen: readonly Rule[], value: string): boolean {
  if (value === 'auto' || /%$/.test(value) || /^(min|max|fit)-content/.test(value)) return false;
  return lengthOf(seen, value, 16) === 0;
}

/** Ce que les classes de l'élément déclarent, seules, pour cette propriété à cette largeur de fenêtre : `undefined` quand aucune règle n'en pose (la valeur initiale ou héritée). */
export async function declaredOf(element: Element, property: string, viewport: number): Promise<string | undefined> {
  const sheet = await sheetOf([element]);
  return declared(ownRules(sheet, element, [property], [...BOX.unread, ...TEXT.unread]), [property], viewport);
}

export interface Where {
  /** L'élément qui porte la ligne de l'identifiant (le `li`, la cellule) : on remonte de l'identifiant jusqu'à lui, sans le compter. */
  within: Element;
  /** La largeur de la fenêtre, en px (les classes `md:` s'y lisent). */
  viewport: number;
}

/**
 * Ce qui empêche cet élément, qui écrit un identifiant long, de tenir dans la ligne qui le porte : une phrase par défaut trouvé, la liste vide quand il tient (voir plus haut ce que ce module lit).
 * `identifier` est l'élément dont le texte est l'identifiant (ou la phrase qui le cite : « Attend … ») ; la lecture suit les ancêtres jusqu'à `within`.
 */
export async function faultsOf(identifier: Element, { within, viewport }: Where): Promise<string[]> {
  const chain = chainOf(identifier);
  const sheet = await sheetOf(chain);
  const describe = (element: Element) => `<${element.tagName.toLowerCase()} class="${classesOf(element).join(' ')}">`;

  // Les règles de chaque élément pour ce qu'on lit de lui : une règle qu'on ne sait pas lire fait échouer, mais seulement pour les éléments qu'on lit (le texte : de l'identifiant au plus proche ancêtre qui le dit ; la boîte : jusqu'à `within`).
  const memo = new Map<string, Rule[]>();
  const rulesOf = (kind: 'text' | 'box', element: Element) => {
    const key = `${kind}:${chain.indexOf(element)}`;
    if (!memo.has(key)) memo.set(key, ownRules(sheet, element, kind === 'text' ? TEXT.read : BOX.read, kind === 'text' ? TEXT.unread : BOX.unread));
    return memo.get(key) as Rule[];
  };
  const inline = (element: Element) => {
    const style = element instanceof HTMLElement ? element.style : undefined;
    const written = NOT_INLINE.find((property) => style?.getPropertyValue(property));
    if (written) throw new Error(`Style en ligne que ce test ne sait pas lire : ${describe(element)} pose ${written}`);
    return style?.minWidth ?? '';
  };
  const read = (kind: 'text' | 'box', element: Element, property: string) => declared(rulesOf(kind, element), [property], viewport);
  // Une propriété héritée : la valeur du plus proche élément (lui compris) qui la déclare.
  const inherited = (property: string): string | undefined => {
    for (const element of chain) {
      const value = read('text', element, property);
      if (value !== undefined) return value;
    }
    return undefined;
  };
  const faults: string[] = [];

  const wrap = inherited(OVERFLOW_WRAP) ?? 'normal';
  const breakKind = inherited(WORD_BREAK) ?? 'normal';
  const space = inherited(WHITE_SPACE) ?? 'normal';
  const textWrap = inherited(TEXT_WRAP) ?? 'wrap';
  if (!KNOWN_WRAP.includes(wrap)) throw new Error(`Valeur de ${OVERFLOW_WRAP} que ce test ne sait pas lire : ${wrap}`);
  if (!KNOWN_BREAK.includes(breakKind)) throw new Error(`Valeur de ${WORD_BREAK} que ce test ne sait pas lire : ${breakKind}`);
  const breaksAnywhere = wrap === 'anywhere' || breakKind === 'break-all';
  if (!breaksAnywhere && wrap !== 'break-word' && breakKind !== 'break-word') {
    faults.push(`le texte ne peut pas se couper : ${OVERFLOW_WRAP} vaut « ${wrap} » et ${WORD_BREAK} « ${breakKind} » (${describe(identifier)} et ses ancêtres)`);
  }
  if (/^(nowrap|pre)$/.test(space)) faults.push(`le texte ne passe pas à la ligne : ${WHITE_SPACE} vaut « ${space} »`);
  if (/\bnowrap\b/.test(textWrap)) faults.push(`le texte ne passe pas à la ligne : ${TEXT_WRAP} vaut « ${textWrap} »`);

  for (let element: Element | null = identifier; element && element !== within; element = element.parentElement) {
    const parent = element.parentElement;
    if (!parent) break;
    const display = read('box', parent, 'display');
    const direction = read('box', parent, 'flex-direction') ?? 'row';
    const own = read('box', element, 'display');
    if (display !== undefined && /grid$/.test(display)) throw new Error(`Conteneur en grille que ce test ne sait pas lire : ${describe(parent)}`);
    if (display === 'contents' || own === 'contents') throw new Error(`Boîte « display: contents » que ce test ne sait pas lire : ${describe(display === 'contents' ? parent : element)}`);
    const inFlex = display === 'flex' || display === 'inline-flex';
    const styledMinimum = inline(element);

    if (inFlex && direction.startsWith('row')) {
      // Un élément d'une boîte flex qui range en ligne : sa largeur n'est celle du conteneur que s'il rétrécit, ou s'il y est plafonné sur une boîte qui passe à la ligne.
      const capped = read('box', element, 'max-width') === '100%';
      const wraps = /^wrap(-reverse)?$/.test(read('box', parent, 'flex-wrap') ?? 'nowrap');
      const minimum = read('box', element, 'min-width');
      const zero = minimum !== undefined && isZero(seenBy(sheet, element, chain), minimum);
      const factor = flexShrinkOf(seenBy(sheet, element, chain), rulesOf('box', element), viewport);
      // « auto » : la largeur minimale d'un élément flex est celle de son contenu, que la coupure n'importe où réduit à rien ; une largeur minimale posée (autre que nulle) n'est celle de personne : on ne la croit pas assez petite.
      const shrinks = factor > 0 && (zero || ((minimum === undefined || minimum === 'auto') && breaksAnywhere));
      if (!shrinks && !capped) {
        faults.push(`${describe(element)} ne rétrécit pas (facteur ${factor}${minimum === undefined || minimum === 'auto' ? ', largeur minimale celle du texte' : `, largeur minimale ${minimum}`}) et n'est pas plafonné à la largeur de sa ligne (max-width: 100%)`);
      } else if (!shrinks && !wraps) {
        faults.push(`${describe(element)} est plafonné à la largeur de sa ligne (max-width: 100%) mais ${describe(parent)} ne passe pas à la ligne (flex-wrap) : ses voisins prennent la place que le plafond lui laisse, et la ligne déborde`);
      }
      // La largeur minimale posée en ligne l'emporte sur toute largeur maximale : elle doit être plafonnée elle-même.
      if (styledMinimum && !/^(0|0px)$/.test(styledMinimum) && !/^min\(.+,\s*100%\)$/.test(styledMinimum)) {
        faults.push(`${describe(element)} a une largeur minimale de ${styledMinimum} en ligne, que rien ne plafonne à la largeur de la ligne (min(…, 100%))`);
      }
    }

    // Une largeur maximale ou minimale ne s'applique qu'à une boîte : un bloc, un élément en ligne-bloc ou un élément flex (un élément d'une boîte flex l'est, quel que soit son `display`). Sur un élément en ligne, `max-w-*` et `min-w-0` ne font rien.
    for (const property of ['max-width', 'min-width']) {
      const width = read('box', element, property);
      if (width === undefined || width === 'none' || width === 'auto') continue;
      if (!inFlex && !REPLACED.includes(element.tagName.toLowerCase()) && (own ?? getComputedStyle(element).display) === 'inline') {
        faults.push(`${describe(element)} déclare ${property}: ${width}, qui ne s'applique pas à un élément en ligne dont le parent (${describe(parent)}) n'est pas une boîte flex`);
      }
    }
  }
  return faults;
}
