import * as Dialog from '@radix-ui/react-dialog';
import { useQueryClient } from '@tanstack/react-query';
import { Command } from 'cmdk';
import { Globe, RefreshCw, Search, TriangleAlert } from 'lucide-react';
import { useCallback, useState } from 'react';
import { useNavigate } from 'react-router';
import { queryKeys } from '../data/hooks';
import { cx } from '../lib/cx';
import { usePalette, type PaletteMode } from '../shell/OverlayProvider';
import { dialogOverlay, dialogSurface } from '../ui/dialog';
import { Kbd } from '../ui/Kbd';
import { Bead, EnterHint, groupClass, itemClass, ScopeChip, SectionGroup } from './PaletteGroups';
import { usePaletteSections } from './usePaletteSections';

export function CommandPalette() {
  const { open, mode, closePalette } = usePalette();

  return (
    <Dialog.Root open={open} onOpenChange={(next) => !next && closePalette()}>
      <Dialog.Portal>
        <Dialog.Overlay className={dialogOverlay} />
        <Dialog.Content className={dialogSurface} aria-describedby="palette-description">
          <Dialog.Title className="sr-only">Palette de commandes</Dialog.Title>
          <Dialog.Description id="palette-description" className="sr-only">
            Cherchez un Projet, une Epic ou un ticket, ou lancez une commande. Flèches pour choisir, Entrée pour ouvrir.
          </Dialog.Description>
          {/* Monté seulement à l'ouverture : la saisie repart à zéro et rien n'est chargé tant que la palette est fermée. */}
          <PaletteBody mode={mode} onClose={closePalette} />
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  );
}

/** Verbe affiché dans le pied de la palette, selon la ligne sélectionnée. */
const ACTION_LABELS: readonly (readonly [prefix: string, label: string])[] = [
  ['nav:', 'Aller à'],
  ['project:', 'Changer de Projet'],
  ['epic:', 'Ouvrir l’Epic'],
  ['issue:', 'Ouvrir le ticket'],
  ['action:search-all', 'Élargir la recherche'],
  ['action:retry', 'Réessayer'],
  ['action:', 'Exécuter'],
];

function PaletteBody({ mode, onClose }: { mode: PaletteMode; onClose: () => void }) {
  const navigate = useNavigate();
  const queryClient = useQueryClient();

  const [query, setQuery] = useState('');
  const [searchAll, setSearchAll] = useState(false);
  const [selected, setSelected] = useState('');

  const go = useCallback(
    (to: string) => {
      onClose();
      void navigate(to);
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
    failedProjects,
    empty,
    projectsStatus,
  } = usePaletteSections({ mode, query, searchAll, go, close: onClose });

  const actionLabel = ACTION_LABELS.find(([prefix]) => selected.startsWith(prefix))?.[1] ?? 'Ouvrir';
  const hasRows = resultCount > 0 || canWiden || failedProjects.length > 0;

  return (
    <Command
      label="Palette de commandes"
      shouldFilter={false}
      loop
      // Sans les raccourcis « vim » de cmdk : Ctrl+K y est « ligne précédente », et le registre ne verrait plus
      // l'événement. Sous Windows et Linux, Ctrl+K doit refermer la palette comme ⌘K sur macOS.
      vimBindings={false}
      value={selected}
      onValueChange={setSelected}
      className="flex max-h-[min(34rem,calc(100dvh-1.5rem))] flex-col md:max-h-[min(34rem,calc(100dvh-12vh-2rem))]"
    >
      <div className="flex items-center gap-3 border-b border-line px-4">
        <Search size={16} strokeWidth={2} aria-hidden="true" className="shrink-0 text-ink-3" />
        <Command.Input
          autoFocus
          value={query}
          onValueChange={setQuery}
          placeholder={
            mode === 'projects' ? 'Changer de Projet' : 'Chercher un ticket, une Epic, un Projet ou une commande'
          }
          className="h-12 min-w-0 flex-1 bg-transparent text-[15px] text-ink outline-none placeholder:text-ink-3"
        />
        <ScopeChip mode={mode} everywhere={everywhere} project={currentProject} />
      </div>

      {/* Les messages d'état sont hors de la listbox : elle ne contient que des options (WAI-ARIA). */}
      {loadingTickets ? (
        <p role="status" className="px-4 py-2.5 text-ink-3">
          Chargement des tickets…
        </p>
      ) : null}

      {failedProjects.length > 0 ? (
        <p role="alert" className="flex items-center gap-2 px-4 py-2 text-ink-2 wrap-anywhere">
          <TriangleAlert size={14} aria-hidden="true" className="shrink-0 text-danger" />
          Tickets indisponibles : {failedProjects.map((project) => project.name).join(', ')}.
        </p>
      ) : null}

      {empty ? (
        <p role="status" className="px-4 py-10 text-center text-ink-3 wrap-anywhere">
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
            <Command.Item value="action:search-all" onSelect={() => setSearchAll(true)} className={itemClass}>
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
      <div className="sr-only" role="status" aria-live="polite">
        {search ? `${resultCount} résultats` : ''}
      </div>
    </Command>
  );
}
