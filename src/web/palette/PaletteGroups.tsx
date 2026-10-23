import { Command } from 'cmdk';
import { Check, CornerDownLeft, Globe, TriangleAlert } from 'lucide-react';
import { isReadable } from '../data/helpers';
import type { Issue, Project } from '../data/types';
import { priorityMeta, statusLabel } from '../design/issue-palette';
import { cx } from '../lib/cx';
import { paths } from '../paths';
import { sectionHref, useRouteInfo } from '../shell/navigation';
import type { PaletteMode } from '../shell/OverlayProvider';
import { PriorityGlyph, TypeGlyph } from '../ui/IssueBadges';
import { ShortcutKeys } from '../ui/Kbd';
import { ProjectTile } from '../ui/ProjectTile';
import type { CommandEntry, PaletteSection } from './usePaletteSections';

export const groupClass =
  'pb-1 [&_[cmdk-group-heading]]:px-4 [&_[cmdk-group-heading]]:pb-1 [&_[cmdk-group-heading]]:pt-2.5 [&_[cmdk-group-heading]]:text-xs [&_[cmdk-group-heading]]:font-medium [&_[cmdk-group-heading]]:text-ink-3';

export const itemClass =
  'group/item relative flex h-9 cursor-default select-none items-center gap-2.5 rounded-lg pl-4 pr-2.5 text-ui text-ink-2 outline-none data-[disabled=true]:opacity-55 data-[selected=true]:bg-press data-[selected=true]:text-ink';

/**
 * Texte en retrait d'une ligne : ink-3, sauf sur la ligne sélectionnée. Son voile `press` ferait passer ink-3
 * sous 4.5:1 (surtout en sombre) : le texte y prend ink-2.
 */
const dim = 'text-ink-3 group-data-[selected=true]/item:text-ink-2';

/** Perle d'accent : marque la ligne sélectionnée, comme l'onglet actif sur mobile. */
export function Bead() {
  return (
    <span
      aria-hidden="true"
      className="absolute left-1.5 size-1.5 rounded-full bg-accent opacity-0 group-data-[selected=true]/item:opacity-100"
    />
  );
}

export function EnterHint() {
  return (
    <CornerDownLeft
      size={14}
      strokeWidth={2}
      aria-hidden="true"
      className="hidden shrink-0 text-ink-2 group-data-[selected=true]/item:block"
    />
  );
}

/** Une rubrique de la palette, avec ses lignes. `go` ferme la palette puis navigue. */
export function SectionGroup({
  section,
  everywhere,
  go,
}: {
  section: PaletteSection;
  everywhere: boolean;
  go: (to: string) => void;
}) {
  return (
    <Command.Group heading={section.heading} className={groupClass}>
      {renderRows(section, everywhere, go)}
    </Command.Group>
  );
}

function renderRows(section: PaletteSection, everywhere: boolean, go: (to: string) => void) {
  switch (section.id) {
    case 'navigation':
    case 'actions':
      return section.commands.map((command) => <CommandRow key={command.value} command={command} />);
    case 'projects':
      return section.projects.map((project) => <ProjectRow key={project.id} project={project} go={go} />);
    case 'epics':
      return section.items.map(({ issue, project }) => (
        <EpicRow key={`${project.id}/${issue.id}`} issue={issue} project={project} showProject={everywhere} go={go} />
      ));
    case 'issues':
      return (
        <>
          {section.items.map(({ issue, project }) => (
            <IssueRow key={`${project.id}/${issue.id}`} issue={issue} project={project} go={go} />
          ))}
          {section.more > 0 ? (
            <p className="px-4 py-1.5 text-xs text-ink-3">{section.more} autres correspondances : affinez la recherche.</p>
          ) : null}
        </>
      );
  }
}

function EpicRow({
  issue,
  project,
  showProject,
  go,
}: {
  issue: Issue;
  project: Project;
  /** Recherche dans tous les Projets : on dit de quel Projet vient l'Epic. */
  showProject: boolean;
  go: (to: string) => void;
}) {
  return (
    <Command.Item
      value={`epic:${project.id}/${issue.id}`}
      onSelect={() => go(paths.epics(project.id, issue.id))}
      className={itemClass}
    >
      <Bead />
      <TypeGlyph type="epic" />
      <span className={cx('max-w-[40%] shrink-0 truncate font-mono text-xs', dim)}>{issue.id}</span>
      <span className={cx('min-w-0 flex-1 truncate', issue.closedAt && dim)}>{issue.title}</span>
      {showProject ? <span className={cx('max-w-[30%] shrink-0 truncate text-xs', dim)}>{project.name}</span> : null}
      <EnterHint />
    </Command.Item>
  );
}

function IssueRow({ issue, project, go }: { issue: Issue; project: Project; go: (to: string) => void }) {
  return (
    <Command.Item
      value={`issue:${project.id}/${issue.id}`}
      onSelect={() => go(paths.issue(project.id, issue.id))}
      className={itemClass}
    >
      <Bead />
      <TypeGlyph type={issue.type} />
      <span className={cx('max-w-[40%] shrink-0 truncate font-mono text-xs', dim)}>{issue.id}</span>
      <span className={cx('min-w-0 flex-1 truncate', issue.closedAt && dim)}>{issue.title}</span>
      {issue.status !== 'open' ? (
        <span className={cx('hidden max-w-[25%] shrink-0 truncate text-xs sm:inline', dim)}>{statusLabel(issue.status)}</span>
      ) : null}
      <span title={`Priorité ${priorityMeta(issue.priority).label}`} className="shrink-0">
        <PriorityGlyph priority={issue.priority} />
      </span>
      <EnterHint />
    </Command.Item>
  );
}

function ProjectRow({ project, go }: { project: Project; go: (to: string) => void }) {
  const route = useRouteInfo();
  const current = project.id === route.projectId;
  const readable = isReadable(project);
  return (
    <Command.Item
      value={`project:${project.id}`}
      disabled={!readable}
      onSelect={() => go(sectionHref(route.section, project.id))}
      className={itemClass}
    >
      <Bead />
      <ProjectTile project={project} />
      <span className="min-w-0 max-w-[60%] shrink-0 truncate font-medium text-ink">{project.name}</span>
      {readable ? (
        <span className={cx('min-w-0 flex-1 truncate font-mono text-xs', dim)}>{project.prefix}</span>
      ) : (
        <span className={cx('flex min-w-0 flex-1 items-center gap-1.5 text-xs', dim)}>
          <TriangleAlert size={13} aria-hidden="true" className="shrink-0 text-danger" />
          <span className="truncate">
            <span className="sr-only">Illisible : </span>
            {project.reason ?? 'Illisible'}
          </span>
        </span>
      )}
      {current ? <Check size={14} strokeWidth={2.2} aria-label="Projet courant" className="shrink-0 text-accent" /> : null}
      {readable ? <EnterHint /> : null}
    </Command.Item>
  );
}

export function CommandRow({ command }: { command: CommandEntry }) {
  const Icon = command.icon;
  return (
    <Command.Item value={command.value} onSelect={command.run} className={itemClass}>
      <Bead />
      <Icon size={16} strokeWidth={1.8} aria-hidden="true" className="shrink-0 text-ink-3 group-data-[selected=true]/item:text-ink-2" />
      <span className="min-w-0 truncate">{command.label}</span>
      {command.hint ? <span className={cx('min-w-0 flex-1 truncate text-xs', dim)}>{command.hint}</span> : <span className="flex-1" />}
      {command.active ? <Check size={14} strokeWidth={2.2} aria-label="Actif" className="shrink-0 text-accent" /> : null}
      {command.shortcut ? (
        <span className="hidden shrink-0 md:inline-flex">
          <ShortcutKeys keys={command.shortcut} />
        </span>
      ) : null}
    </Command.Item>
  );
}

/** Ce que la recherche de tickets couvre : tous les Projets, ou le Projet courant. */
export function ScopeChip({
  mode,
  everywhere,
  project,
}: {
  mode: PaletteMode;
  everywhere: boolean;
  project: Project | undefined;
}) {
  if (mode === 'projects') return null;
  return (
    <span className="flex max-w-[40%] shrink-0 items-center gap-1.5 rounded-md border border-line px-1.5 py-0.5 text-xs text-ink-2">
      {everywhere ? (
        <>
          <Globe size={12} aria-hidden="true" />
          <span className="truncate">Tous les Projets</span>
        </>
      ) : project ? (
        <>
          <ProjectTile project={project} size={14} />
          <span className="truncate">{project.name}</span>
        </>
      ) : null}
    </span>
  );
}
