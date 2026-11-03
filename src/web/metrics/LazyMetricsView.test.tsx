import { render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';

/**
 * La vue des métriques (visx, d3, cinq graphiques) pèse près de 130 kB que le kanban n'a pas à télécharger : elle est un
 * morceau à part, chargé à l'ouverture d'une page Métriques ou de la Vue globale.
 *
 * Ici la vue réelle est remplacée par une vue minimale, car on vérifie QUAND son module est lu, pas ce qu'elle dessine (les
 * tests des pages s'en chargent). Une fabrique de `vi.mock` ne tourne qu'à la première lecture du module : si les pages
 * l'importaient d'emblée, elle tournerait dès l'import des pages.
 */
const view = vi.hoisted(() => ({ evaluated: vi.fn() }));
vi.mock('./MetricsView', () => {
  view.evaluated();
  return { MetricsView: () => <p>La vue des métriques est chargée</p> };
});

describe('la vue des métriques, chargée à la demande', () => {
  // Importer les routes lit et transforme toute l'application : à froid, sous la charge de la suite entière, c'est plus que les 5 s par défaut.
  it('n’est pas lue à l’import des pages ni des routes : seul son affichage la charge', { timeout: 30_000 }, async () => {
    await import('../pages/MetricsPage');
    await import('../pages/GlobalPage');
    await import('../routes');

    expect(view.evaluated).not.toHaveBeenCalled();
  });

  it('montre la silhouette de la page le temps que le morceau se charge, puis la vue', async () => {
    const { LazyMetricsView } = await import('./LazyMetricsView');

    render(<LazyMetricsView scope={{ kind: 'global' }} />);

    // Même silhouette que celle du calcul des chiffres : la page ne change pas d'allure entre les deux attentes.
    expect(screen.getByRole('status', { name: 'Chargement des métriques' })).toBeTruthy();
    expect(screen.queryByText('La vue des métriques est chargée')).toBeNull();

    expect(await screen.findByText('La vue des métriques est chargée')).toBeTruthy();
    expect(screen.queryByRole('status', { name: 'Chargement des métriques' })).toBeNull();
    expect(view.evaluated).toHaveBeenCalledTimes(1);
  });
});
