import { useNavigate } from 'react-router';
import { useT } from '../i18n';
import { paths, sectionPath } from '../paths';
import { useShortcuts, type ShortcutDefinition } from '../shortcuts/ShortcutsProvider';
import { SECTIONS, useTabsProject } from './navigation';
import { usePalette, useShortcutsHelp } from './OverlayProvider';

/** D'où vient la touche : l'élément qui la reçoit, celui qui a le focus (le clavier le déplace lui-même, dans tous les moteurs). C'est l'origine de la surcouche qu'elle ouvre (voir `OverlayProvider`). */
const sourceOf = (event: KeyboardEvent): Element | null => (event.target instanceof Element ? event.target : null);

/**
 * Raccourcis de l'application : palette, aide, navigation « g puis… ».
 * Les raccourcis propres à une page (j/k/Entrée du kanban…) s'enregistrent avec `useShortcuts` dans la page.
 */
export function useGlobalShortcuts(): void {
  const navigate = useNavigate();
  const { togglePalette, openPalette } = usePalette();
  const help = useShortcutsHelp();
  const project = useTabsProject();
  const t = useT();
  const labels = t.shell.shortcuts;

  const definitions: ShortcutDefinition[] = [
    {
      id: 'palette.toggle',
      keys: 'mod+k',
      label: labels.togglePalette,
      group: labels.groups.general,
      allowInInput: true,
      run: (event) => togglePalette(sourceOf(event)),
    },
    {
      id: 'help.shortcuts',
      keys: '?',
      label: labels.showHelp,
      group: labels.groups.general,
      run: (event) => help.show(sourceOf(event)),
    },
    {
      id: 'nav.global',
      keys: 'g v',
      label: labels.goToOverview,
      group: labels.groups.navigation,
      run: () => void navigate(paths.global()),
    },
    {
      id: 'nav.projects',
      keys: 'g p',
      label: labels.switchProject,
      group: labels.groups.navigation,
      run: (event) => openPalette('projects', sourceOf(event)),
    },
    ...SECTIONS.map(
      (section): ShortcutDefinition => ({
        id: `nav.${section.id}`,
        keys: section.shortcut,
        label: labels.goTo(t.shell.sections[section.id]),
        group: labels.groups.navigation,
        enabled: Boolean(project),
        run: () => {
          if (project) void navigate(sectionPath(section.id, project.id));
        },
      }),
    ),
  ];

  // Ceux de l'application valent aussi sous une couche non modale posée sur la page (le panneau d'un ticket sur desktop) : la page
  // dessous reste utilisable, l'aide et la navigation avec elle. Les boîtes de dialogue modales (palette, aide, panneau du mobile)
  // gardent le clavier, comme les champs de saisie.
  useShortcuts(definitions.map((definition) => ({ allowInLayer: true, ...definition })));
}
