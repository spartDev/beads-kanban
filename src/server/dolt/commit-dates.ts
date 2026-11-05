/**
 * Rend croissantes les dates des commits d'une lignée, du plus ancien au plus récent, en n'en changeant que le moins possible
 * (ADR 0001, bdesk-38k.26). L'horloge d'une machine peut reculer ou avancer d'un commit à l'autre : un commit n'en vient pas moins
 * après les précédents, et c'est l'ordre de la lignée qui fait foi, non sa date.
 *
 * On garde la plus longue suite de commits aux dates déjà croissantes (les égalités sont permises) ; à longueur égale, celle qui
 * garde les commits les plus anciens. Chaque autre commit prend, de toutes les dates qui respectent l'ordre de la lignée, la plus
 * proche de la sienne : celle du commit gardé qui le précède si son horloge a reculé, celle du commit gardé qui le suit si elle
 * était en avance. Il n'y a donc jamais plus de commits changés que de commits dont l'horloge est fautive, et une faute isolée n'en
 * déplace qu'un : un commit daté trente jours trop tard ne repousse pas ceux qui le suivent, ce que ferait la date la plus tardive
 * des commits précédents. Sur une lignée aux dates déjà croissantes, qui est celle de tout Projet dont les horloges tiennent, rien
 * ne change : les mêmes commits sont rendus.
 *
 * `now` est l'instant de la lecture. Un commit n'est pas fait dans le futur : une date postérieure à `now` est forcément fausse, et
 * ne peut pas être gardée, quelle que soit la longueur de la suite qu'elle ouvrirait. Le commit prend la date du commit gardé qui le
 * suit, sans jamais dépasser `now` : le dernier de la lignée, s'il est daté du futur, vient d'être fait. Sans cela, un commit en
 * avance suivi d'un seul commit à l'heure ferait dater ce dernier dans le futur.
 *
 * La correction dépend de toute la lignée : un commit de plus peut en redater de passés. Deux commits que tout oppose (le second est
 * daté avant le premier, rien d'autre ne les départage) laissent leur date au plus ancien, et c'est le second qui est ramené, comme
 * le ferait un changement de statut qui ne remonte pas le temps, jusqu'à ce qu'un commit de plus dise lequel avait tort.
 */
export function ascendingDates<T extends { at: Date }>(commits: readonly T[], now: Date): T[] {
  const limit = now.getTime();
  const times = commits.map((commit) => commit.at.getTime());
  const kept = longestAscendingRun(times, limit);

  // La date du plus proche commit gardé qui suit chacun, de la droite vers la gauche, à défaut l'instant de la lecture.
  const ceilings = new Array<number>(times.length);
  let ceiling = limit;
  for (let i = times.length - 1; i >= 0; i--) {
    if (kept[i]) ceiling = times[i] as number;
    ceilings[i] = ceiling;
  }

  let floor = Number.NEGATIVE_INFINITY;
  return commits.map((commit, i) => {
    const time = kept[i] ? (times[i] as number) : Math.max(floor, Math.min(times[i] as number, ceilings[i] as number));
    floor = time;
    return time === commit.at.getTime() ? commit : { ...commit, at: new Date(time) };
  });
}

/**
 * Les rangs d'une plus longue suite non décroissante des `times` qui ne dépassent pas `limit` (la plus ancienne à longueur égale) :
 * `true` aux commits gardés. `longest[i]` est la longueur de la plus longue suite qui commence en i, calculée de la droite vers la
 * gauche avec un arbre de Fenwick du maximum indexé par la date, les plus grandes d'abord (« les suites qui commencent à une date
 * ≥ d » forment un préfixe) : n log n, la lignée d'un Projet pouvant compter 10 000 commits. Un commit daté après `limit` n'ouvre
 * aucune suite.
 */
function longestAscendingRun(times: readonly number[], limit: number): boolean[] {
  const values = [...new Set(times.filter((time) => time <= limit))].sort((a, b) => b - a);
  const position = new Map(values.map((value, i) => [value, i + 1]));
  const tree = new Array<number>(values.length + 1).fill(0);
  const longest = new Array<number>(times.length).fill(0);
  for (let i = times.length - 1; i >= 0; i--) {
    const p = position.get(times[i] as number);
    if (p === undefined) continue;
    let best = 0;
    for (let k = p; k > 0; k -= k & -k) best = Math.max(best, tree[k] as number);
    longest[i] = best + 1;
    for (let k = p; k <= values.length; k += k & -k) tree[k] = Math.max(tree[k] as number, best + 1);
  }

  // La plus ancienne : le premier commit qui peut ouvrir une suite de la longueur maximale, puis à chaque fois le premier qui peut la
  // continuer. Un seul passage, de la gauche vers la droite.
  const kept = new Array<boolean>(times.length).fill(false);
  let wanted = longest.reduce((best, length) => Math.max(best, length), 0);
  let last = Number.NEGATIVE_INFINITY;
  for (let i = 0; i < times.length && wanted > 0; i++) {
    if (longest[i] === wanted && (times[i] as number) >= last) {
      kept[i] = true;
      last = times[i] as number;
      wanted--;
    }
  }
  return kept;
}
