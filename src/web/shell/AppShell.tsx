import { Outlet, useLocation } from 'react-router';
import { useT } from '../i18n';
import { LiveUpdates } from '../live/LiveUpdates';
import { CommandPalette } from '../palette/CommandPalette';
import { ShortcutsProvider } from '../shortcuts/ShortcutsProvider';
import { TooltipProvider } from '../ui/Tip';
import { OverlayProvider } from './OverlayProvider';
import { ShortcutsHelp } from './ShortcutsHelp';
import { Sidebar } from './Sidebar';
import { TabBar } from './TabBar';
import { TopBar } from './TopBar';
import { useGlobalShortcuts } from './useGlobalShortcuts';

export function AppShell() {
  return (
    <ShortcutsProvider>
      <OverlayProvider>
        <TooltipProvider>
          <Layout />
        </TooltipProvider>
      </OverlayProvider>
    </ShortcutsProvider>
  );
}

/**
 * Desktop : barre latérale marine à gauche ; le contenu défile sur le fond de l'app, et chaque page y pose ses cartes.
 * Mobile (< 768 px) : bandeau en haut, contenu pleine largeur, barre d'onglets en bas.
 * La page ne défile jamais horizontalement : un contenu large (le kanban) gère son propre défilement.
 */
function Layout() {
  useGlobalShortcuts();
  const { pathname, search } = useLocation();
  const t = useT();

  return (
    <div className="flex min-h-dvh overflow-x-clip md:h-dvh md:overflow-hidden">
      <a
        href="#contenu"
        className="sr-only focus:not-sr-only focus:fixed focus:left-3 focus:top-3 focus:z-[70] focus:rounded-md focus:bg-float focus:px-3 focus:py-2 focus:text-ink focus:shadow-float"
      >
        {t.shell.layout.skipToContent}
      </a>
      <Sidebar />
      <div className="flex min-w-0 flex-1 flex-col">
        <main
          id="contenu"
          // Il prend le focus par programme quand une boîte de dialogue se referme sans rien d'autre à qui le rendre (voir `OverlayProvider`), et quand
          // ce qui l'avait dans la page disparaît parce que la page se recharge (« Réessayer », voir `zoneFocus`) : pas de contour, et un nom, que le lecteur
          // d'écran dit alors (comme le lien « Aller au contenu » qui y mène).
          aria-label={t.shell.layout.main}
          // La page qu'il montre (chemin et paramètres, sans l'ancre), écrite dans le même rendu que la page : `focusTitleWhenReady` attend le titre d'une page, et s'arrête quand
          // l'utilisateur va sur une autre (voir `locationOf`, `zoneFocus`).
          data-location={pathname + search}
          className="relative flex min-h-0 flex-1 flex-col bg-canvas pb-[calc(3.5rem+env(safe-area-inset-bottom))] outline-none md:overflow-y-auto md:pb-0"
        >
          <TopBar />
          <LiveUpdates />
          <div className="flex min-w-0 flex-1 flex-col">
            <Outlet />
          </div>
        </main>
      </div>
      <TabBar />
      <CommandPalette />
      <ShortcutsHelp />
    </div>
  );
}
