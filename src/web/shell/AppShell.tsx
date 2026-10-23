import { Outlet } from 'react-router';
import { CommandPalette } from '../palette/CommandPalette';
import { ShortcutsProvider } from '../shortcuts/ShortcutsProvider';
import { TooltipProvider } from '../ui/Tip';
import { OverlayProvider } from './OverlayProvider';
import { RefreshFailedBanner } from './RefreshFailedBanner';
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
 * Desktop : barre latérale à gauche, contenu dans un panneau qui flotte sur le fond.
 * Mobile (< 768 px) : bandeau en haut, contenu pleine largeur, barre d'onglets en bas.
 * La page ne défile jamais horizontalement : un contenu large (le kanban) gère son propre défilement.
 */
function Layout() {
  useGlobalShortcuts();

  return (
    <div className="flex min-h-dvh overflow-x-clip md:h-dvh md:overflow-hidden">
      <a
        href="#contenu"
        className="sr-only focus:not-sr-only focus:fixed focus:left-3 focus:top-3 focus:z-[70] focus:rounded-md focus:bg-float focus:px-3 focus:py-2 focus:text-ink focus:shadow-float"
      >
        Aller au contenu
      </a>
      <Sidebar />
      <div className="flex min-w-0 flex-1 flex-col md:py-2 md:pr-2">
        <main
          id="contenu"
          className="flex min-h-0 flex-1 flex-col bg-panel pb-[calc(3.5rem+env(safe-area-inset-bottom))] md:overflow-y-auto md:rounded-xl md:border md:border-line md:pb-0 md:shadow-panel"
        >
          <TopBar />
          <RefreshFailedBanner />
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
