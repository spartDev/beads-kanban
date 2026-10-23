import { useNavigate } from 'react-router';
import { paths, sectionPath } from '../paths';
import { useShortcuts, type ShortcutDefinition } from '../shortcuts/ShortcutsProvider';
import { SECTIONS, useTabsProject } from './navigation';
import { usePalette, useShortcutsHelp } from './OverlayProvider';

/**
 * Raccourcis de l'application : palette, aide, navigation « g puis… ».
 * Les raccourcis propres à une page (j/k/Entrée du kanban…) s'enregistrent avec `useShortcuts` dans la page.
 */
export function useGlobalShortcuts(): void {
  const navigate = useNavigate();
  const { togglePalette, openPalette } = usePalette();
  const help = useShortcutsHelp();
  const project = useTabsProject();

  const definitions: ShortcutDefinition[] = [
    {
      id: 'palette.toggle',
      keys: 'mod+k',
      label: 'Ouvrir la palette de commandes',
      group: 'Général',
      allowInInput: true,
      run: togglePalette,
    },
    {
      id: 'help.shortcuts',
      keys: '?',
      label: 'Afficher les raccourcis clavier',
      group: 'Général',
      run: help.show,
    },
    {
      id: 'nav.global',
      keys: 'g v',
      label: 'Aller à la Vue globale',
      group: 'Navigation',
      run: () => void navigate(paths.global()),
    },
    {
      id: 'nav.projects',
      keys: 'g p',
      label: 'Changer de Projet',
      group: 'Navigation',
      run: () => openPalette('projects'),
    },
    ...SECTIONS.map(
      (section): ShortcutDefinition => ({
        id: `nav.${section.id}`,
        keys: section.shortcut,
        label: `Aller à ${section.label}`,
        group: 'Navigation',
        enabled: Boolean(project),
        run: () => {
          if (project) void navigate(sectionPath(section.id, project.id));
        },
      }),
    ),
  ];

  useShortcuts(definitions);
}
