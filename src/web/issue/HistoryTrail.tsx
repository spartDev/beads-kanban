import { createContext, type ReactNode, use, useRef, useState } from 'react';
import { useLocation, useNavigationType } from 'react-router';
import { parsePath } from '../paths';

/** Une entrée de l'historique de l'application : sa page, et l'entrée qui la précédait quand on l'a ouverte. */
interface Visit {
  pathname: string;
  /** La clé de l'entrée d'avant ; nulle quand on l'ignore (adresse collée, page rechargée : rien de l'application ne la précède). */
  before: string | null;
}

/** Les entrées d'historique vues par l'application, par clé de lieu (`location.key`, propre à chaque entrée). */
export type Visits = ReadonlyMap<string, Visit>;

const TrailContext = createContext<Visits | null>(null);

/** Au-delà, les plus anciennes entrées sont oubliées : une entrée oubliée est une origine inconnue, rien de plus. */
const MAX_VISITS = 500;

/**
 * Retient les entrées d'historique que l'application parcourt, avec la page de chacune et celle d'avant. Le navigateur ne
 * dit pas ce qu'il y a derrière l'entrée courante : le panneau d'un ticket en a besoin pour se fermer en revenant d'autant
 * d'entrées qu'il en a empilé depuis la page d'où l'on vient (`useClosePanel`), quel que soit le chemin pris (carte, lien, palette).
 *
 * Une entrée ouverte par un lien (`PUSH`) a pour précédente celle d'où l'on vient ; une entrée qui en remplace une
 * (`REPLACE`) a la même précédente qu'elle ; une entrée retrouvée par « Retour » ou « Avancer » (`POP`) garde ce qu'on en
 * savait, et une inconnue (adresse collée, rechargement) n'a pas de précédente. On le note au rendu, avant celui des pages :
 * c'est idempotent (un rendu répété, en `StrictMode`, ne change rien).
 */
export function HistoryTrail({ children }: { children: ReactNode }) {
  const { key, pathname } = useLocation();
  const type = useNavigationType();
  const [visits] = useState(() => new Map<string, Visit>());
  const last = useRef<string | null>(null);

  if (!visits.has(key)) {
    const before = last.current === null ? null : type === 'PUSH' ? last.current : type === 'REPLACE' ? (visits.get(last.current)?.before ?? null) : null;
    visits.set(key, { pathname, before });
    if (visits.size > MAX_VISITS) visits.delete(visits.keys().next().value as string);
  }
  last.current = key;

  return <TrailContext value={visits}>{children}</TrailContext>;
}

export const useVisits = (): Visits | null => use(TrailContext);

export interface PanelSession {
  /** Combien d'entrées de panneau se suivent, de la plus ancienne à l'entrée courante. */
  depth: number;
  /** La page d'où l'on est venu, avant le premier panneau ; nulle quand on l'ignore : le panneau n'a rien derrière lui. */
  origin: string | null;
}

/**
 * La séquence de panneaux dont `key` est l'entrée courante. Les liens d'un ticket à l'autre remplacent l'entrée, mais la
 * palette ou un lien d'une autre page en empilent : chacun compte, pour que fermer le panneau les retire tous d'un coup.
 */
export function panelSession(visits: Visits | null, key: string): PanelSession {
  let depth = 0;
  let visit = visits?.get(key);
  while (visit && parsePath(visit.pathname).section === 'issue') {
    depth++;
    const before: Visit | undefined = visit.before === null ? undefined : visits?.get(visit.before);
    if (!before) return { depth, origin: null };
    visit = before;
  }
  return { depth, origin: depth > 0 && visit ? visit.pathname : null };
}
