import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { Skeleton } from '../ui/states';
import { Page } from './Page';

/**
 * Le titre d'un squelette est marqué `data-skeleton` (bdesk-38k.40) : le focus que « Réessayer » rend à une page qui se recharge ne doit pas s'y poser, la page
 * qui le remplace le retire du document, et le focus tomberait sur le corps de la page. Le marqueur, pas le texte : un squelette peut porter un texte réservé aux
 * lecteurs d'écran (« Chargement… ») sans cesser d'être un squelette.
 */
describe('Page : le marqueur du titre d’un squelette', () => {
  it('le titre d’une page, un texte, n’est pas marqué', () => {
    render(<Page title="Kanban" />);

    expect(screen.getByRole('heading', { level: 1, name: 'Kanban' }).hasAttribute('data-skeleton')).toBe(false);
  });

  it('un squelette à la place du titre est marqué', () => {
    render(<Page title={<Skeleton className="h-7 w-40" />} />);

    expect(document.querySelector('h1')?.hasAttribute('data-skeleton')).toBe(true);
  });

  it('un squelette qui porte un texte pour les lecteurs d’écran l’est aussi', () => {
    render(
      <Page
        title={
          <>
            <span className="sr-only">Chargement…</span>
            <Skeleton className="h-7 w-40" />
          </>
        }
      />,
    );

    expect(screen.getByRole('heading', { level: 1, name: 'Chargement…' }).hasAttribute('data-skeleton')).toBe(true);
  });
});
