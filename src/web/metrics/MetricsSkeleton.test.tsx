import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { MetricsSkeleton } from './MetricsSkeleton';

/**
 * bdesk-38k.81 (1) : le squelette qui remplace des chiffres déjà mesurés (le fuseau du navigateur change) garde leur hauteur ; celui de l'ouverture n'en réserve aucune.
 * Dans jsdom, rien n'a de taille : ce test dit ce qui est demandé à la mise en page, que Chromium a mesurée (voir la preuve de bdesk-38k.81).
 */
describe('MetricsSkeleton', () => {
  const status = () => screen.getByRole('status', { name: 'Chargement des métriques' });

  it('garde la hauteur qu’on lui donne : un plancher, pas une hauteur fixe, pour que la page ne rétrécisse pas', () => {
    render(<MetricsSkeleton minHeight={4090} />);

    expect(status().style.minHeight).toBe('4090px');
    expect(status().style.height).toBe('');
  });

  it('n’écrit aucune hauteur sans cela : le squelette de l’ouverture est celui de toujours', () => {
    render(<MetricsSkeleton />);

    expect(status().getAttribute('style')).toBeNull();
  });

  it('laisse la dernière rangée grandir : elle prend ce qui reste de la hauteur gardée, ses silhouettes n’ont qu’un plancher et non une hauteur', () => {
    render(<MetricsSkeleton minHeight={4090} />);

    const last = status().lastElementChild as HTMLElement;

    expect(last.className.split(' ')).toContain('flex-1');
    expect(last.children.length).toBeGreaterThan(0);
    for (const silhouette of Array.from(last.children)) {
      expect(silhouette.className.split(' ')).toContain('min-h-72');
      expect(silhouette.className.split(' ')).not.toContain('h-72');
    }
  });

  it('reste un statut nommé, occupé, hauteur gardée ou non : un lecteur d’écran en sait autant', () => {
    const { rerender } = render(<MetricsSkeleton minHeight={4090} />);
    expect(status().getAttribute('aria-busy')).toBe('true');

    rerender(<MetricsSkeleton />);

    expect(status().getAttribute('aria-busy')).toBe('true');
  });
});
