import { describe, expect, it } from 'vitest';

/**
 * Toute région de statut écrite dans le code de l'interface a un nom (bdesk-38k.65). `Notice` se nomme de son titre, les squelettes de leur `aria-label`, et les trois autres (le graphique vide,
 * la palette) ont été nommés par ce ticket : une région de statut sans `aria-label` ni `aria-labelledby` est une région dont un lecteur d'écran ne sait pas de quoi elle rend compte. Ce test lit le
 * code et refuse la prochaine : un nouveau statut sans nom échoue ici, sans qu'aucun écran ait à le monter dans l'état qui l'affiche.
 *
 * Ce qu'il lit : un `role` écrit `"status"`, `'status'` ou `{'status'}` (guillemets, apostrophes ou apostrophes inversées), et `<output>`, dont le rôle est `status` sans qu'on l'écrive. Un nom vide
 * (`aria-label=""`) n'en est pas un. Un nom qui peut arriver par une propagation (`{...props}`) n'est pas refusé : on ne peut pas le lire d'ici.
 *
 * Ce qu'il ne lit pas : un rôle choisi à l'exécution (`role={danger ? 'alert' : 'status'}`, comme `Notice`, dont les tests le nomment), ni la valeur d'un nom écrit en expression :
 * `aria-labelledby={id}` passe même quand `id` peut valoir `undefined`, comme celui d'`EmptyChart` hors d'une carte (ses tests le montent dans chaque carte).
 */

const sources = import.meta.glob<string>(['../**/*.tsx', '!../**/*.test.tsx'], { query: '?raw', import: 'default', eager: true });

/** L'étiquette ouvrante qui contient l'indice `at` : de son `<` au premier `>` qui n'est ni dans une accolade ni dans un guillemet. */
function openingTag(source: string, at: number): string {
  const start = source.lastIndexOf('<', at);
  let depth = 0;
  let quote = false;
  for (let index = start; index < source.length; index++) {
    const char = source[index];
    if (depth === 0 && char === '"') quote = !quote;
    else if (quote) continue;
    else if (char === '{') depth++;
    else if (char === '}') depth--;
    else if (char === '>' && depth === 0) return source.slice(start, index + 1);
  }
  throw new Error(`Étiquette jamais refermée, à l'indice ${start}`);
}

/** Vrai quand ce qui précède l'indice `at`, sur sa ligne, ouvre un commentaire : le rôle y est cité, pas écrit. */
const inComment = (source: string, at: number): boolean => /^\s*(?:\/\/|\*|\/\*|\{\/\*)/.test(source.slice(source.lastIndexOf('\n', at) + 1, at));

/** Ce qui fait d'une étiquette une région de statut : le rôle écrit, sous l'une de ses formes, ou `<output>`. */
const STATUS_ROLE = /\brole=(?:"status"|'status'|\{\s*(?:"status"|'status'|`status`)\s*\})/g;
const OUTPUT = /<output\b/g;

/** Les étiquettes de région de statut de `source`, une fois chacune (un `<output role="status">` se lit deux fois, et n'en est qu'une). */
function statusTags(source: string): string[] {
  const tags = new Set<string>();
  for (const pattern of [STATUS_ROLE, OUTPUT]) {
    for (const match of source.matchAll(pattern)) if (!inComment(source, match.index)) tags.add(openingTag(source, match.index));
  }
  return [...tags];
}

/** Le début d'une valeur qui est vide : `""`, `''`, ou `{""}`, `{''}`, `{``}`. */
const EMPTY_VALUE = /^(?:""|''|\{\s*(?:""|''|``))/;

/** Vrai quand l'étiquette porte un nom : un `aria-label` ou un `aria-labelledby` qui n'est pas vide, ou une propagation d'où il peut venir. */
function isNamed(tag: string): boolean {
  if (/\{\s*\.\.\./.test(tag)) return true;
  return [...tag.matchAll(/\saria-label(?:ledby)?=([^]{0,12})/g)].some((match) => !EMPTY_VALUE.test(match[1] ?? ''));
}

const unnamed = (source: string): string[] => statusTags(source).filter((tag) => !isNamed(tag));

describe('la garde des régions de statut sait lire ce qu’elle garde', () => {
  it.each([
    ['un rôle écrit entre guillemets, sans nom', '<p role="status">Rien</p>'],
    ['un rôle écrit entre apostrophes, sans nom', "<p role='status'>Rien</p>"],
    ['un rôle écrit en expression à apostrophes, sans nom', "<p role={'status'}>Rien</p>"],
    ['un rôle écrit en expression à guillemets, sans nom', '<p role={"status"}>Rien</p>'],
    ['un <output>, sans nom', '<output>3 résultats</output>'],
    ['un <output> au rôle écrit, sans nom (une seule étiquette)', '<output role="status">3 résultats</output>'],
    ['un nom vide', '<p role="status" aria-label="">Rien</p>'],
    ['un nom vide entre apostrophes', "<p role='status' aria-label=''>Rien</p>"],
    ['un nom vide en expression', "<p role=\"status\" aria-label={''}>Rien</p>"],
    ['un renvoi vide', '<p role="status" aria-labelledby="">Rien</p>'],
  ])('refuse %s', (_kind, source) => {
    expect(unnamed(source)).toHaveLength(1);
  });

  it.each([
    ['un `aria-label`', '<p role="status" aria-label="État de la recherche">Rien</p>'],
    ['un `aria-labelledby`', '<p role="status" aria-labelledby="titre">Rien</p>'],
    ['un nom écrit en expression', '<p role="status" aria-label={SEARCH_STATE}>Rien</p>'],
    ['un renvoi écrit en expression', '<p role="status" aria-labelledby={titleId}>Rien</p>'],
    ['un <output> nommé', '<output aria-label="Total">3</output>'],
    ['des propriétés propagées, d’où le nom peut venir', '<p role="status" {...props}>Rien</p>'],
    ['un statut cité dans un commentaire', '// <p role="status"> sans nom\n<p>Rien</p>'],
    ['un autre rôle', '<p role="alert">Rien</p>'],
  ])('accepte %s', (_kind, source) => {
    expect(unnamed(source)).toEqual([]);
  });
});

describe('les régions de statut du code de l’interface', () => {
  const statuses = Object.entries(sources).flatMap(([file, source]) => statusTags(source).map((tag) => ({ file: file.replace('../', 'src/web/'), tag })));

  it('sont retrouvées : le test lit bien le code (palette, graphique vide, squelettes…)', () => {
    expect(statuses.length).toBeGreaterThanOrEqual(10);
    expect(new Set(statuses.map(({ file }) => file))).toContain('src/web/palette/CommandPalette.tsx');
  });

  it('portent toutes un nom, `aria-label` ou `aria-labelledby`', () => {
    const missing = statuses.filter(({ tag }) => !isNamed(tag)).map(({ file, tag }) => `${file} : ${tag.replace(/\s+/g, ' ').slice(0, 90)}…`);

    expect(missing).toEqual([]);
  });
});
