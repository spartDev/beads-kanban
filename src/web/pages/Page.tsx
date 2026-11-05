import type { ReactNode } from 'react';
import { cx } from '../lib/cx';
import { isInvisibleText } from '../lib/invisibleText';
import { Skeleton } from '../ui/states';

/** Un titre qui s'ajuste à son texte, et un contour de focus qui l'épouse de près : voir `SectionTitle` et `Page`. */
const TIGHT_OUTLINE = 'w-fit max-w-full rounded-sm focus-visible:outline-offset-1';

/** Le nom du titre d'une page qui n'a pas encore le sien (`title` est `null`) : celui de la page, pour toute page (bdesk-38k.53), plutôt qu'un titre vide. Voir `Page`. */
const LOADING_TITLE = 'Chargement…';

/** Ce que la page écrit à la place d'un titre qu'on ne verrait pas (vide, fait de blancs ou de caractères sans largeur : `isInvisibleText`). Voir `Page`. */
const UNTITLED = 'Sans titre';

/**
 * Cadre commun des pages : titre, phrase d'explication, contenu. Largeur de lecture limitée, sauf `wide` : le contenu
 * prend toute la largeur du panneau, avec des marges et des écarts plus serrés (le kanban). `eyebrow` : un lien de retour
 * ou un fil d'Ariane, au-dessus du titre.
 *
 * Le titre est un texte, ou `null` tant qu'il n'est pas arrivé (la page charge) : `Page` dessine alors elle-même le squelette du titre et le nomme (voir plus bas).
 * Un texte qu'on ne verrait pas (vide, fait d'espaces ou de caractères sans largeur : le nom d'un dossier, que `ProjectGate` donne pour titre à un Projet illisible) s'écrit
 * « Sans titre » (`isInvisibleText`) : jamais un `<h1>` muet (bdesk-38k.61). Tout autre texte est écrit tel quel, jusqu'à ses blancs et à sa ponctuation : le titre d'une page est un nom
 * de dossier, d'Epic ou de page, pas un titre de ticket, et ne suit pas sa règle (`ticketTitle` : elle peut compter pour vide plus que ce qu'on ne voit pas, et réécrit les blancs).
 */
export function Page({
  title,
  loadingWidth = 'w-40',
  description,
  eyebrow,
  children,
  wide = false,
}: {
  /** Le titre de la page, un texte (« Sans titre » s'il ne dit rien) : `null` tant qu'il charge. Pas un nœud React : voir plus bas. */
  title: string | null;
  /** La largeur du squelette du titre tant qu'il charge, une classe Tailwind : celle du titre qu'il remplace (`w-2/3` pour un nom d'Epic), pour qu'il ne saute pas à l'arrivée du texte. */
  loadingWidth?: string;
  description?: ReactNode;
  eyebrow?: ReactNode;
  children?: ReactNode;
  wide?: boolean;
}) {
  // `null` est un titre qui charge : la page qui le remplace aura le sien. `Page` en dessine le squelette, et le marque (`data-skeleton`), pour que le focus que
  // « Réessayer » rend à la page ne s'y pose pas (voir `titleOf`) : le squelette part, et le focus tomberait sur le corps de la page. Et elle le nomme : un squelette est
  // caché aux lecteurs d'écran, son titre serait vide (axe : `empty-heading`, un titre muet sur la liste des titres). Le nom est celui de la page, posé ici pour qu'aucune
  // page n'y pense ; un attribut, pas un texte masqué : rien à l'écran ne change, pas un nœud de plus. Pas de `aria-busy` sur le titre : un lecteur d'écran peut taire ce
  // qui est occupé, et c'est la région qui suit (`role="status"`) qui dit le chargement.
  // Le titre n'est donc pas un `ReactNode` : `aria-label` remplace le nom que le contenu donnerait, et un titre en JSX, pris pour un squelette parce qu'il n'est pas un
  // texte, aurait été renommé « Chargement… » en silence pour les lecteurs d'écran. Avec `string | null`, TypeScript le refuse.
  const loading = title === null;
  // Un texte qu'on ne verrait pas ferait un `<h1>` muet pour un lecteur d'écran, et axe ne le voit pas quand il est fait de caractères sans largeur : il s'écrit « Sans titre ». C'est
  // un vrai titre, que le focus peut prendre : seul `null` dit « il charge ». Tout autre texte reste tel qu'il est écrit (ni `trim`, ni règle des titres de ticket : voir plus haut).
  // Ce qui n'est pas un texte (un `as` a contourné le type) est rendu tel quel, comme avant : la règle ne vaut que pour un texte.
  const text = typeof title === 'string' && isInvisibleText(title) ? UNTITLED : title;
  return (
    <div
      className={cx(
        'mx-auto flex w-full min-w-0 flex-col px-4 py-6 md:py-8',
        wide ? 'gap-4 md:px-5' : 'max-w-4xl gap-7 md:px-8',
      )}
    >
      <header className="min-w-0">
        {eyebrow ? <div className="mb-2 text-ui">{eyebrow}</div> : null}
        {/* wrap-anywhere : un id, un chemin ou un nom de fichier sans espace passe à la ligne au lieu d'être rogné. */}
        <h1
          data-skeleton={loading ? '' : undefined}
          aria-label={loading ? LOADING_TITLE : undefined}
          className={cx(
            'wrap-anywhere text-xl font-semibold tracking-[-0.02em] text-ink md:text-[22px] md:leading-7',
            // Le titre prend le focus par programme à l'arrivée d'une page qu'un « Réessayer » a rechargée (voir `useRetryFocus`) : son contour (au clavier
            // seulement) entoure le texte, pas toute la largeur de l'en-tête. Pas pour un squelette, dont la largeur en pourcentage tomberait à zéro.
            !loading && TIGHT_OUTLINE,
          )}
        >
          {loading ? <Skeleton className={cx('h-7', loadingWidth)} /> : text}
        </h1>
        {description ? <p className="mt-1.5 max-w-[62ch] wrap-anywhere text-[14px] leading-6 text-ink-2">{description}</p> : null}
      </header>
      {children}
    </div>
  );
}

/** Page dont le contenu est l'objet d'un autre ticket : dit lequel, sans rien promettre de plus. */
export function ComingSoon({ ticket, children }: { ticket: string; children: ReactNode }) {
  return (
    <aside className="flex items-start gap-3 rounded-lg border border-line bg-well p-4">
      <span className="mt-px inline-flex h-5 shrink-0 items-center rounded-full bg-accent-soft px-2 text-xs font-medium text-accent">
        À venir
      </span>
      <p className="min-w-0 text-ink-2">
        {children} <code className="whitespace-nowrap font-mono text-xs text-ink">{ticket}</code>
      </p>
    </aside>
  );
}

/** Intertitre d'une section de page. Même contour resserré que le titre de la page : celui d'une section prend le focus quand elle se recharge. */
export function SectionTitle({ id, children }: { id?: string; children: ReactNode }) {
  return (
    <h2 id={id} className={cx('text-ui font-semibold text-ink', TIGHT_OUTLINE)}>
      {children}
    </h2>
  );
}
