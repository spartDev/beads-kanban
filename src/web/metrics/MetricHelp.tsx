import { Info } from 'lucide-react';
import { useT } from '../i18n';
import { Tip } from '../ui/Tip';

/**
 * L'icône info d'une tuile : au survol ou au focus clavier, une infobulle dit ce que mesure la tuile et à quoi elle sert. La page « À regarder » la pose
 * aussi à côté du nom d'un Signal qui a son aide. Un module à part, léger : l'accueil l'importe sans tirer les tuiles dans le morceau principal.
 */
export function MetricHelp({ title, help }: { title: string; help: string }) {
  const t = useT();
  return (
    <Tip label={help} side="bottom">
      <button
        type="button"
        aria-label={t.metrics.tileFrame.about(title)}
        className="inline-flex size-6 shrink-0 items-center justify-center rounded-sm text-ink-3 hover:text-ink-2"
      >
        <Info size={13} aria-hidden="true" />
      </button>
    </Tip>
  );
}
