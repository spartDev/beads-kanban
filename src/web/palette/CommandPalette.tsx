import * as Dialog from '@radix-ui/react-dialog';
import { useQueryClient } from '@tanstack/react-query';
import { Command } from 'cmdk';
import { Globe, RefreshCw, Search, TriangleAlert } from 'lucide-react';
import { useCallback, useRef, useState } from 'react';
import { useNavigate } from 'react-router';
import { queryKeys } from '../data/hooks';
import { projectList } from '../data/projectNames';
import { openedFromPalette } from '../kanban/boardFocus';
import { cx } from '../lib/cx';
import { useOverlayContent, usePalette, type PaletteMode } from '../shell/OverlayProvider';
import { dialogOverlay, dialogSurface } from '../ui/dialog';
import { Kbd } from '../ui/Kbd';
import { Bead, EnterHint, groupClass, itemClass, ScopeChip, SectionGroup } from './PaletteGroups';
import { useActiveDescendant } from './useActiveDescendant';
import { usePaletteSections } from './usePaletteSections';
import { usePendingEnter } from './usePendingEnter';
import { useQuietRow } from './useQuietRow';
import { useSelectionGuard } from './useSelectionGuard';
import { useSelectionInView } from './useSelectionInView';

export function CommandPalette() {
  const { open, mode, closePalette } = usePalette();
  // Échap rendu au registre des raccourcis pendant l'animation de sortie, focus rendu à l'élément d'origine : voir `useOverlayContent`.
  const overlay = useOverlayContent(open);

  return (
    <Dialog.Root open={open} onOpenChange={(next) => !next && closePalette()}>
      <Dialog.Portal>
        <Dialog.Overlay className={dialogOverlay} />
        <Dialog.Content className={dialogSurface} aria-describedby="palette-description" {...overlay}>
          <Dialog.Title className="sr-only">Palette de commandes</Dialog.Title>
          <Dialog.Description id="palette-description" className="sr-only">
            Cherchez un Projet, une Epic ou un ticket, ou lancez une commande. Flèches pour choisir, Entrée pour ouvrir.
          </Dialog.Description>
          {/* Monté à l'ouverture et retiré à la fin de l'animation de sortie : la saisie repart à zéro et rien n'est chargé tant que la palette est
              retirée. Rouverte pendant cette animation, elle est encore montée : elle garde sa saisie. */}
          <PaletteBody open={open} mode={mode} onClose={closePalette} />
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  );
}

/** La valeur cmdk de la ligne « Chercher … dans tous les Projets ». */
const WIDEN_VALUE = 'action:search-all';

/**
 * Les noms des régions de statut de la palette, qui n'ont pas de titre à l'écran où les prendre. Les deux messages visibles (l'attente des tickets, la liste vide) rendent compte de la recherche, et ne
 * sont jamais là ensemble ; le décompte que seuls les lecteurs d'écran lisent est un autre statut. La liste des résultats, elle, est nommée « Suggestions » par cmdk.
 */
const SEARCH_STATE = 'État de la recherche';
const RESULT_COUNT = 'Nombre de résultats';

/** Verbe affiché dans le pied de la palette, selon la ligne sélectionnée. */
const ACTION_LABELS: readonly (readonly [prefix: string, label: string])[] = [
  ['nav:', 'Aller à'],
  ['project:', 'Changer de Projet'],
  ['epic:', 'Ouvrir l’Epic'],
  ['issue:', 'Ouvrir le ticket'],
  [WIDEN_VALUE, 'Élargir la recherche'],
  ['action:retry', 'Réessayer'],
  ['action:', 'Exécuter'],
];

function PaletteBody({ open, mode, onClose }: { open: boolean; mode: PaletteMode; onClose: () => void }) {
  const navigate = useNavigate();
  const queryClient = useQueryClient();

  const [query, setQuery] = useState('');
  const [searchAll, setSearchAll] = useState(false);
  const [selected, setSelected] = useState('');
  const root = useRef<HTMLDivElement>(null);
  // cmdk annonce une ligne active périmée après ses sélections d'office : voir `useActiveDescendant`. Il défile aussi vers la ligne d'avant
  // au lieu de la nouvelle : voir `useSelectionInView`.
  useActiveDescendant(root);
  useSelectionInView(root);

  // Le choix écrit dans l'entrée d'historique qu'il ouvre qu'il en est l'auteur : le panneau d'un ticket n'a alors aucune origine à retenir, quel que soit l'ordre où la palette se retire et où le panneau est rendu
  // (voir `panelOpener`).
  const go = useCallback(
    (to: string) => {
      onClose();
      void navigate(to, { state: openedFromPalette });
    },
    [navigate, onClose],
  );
  const {
    sections,
    resultCount,
    search,
    everywhere,
    currentProject,
    canWiden,
    loadingTickets,
    ticketsPending,
    exactPath,
    failedProjects,
    empty,
    projectsStatus,
  } = usePaletteSections({ mode, query, searchAll, go, close: onClose });

  const actionLabel = ACTION_LABELS.find(([prefix]) => selected.startsWith(prefix))?.[1] ?? 'Ouvrir';
  const hasRows = resultCount > 0 || canWiden || failedProjects.length > 0;
  const holdEnter = usePendingEnter({ open, search, selected, pending: ticketsPending, targetPath: exactPath, go });
  // Revenue après le délai (voir `canWiden`), « Chercher … dans tous les Projets » est la seule ligne tant que les tickets chargent. cmdk
  // la sélectionnerait d'office, et elle garderait la sélection quand les tickets arrivent au-dessus : Entrée élargirait la recherche au lieu
  // d'ouvrir le ticket tapé. Elle reste donc là sans être sélectionnée (flèche, survol ou clic la choisissent), et les tickets prennent la
  // sélection à leur arrivée comme toute première ligne : rien n'était en surbrillance, rien ne saute.
  const onlyWiden = canWiden && ticketsPending && resultCount === 0 && failedProjects.length === 0;
  const quiet = useQuietRow({ quiet: onlyWiden, row: WIDEN_VALUE, selected, select: setSelected });
  // Une ligne est sélectionnée dès qu'il y en a une à sélectionner, et la sélection désigne une ligne présente : cmdk ne le tient pas quand
  // la valeur est pilotée (survol d'une ligne qui disparaît, lignes retirées ensemble, ligne en retrait seule) : voir `useSelectionGuard`.
  useSelectionGuard({ root, selected, quiet: onlyWiden, select: setSelected });

  return (
    <Command
      ref={root}
      label="Palette de commandes"
      shouldFilter={false}
      loop
      // Sans les raccourcis « vim » de cmdk : Ctrl+K y est « ligne précédente », et le registre ne verrait plus
      // l'événement. Sous Windows et Linux, Ctrl+K doit refermer la palette comme ⌘K sur macOS.
      vimBindings={false}
      {...quiet.commandProps}
      // Entrée n'a rien à prendre quand aucune ligne n'est sélectionnée (les tickets chargent) : cmdk n'en fait rien, nous retenons la
      // demande (voir `usePendingEnter`). Celle qui valide une composition (IME) n'en est pas une : même garde que cmdk.
      onKeyDown={(event) => {
        if (event.key === 'Enter' && !event.nativeEvent.isComposing && event.keyCode !== 229 && selected === '') holdEnter();
      }}
      className="flex max-h-[min(34rem,calc(100dvh-1.5rem))] flex-col md:max-h-[min(34rem,calc(100dvh-12vh-2rem))]"
    >
      <div className="flex items-center gap-3 border-b border-line px-4">
        <Search size={16} strokeWidth={2} aria-hidden="true" className="shrink-0 text-ink-3" />
        <Command.Input
          autoFocus
          value={query}
          onValueChange={(value) => {
            quiet.typed();
            setQuery(value);
          }}
          placeholder={
            mode === 'projects' ? 'Changer de Projet' : 'Chercher un ticket, une Epic, un Projet ou une commande'
          }
          className="h-12 min-w-0 flex-1 bg-transparent text-[15px] text-ink outline-none placeholder:text-ink-3"
        />
        <ScopeChip mode={mode} everywhere={everywhere} project={currentProject} />
      </div>

      {/* Les messages d'état sont hors de la listbox : elle ne contient que des options (WAI-ARIA). */}
      {loadingTickets ? (
        <p role="status" aria-label={SEARCH_STATE} className="px-4 py-2.5 text-ink-3">
          Chargement des tickets…
        </p>
      ) : null}

      {failedProjects.length > 0 ? (
        <p role="alert" className="flex items-center gap-2 px-4 py-2 text-ink-2 wrap-anywhere">
          <TriangleAlert size={14} aria-hidden="true" className="shrink-0 text-danger" />
          Tickets indisponibles : {projectList(failedProjects)}.
        </p>
      ) : null}

      {empty ? (
        <p role="status" aria-label={SEARCH_STATE} className="px-4 py-10 text-center text-ink-3 wrap-anywhere">
          {projectsStatus === 'ready'
            ? search
              ? `Aucun résultat pour « ${search} ».`
              : 'Rien à afficher pour le moment.'
            : projectsStatus === 'failed'
              ? 'Impossible de charger les Projets : le serveur ne répond pas.'
              : 'Chargement…'}
        </p>
      ) : null}

      <Command.List className={cx('min-h-0 flex-1 overflow-y-auto overscroll-contain', hasRows && 'p-1.5')}>
        {sections.map((section) => (
          <SectionGroup key={section.id} section={section} everywhere={everywhere} go={go} />
        ))}

        {failedProjects.length > 0 ? (
          <Command.Group className={groupClass}>
            <Command.Item
              value="action:retry"
              onSelect={() =>
                failedProjects.forEach((project) => {
                  void queryClient.invalidateQueries({ queryKey: queryKeys.issues(project.id) });
                })
              }
              className={itemClass}
            >
              <Bead />
              <RefreshCw size={16} strokeWidth={1.8} aria-hidden="true" className="shrink-0 text-ink-3 group-data-[selected=true]/item:text-ink-2" />
              Réessayer
            </Command.Item>
          </Command.Group>
        ) : null}

        {canWiden ? (
          <Command.Group heading="Élargir" className={groupClass}>
            <Command.Item value={WIDEN_VALUE} onSelect={() => setSearchAll(true)} className={itemClass}>
              <Bead />
              <Globe size={16} strokeWidth={1.8} aria-hidden="true" className="shrink-0 text-ink-3" />
              <span className="min-w-0 flex-1 truncate">Chercher « {search} » dans tous les Projets</span>
              <EnterHint />
            </Command.Item>
          </Command.Group>
        ) : null}
      </Command.List>

      <div aria-hidden="true" className="hidden items-center gap-4 border-t border-line px-4 py-2 text-xs text-ink-3 md:flex">
        <span className="flex items-center gap-1.5">
          <Kbd>↑</Kbd>
          <Kbd>↓</Kbd>
          naviguer
        </span>
        <span className="ml-auto flex items-center gap-1.5">
          <Kbd>↵</Kbd>
          {actionLabel}
        </span>
        <span className="flex items-center gap-1.5">
          <Kbd>Échap</Kbd>
          fermer
        </span>
      </div>
      <div className="sr-only" role="status" aria-label={RESULT_COUNT} aria-live="polite">
        {search ? `${resultCount} résultats` : ''}
      </div>
    </Command>
  );
}
