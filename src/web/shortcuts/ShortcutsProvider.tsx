import {
  createContext,
  use,
  useEffect,
  useRef,
  useState,
  useSyncExternalStore,
  type ReactNode,
} from 'react';
import { isMacPlatform } from '../lib/platform';
import { createShortcutRegistry, type Shortcut, type ShortcutRegistry } from './registry';

const ShortcutsContext = createContext<ShortcutRegistry | null>(null);

/** Installe l'écoute clavier globale et le registre que partagent tous les `useShortcut`. */
export function ShortcutsProvider({
  children,
  isMac = isMacPlatform(),
}: {
  children: ReactNode;
  /** Forcé dans les tests ; sinon détecté depuis le navigateur. */
  isMac?: boolean;
}) {
  const [registry] = useState(() => createShortcutRegistry({ isMac }));

  useEffect(() => {
    // Écoute en phase de bulle : un composant (cmdk, Radix) qui consomme la touche avant nous l'emporte.
    const onKeyDown = (event: KeyboardEvent) => {
      registry.handleKeyDown(event);
    };
    window.addEventListener('keydown', onKeyDown);
    return () => {
      window.removeEventListener('keydown', onKeyDown);
      registry.dispose();
    };
  }, [registry]);

  return <ShortcutsContext value={registry}>{children}</ShortcutsContext>;
}

export function useShortcutRegistry(): ShortcutRegistry {
  const registry = use(ShortcutsContext);
  if (!registry) throw new Error('Les raccourcis exigent <ShortcutsProvider>.');
  return registry;
}

export type ShortcutDefinition = Shortcut & {
  /** Faux : le raccourci n'est pas enregistré (par exemple faute de Projet courant). */
  enabled?: boolean;
};

/**
 * Déclare des raccourcis tant que le composant est monté.
 * Les `run` peuvent changer à chaque rendu sans ré-enregistrer quoi que ce soit : le registre
 * n'est touché que si l'identité, les touches, le libellé ou l'activation d'un raccourci changent.
 */
export function useShortcuts(definitions: readonly ShortcutDefinition[]): void {
  const registry = useShortcutRegistry();
  const latest = useRef(definitions);
  useEffect(() => {
    latest.current = definitions;
  });

  const signature = definitions
    .filter((d) => d.enabled !== false)
    .map((d) => [d.id, d.keys, d.label, d.group, d.allowInInput ? 1 : 0].join('|'))
    .join('\n');

  useEffect(() => {
    const disposers = latest.current
      .filter((d) => d.enabled !== false)
      .map(({ id, keys, label, group, allowInInput }) =>
        registry.register({
          id,
          keys,
          label,
          group,
          allowInInput,
          run: (event) => latest.current.find((d) => d.id === id)?.run(event),
        }),
      );
    return () => disposers.forEach((dispose) => dispose());
  }, [registry, signature]);
}

export function useShortcut(definition: ShortcutDefinition): void {
  useShortcuts([definition]);
}

/** Raccourcis enregistrés (pour l'aide), mis à jour quand la liste change. */
export function useShortcutList(): readonly Shortcut[] {
  const registry = useShortcutRegistry();
  return useSyncExternalStore(registry.subscribe, registry.list, registry.list);
}
