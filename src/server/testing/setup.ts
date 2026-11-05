import { installScratchHooks } from './scratch';

/**
 * Le fichier d'initialisation du projet « node » (`setupFiles`, vite.config.ts) : vitest l'exécute avant chaque fichier de tests, sous `--no-isolate` aussi, où les
 * modules, eux, sont partagés par les fichiers d'un worker. Il pose le registre des dossiers temporaires du fichier et les crochets qui les retirent à sa fin
 * (bdesk-38k.66, voir `scratch.ts`).
 */
installScratchHooks();
