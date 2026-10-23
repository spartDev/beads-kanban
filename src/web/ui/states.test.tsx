import { render, screen } from '@testing-library/react';
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
