import { act, render, screen } from '@testing-library/react';
import { StrictMode } from 'react';
import { describe, expect, it, vi } from 'vitest';
import { ApiError } from '../data/client';
import { ErrorNotice } from './states';

describe('ErrorNotice', () => {
  it('titre un Projet illisible (503 avec raison) « Projet illisible », avec la raison, à la place du titre générique', () => {
    const error = new ApiError('Base Dolt verrouillée', 503, { reason: 'Base Dolt verrouillée' });
    render(<ErrorNotice error={error} title="Impossible de charger les tickets" onRetry={vi.fn()} />);

    const alert = screen.getByRole('alert');
    expect(alert.querySelector('p')?.textContent).toBe('Projet illisible');
    expect(alert.textContent).toContain('Base Dolt verrouillée');
    expect(alert.textContent).not.toContain('Impossible de charger les tickets');
    expect(screen.getByRole('button', { name: /Réessayer/ })).toBeTruthy();
  });

  it('garde le titre de l’appelant, puis la cause, pour les autres erreurs', () => {
    render(<ErrorNotice error={new ApiError('boom', 500)} title="Impossible de charger les tickets" />);

    const alert = screen.getByRole('alert');
    expect(alert.querySelector('p')?.textContent).toBe('Impossible de charger les tickets');
    expect(alert.textContent).toContain('Le serveur a rencontré une erreur');
    expect(alert.textContent).toContain('boom');
  });
});

describe('ErrorNotice : le focus qu’il tient quand il part (bdesk-38k.40)', () => {
  /** Un contenu principal (et une région qui est une zone de focus) où l'avis d'erreur est remplacé par le contenu, comme le squelette le remplace au rechargement. */
  function Page({ failed, zone = false }: { failed: boolean; zone?: boolean }) {
    const notice = failed ? <ErrorNotice error={new ApiError('boom', 500)} onRetry={vi.fn()} /> : <p>Chargé</p>;
    return (
      <>
        <button type="button">Ailleurs</button>
        <main>
          <h1>Page</h1>
          {zone ? (
            <section aria-label="Liste" data-focus-zone="" className="outline-none">
              <h2>Liste</h2>
              {notice}
            </section>
          ) : (
            notice
          )}
        </main>
      </>
    );
  }

  it('« Réessayer » a le focus quand l’avis part : le contenu principal le prend, pas le corps de la page', () => {
    const { rerender } = render(<Page failed />);
    act(() => screen.getByRole('button', { name: /Réessayer/ }).focus());

    rerender(<Page failed={false} />);

    expect(screen.queryByRole('button', { name: /Réessayer/ })).toBeNull();
    expect(document.activeElement).toBe(screen.getByRole('main'));
  });

  it('une région marquée comme zone de focus est plus proche : elle prend le focus à la place du contenu principal', () => {
    const { rerender } = render(<Page failed zone />);
    act(() => screen.getByRole('button', { name: /Réessayer/ }).focus());

    rerender(<Page failed={false} zone />);

    expect(document.activeElement).toBe(screen.getByRole('region', { name: 'Liste' }));
  });

  it('l’avis d’un panneau de ticket : le panneau prend le focus, pas le contenu principal où il est posé', () => {
    function Panel({ failed }: { failed: boolean }) {
      return (
        <main>
          <div role="dialog" aria-label="Ticket" data-issue-panel="" tabIndex={-1}>
            {failed ? <ErrorNotice error={new ApiError('boom', 500)} onRetry={vi.fn()} /> : <p>Chargé</p>}
          </div>
        </main>
      );
    }
    const { rerender } = render(<Panel failed />);
    act(() => screen.getByRole('button', { name: /Réessayer/ }).focus());

    rerender(<Panel failed={false} />);

    expect(document.activeElement).toBe(screen.getByRole('dialog', { name: 'Ticket' }));
  });

  it('le focus est ailleurs quand l’avis part : il n’est pas repris', () => {
    const { rerender } = render(<Page failed zone />);
    const elsewhere = screen.getByRole('button', { name: 'Ailleurs' });
    act(() => elsewhere.focus());

    rerender(<Page failed={false} zone />);

    expect(document.activeElement).toBe(elsewhere);
  });

  it('en StrictMode (le développement monte les refs deux fois), l’avis ne prend le focus à personne en s’affichant, et le rend en partant', () => {
    const { rerender } = render(
      <StrictMode>
        <Page failed={false} zone />
      </StrictMode>,
    );
    const elsewhere = screen.getByRole('button', { name: 'Ailleurs' });
    act(() => elsewhere.focus());

    rerender(
      <StrictMode>
        <Page failed zone />
      </StrictMode>,
    );
    expect(document.activeElement).toBe(elsewhere); // l'avis qui s'affiche ne prend pas le focus
    act(() => screen.getByRole('button', { name: /Réessayer/ }).focus());

    rerender(
      <StrictMode>
        <Page failed={false} zone />
      </StrictMode>,
    );
    expect(document.activeElement).toBe(screen.getByRole('region', { name: 'Liste' }));
  });

  it('la zone n’est focalisable que le temps qu’elle a le focus', () => {
    const { rerender } = render(<Page failed zone />);
    const region = screen.getByRole('region', { name: 'Liste' });
    expect(region.hasAttribute('tabindex')).toBe(false);
    act(() => screen.getByRole('button', { name: /Réessayer/ }).focus());

    rerender(<Page failed={false} zone />);
    expect(region.getAttribute('tabindex')).toBe('-1');
    act(() => screen.getByRole('button', { name: 'Ailleurs' }).focus());

    expect(region.hasAttribute('tabindex')).toBe(false);
  });
});
