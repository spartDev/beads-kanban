import { defaultFilter } from 'cmdk';

/**
 * Recherche de la palette ⌘K : logique pure, sans React. cmdk ne filtre pas (`shouldFilter={false}`) :
 * il ne saurait ni classer des milliers de tickets sans ralentir, ni distinguer un id d'un titre.
 *
 * Règles : tous les mots de la requête doivent correspondre (ET) ; les accents et la casse sont ignorés ;
 * un id l'emporte sur un titre (`38k.6` retrouve `bdesk-38k.6`) ; un début de mot l'emporte sur le
 * milieu d'un mot. Si rien ne correspond, on retente en approximatif (abréviations, fautes de frappe).
 */

export interface Searchable {
  /** Identifiant à reconnaître tel quel : `bdesk-38k.6`, préfixe d'un Projet. */
  id?: string;
  /** Texte principal : titre du ticket, nom du Projet, libellé de la commande. */
  text: string;
  /** Autres mots qui doivent aussi trouver l'élément (type, synonymes). */
  keywords?: readonly string[];
}

export interface SearchResult<T> {
  items: T[];
  /** Nombre total de correspondances, avant la limite. */
  total: number;
  /** Meilleur score du lot (0 s'il est vide) : sert à ordonner les groupes. */
  best: number;
}

/** Minuscules, sans accents ni ligatures (« Épics », « œuvre » deviennent « epics », « oeuvre »). */
export function normalize(text: string): string {
  return text
    .normalize('NFD')
    .replace(/\p{M}/gu, '')
    .toLowerCase()
    .replace(/œ/g, 'oe')
    .replace(/æ/g, 'ae');
}

interface Term {
  text: string;
  /** Le mot apparaît au début d'un mot du texte. */
  wordStart: RegExp;
}

const escapeRegExp = (text: string): string => text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

function compile(query: string): Term[] {
  return normalize(query)
    .split(/\s+/)
    .filter(Boolean)
    .map((text) => ({ text, wordStart: new RegExp(`(?:^|[^a-z0-9])${escapeRegExp(text)}`) }));
}

function scoreText(term: Term, text: string): number {
  if (text === term.text) return 900;
  if (text.startsWith(term.text)) return 800;
  if (term.wordStart.test(text)) return 600;
  return text.includes(term.text) ? 400 : 0;
}

function scoreId(term: Term, id: string): number {
  if (id === term.text) return 1000;
  // `bdesk-38k.6` : on reconnaît aussi la partie après le préfixe.
  const dash = id.indexOf('-');
  const suffix = dash >= 0 ? id.slice(dash + 1) : id;
  if (suffix === term.text) return 950;
  if (id.startsWith(term.text)) return 900;
  if (suffix.startsWith(term.text)) return 850;
  return id.includes(term.text) ? 700 : 0;
}

interface Indexed {
  id: string;
  text: string;
  keywords: string;
}

// Les objets Issue gardent la même référence tant que la requête n'est pas rechargée :
// on ne normalise leurs textes qu'une fois, pas à chaque frappe.
const indexCache = new WeakMap<object, Indexed>();

function index(item: object, describe: () => Searchable): Indexed {
  let indexed = indexCache.get(item);
  if (!indexed) {
    const { id = '', text, keywords = [] } = describe();
    indexed = { id: normalize(id), text: normalize(text), keywords: normalize(keywords.join(' ')) };
    indexCache.set(item, indexed);
  }
  return indexed;
}

function scoreItem(terms: Term[], { id, text, keywords }: Indexed): number {
  let total = 0;
  for (const term of terms) {
    const best = Math.max(
      id ? scoreId(term, id) : 0,
      scoreText(term, text),
      keywords && scoreText(term, keywords) > 0 ? 300 : 0,
    );
    if (best === 0) return 0;
    total += best;
  }
  return total / terms.length;
}

/**
 * Classe `items` selon `query` ; sans requête, garde l'ordre fourni (à l'appelant de le trier).
 * `describe` dit quoi chercher dans chaque élément.
 */
export function rank<T extends object>(
  items: readonly T[],
  query: string,
  describe: (item: T) => Searchable,
  limit = Number.POSITIVE_INFINITY,
): SearchResult<T> {
  const terms = compile(query);
  if (terms.length === 0) {
    return { items: items.slice(0, limit), total: items.length, best: items.length > 0 ? 1 : 0 };
  }

  const scored: { item: T; score: number }[] = [];
  for (const item of items) {
    const score = scoreItem(terms, index(item, () => describe(item)));
    if (score > 0) scored.push({ item, score });
  }

  // Rien d'exact : on tolère les abréviations et les fautes (« kbn », « metrqiues »).
  const trimmed = normalize(query).trim();
  if (scored.length === 0 && trimmed.length >= 3) {
    for (const item of items) {
      const { id, text } = index(item, () => describe(item));
      const score = defaultFilter(`${id} ${text}`, trimmed) * 100;
      if (score > 0) scored.push({ item, score });
    }
  }

  // Tri stable : à score égal, l'ordre d'origine (par exemple le plus récent d'abord) est conservé.
  scored.sort((a, b) => b.score - a.score);
  return {
    items: scored.slice(0, limit).map((entry) => entry.item),
    total: scored.length,
    best: scored[0]?.score ?? 0,
  };
}
