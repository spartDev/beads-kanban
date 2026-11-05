import { type DependencyHistory, recordedTransitions, type TicketFlow, type TicketHistory, type TicketId } from './flow';

/** À quoi un bug est rattaché. */
export interface BugAttribution {
  /**
   * Relié à un autre ticket du Projet (hors Epic) : son origine est renseignée, même si ce ticket n'est pas
   * une Livraison antérieure (bug trouvé en cours de travail, par exemple). Le lien peut être celui d'un bug en
   * Abandon que ce bug remplace. Un bug qui n'est relié qu'à une Epic, à un ticket hors Projet ou à lui-même n'est
   * pas relié : une Epic n'est l'origine d'aucun échec.
   */
  linked: boolean;
  /**
   * Livraisons dont le bug est le Bug d'origine ; vide s'il a été trouvé en cours de travail ou n'est pas relié.
   * Jamais non vide quand `linked` est faux : une Livraison en échec est un ticket auquel le bug est relié.
   */
  failedDeliveries: TicketId[];
}

/** Part des bugs dont l'origine est renseignée : sert à juger si le Taux d'échec est significatif. */
export interface FailureCoverage {
  /** Nombre de tickets de type bug, hors Abandon. */
  bugs: number;
  /** Parmi eux, ceux qui sont reliés (voir `BugAttribution.linked`). */
  linked: number;
  /** `linked / bugs`, de 0 à 1 ; null s'il n'y a aucun bug. */
  ratio: number | null;
}

export interface FailureAnalysis {
  /**
   * Bugs d'origine de chaque Livraison, dans l'ordre des tickets ; liste vide si elle n'a pas échoué.
   * Un ticket qui n'est pas une Livraison n'y figure pas.
   */
  originBugs: Map<TicketId, TicketId[]>;
  /** Une entrée par ticket de type bug, hors Abandon : un bug en Abandon transmet ses liens à celui qui le remplace. */
  bugs: Map<TicketId, BugAttribution>;
  coverage: FailureCoverage;
}

/** Lien posé sur le bug lui-même ; sa cible est le ticket en cours duquel le bug a été découvert. */
const ORIGIN_LINK = 'discovered-from';

/**
 * Qualifie les Livraisons en échec (Taux d'échec) et mesure la couverture des bugs reliés.
 * `flows` est le résultat de `analyzeFlow(tickets)`.
 *
 * Un ticket de type bug est le Bug d'origine d'une Livraison quand un lien discovered-from actif, posé sur le bug,
 * pointe vers elle et que le bug a été créé à ou après la date de cette Livraison. Ces deux dates sont celles que
 * l'historique enregistre, non bornées (`isDeliveredBy`). Un bug relié à plusieurs
 * Livraisons est le Bug d'origine de chacune. Un lien vers un ticket ouvert ou en Abandon, ou posé par un bug trouvé
 * avant la Livraison, ne met aucune Livraison en échec mais compte comme « relié » : l'origine est renseignée. Sont
 * ignorés, et ne comptent pas comme « reliés » : un lien retiré, un lien vers le bug lui-même, vers une Epic (elle
 * n'est l'origine d'aucun échec) ou vers un ticket hors Projet, et tout ticket qui n'est pas un bug.
 *
 * Un bug en Abandon (doublon ou remplacé) est écarté de l'analyse : c'est le même défaut qu'un autre bug, à qui il
 * transmet ses liens actifs. Ce bug est le survivant : la cible de son Abandon (`Outcome.of`), ou celle de l'Abandon de cette
 * cible si elle est elle-même en Abandon, jusqu'à un ticket qui ne l'est pas. Le survivant compte ces liens comme les siens, mais
 * à la date de création du bug en Abandon qui les portait : c'est lui qui a constaté le défaut. Il n'est le Bug
 * d'origine d'une Livraison qu'une fois, même s'il y est relié en propre et par héritage. Si le survivant n'est pas
 * un bug du Projet (ticket absent ou d'un autre type, chaîne qui boucle), les liens sont perdus.
 */
export function analyzeFailures(tickets: TicketHistory[], flows: Map<TicketId, TicketFlow>): FailureAnalysis {
  const originBugs = new Map<TicketId, TicketId[]>();
  for (const [id, flow] of flows) {
    if (flow.outcome.kind === 'delivered') originBugs.set(id, []);
  }

  // Origines possibles : tickets hors Epic connus à la fois de `tickets` et de `flows`. `linked` et `failedDeliveries`
  // en dérivent tous deux, donc un `flows` qui ne correspond pas aux tickets ne peut pas les mettre en désaccord.
  const possibleOrigins = new Set(tickets.filter((t) => t.type !== 'epic' && flows.has(t.id)).map((t) => t.id));
  const replaced = replacedBugs(tickets, flows);
  const byId = new Map(tickets.map((t) => [t.id, t]));
  const bugs = new Map<TicketId, BugAttribution>();
  for (const bug of tickets.filter((t) => t.type === 'bug' && !isAbandoned(flows.get(t.id)))) {
    const origins = new Set<TicketId>();
    const failedDeliveries = new Set<TicketId>();
    // Les liens du bug, puis ceux des bugs en Abandon qu'il remplace, chacun daté de la création de son porteur.
    for (const source of [bug, ...(replaced.get(bug.id) ?? [])]) {
      const createdAt = flows.get(source.id)?.transitions[0]?.at;
      for (const { target } of activeLinks(source, bug.id)) {
        if (!possibleOrigins.has(target)) continue;
        origins.add(target);
        if (createdAt && isDeliveredBy(flows.get(target), byId.get(target), createdAt)) failedDeliveries.add(target);
      }
    }
    bugs.set(bug.id, { linked: origins.size > 0, failedDeliveries: [...failedDeliveries] });
    for (const delivery of failedDeliveries) originBugs.get(delivery)?.push(bug.id);
  }

  return { originBugs, bugs, coverage: coverageOf(bugs) };
}

/**
 * Les bugs en Abandon dont chaque ticket est le survivant, dans l'ordre des tickets. Seul un survivant qui est un bug
 * du Projet lit cette liste : sinon les liens de ces bugs sont perdus.
 */
function replacedBugs(tickets: TicketHistory[], flows: Map<TicketId, TicketFlow>): Map<TicketId, TicketHistory[]> {
  const byId = new Map(tickets.map((t) => [t.id, t]));
  const replaced = new Map<TicketId, TicketHistory[]>();
  for (const bug of tickets.filter((t) => t.type === 'bug' && isAbandoned(flows.get(t.id)))) {
    const survivor = survivorOf(bug, byId, flows);
    if (survivor) replaced.set(survivor.id, [...(replaced.get(survivor.id) ?? []), bug]);
  }
  return replaced;
}

/**
 * Le ticket qui reprend le défaut d'un ticket en Abandon : la cible de son Abandon, puis celle de l'Abandon de cette cible
 * si elle est elle-même en Abandon, jusqu'à un ticket qui ne l'est pas. Indéfini si la chaîne mène hors des tickets connus
 * ou boucle sur elle-même.
 */
function survivorOf(
  ticket: TicketHistory,
  byId: Map<TicketId, TicketHistory>,
  flows: Map<TicketId, TicketFlow>,
): TicketHistory | undefined {
  const visited = new Set<TicketId>();
  let current: TicketHistory | undefined = ticket;
  while (current && isAbandoned(flows.get(current.id))) {
    if (visited.has(current.id)) return undefined;
    visited.add(current.id);
    const next = replacementOf(flows.get(current.id));
    current = next === undefined ? undefined : byId.get(next);
  }
  return current;
}

/**
 * Cible du lien d'Abandon d'un ticket en Abandon : le ticket dont il est le doublon ou qui le remplace. C'est celle que l'Abandon
 * désigne (`Outcome.of`, de `abandonOf`, la règle unique : le premier lien posé), non la première d'une liste de liens.
 */
function replacementOf(flow: TicketFlow | undefined): TicketId | undefined {
  return flow?.outcome.kind === 'abandoned' ? flow.outcome.of : undefined;
}

/**
 * Liens discovered-from actifs du bug vers un autre ticket : un lien vers lui-même n'est l'origine de rien, pas plus
 * qu'un lien vers le survivant qui les reprend (`survivor`, le bug lui-même quand les liens sont les siens).
 */
function activeLinks(bug: TicketHistory, survivor: TicketId): DependencyHistory[] {
  return bug.dependencies.filter(
    (d) => d.type === ORIGIN_LINK && !d.removedAt && d.target !== bug.id && d.target !== survivor,
  );
}

/**
 * Le ticket est en Abandon : doublon d'un autre ticket, ou remplacé par lui. Pour un bug, c'est le même défaut que
 * celui du survivant : il est écarté de l'analyse et lui transmet ses liens (voir `survivorOf`).
 */
function isAbandoned(flow: TicketFlow | undefined): boolean {
  return flow?.outcome.kind === 'abandoned';
}

/**
 * Le ticket est une Livraison enregistrée au plus tard de `at` (égalité comprise). La date de la Livraison est celle de
 * son dernier commit de clôture, telle que l'historique l'enregistre : non bornée (`recordedTransitions`), comme la date de
 * création du bug, que sa propre borne ne déplace jamais (c'est sa première Transition). La borne d'`analyzeFlow` est propre à
 * chaque ticket ; elle repousse la Livraison, quand l'horloge de sa clôture a reculé, et pourrait la dater après un bug qui lui
 * est pourtant postérieur dans la lignée.
 */
function isDeliveredBy(flow: TicketFlow | undefined, history: TicketHistory | undefined, at: Date): boolean {
  if (flow?.outcome.kind !== 'delivered' || !history) return false;
  const closing = recordedTransitions(history.statusSnapshots).at(-1);
  return closing?.status === 'closed' && closing.at.getTime() <= at.getTime();
}

function coverageOf(bugs: Map<TicketId, BugAttribution>): FailureCoverage {
  const linked = [...bugs.values()].filter((b) => b.linked).length;
  return { bugs: bugs.size, linked, ratio: bugs.size === 0 ? null : linked / bugs.size };
}
