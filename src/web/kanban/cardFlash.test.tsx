import { render } from '@testing-library/react';
import { useRef } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { Issue } from '../data/types';
import { issue } from '../test/fixtures';
import { changedIssueIds, FLASH_DURATION_MS, useCardFlash } from './cardFlash';

describe('changedIssueIds : ce qui a changé entre deux relectures du Projet', () => {
  const a = issue({ id: 'a', title: 'A' });
  const b = issue({ id: 'b', title: 'B' });
  const c = issue({ id: 'c', title: 'C' });

  it('ne trouve rien quand les tickets sont les mêmes, même dans de nouveaux objets', () => {
    expect(changedIssueIds([a, b], [{ ...a }, { ...b }])).toEqual([]);
  });

  it.each<[string, Partial<Issue>]>([
    ['le statut (la carte change de colonne)', { status: 'in_progress' }],
    ['la priorité', { priority: 0 }],
    ['le titre', { title: 'Autre titre' }],
    ['le type', { type: 'bug' }],
    ['l’assigné', { assignee: 'tom' }],
    ['les dépendances', { blockedBy: ['b'] }],
    ['le parent', { parentId: 'p' }],
    ['la date de mise à jour (un commentaire, une note)', { updatedAt: '2026-10-11T09:00:00Z' }],
    ['la clôture', { closedAt: '2026-10-11T09:00:00Z' }],
  ])('repère un ticket dont change %s', (_what, change) => {
    expect(changedIssueIds([a, b], [{ ...a, ...change }, b])).toEqual(['a']);
  });

  it('repère un ticket créé', () => {
    expect(changedIssueIds([a], [a, b])).toEqual(['b']);
  });

  it('ignore un ticket supprimé : il n’y a plus de carte à mettre en valeur', () => {
    expect(changedIssueIds([a, b], [a])).toEqual([]);
  });

  it('rend les identifiants dans l’ordre de la nouvelle liste', () => {
    expect(changedIssueIds([a, b, c], [{ ...c, priority: 0 }, a, { ...b, priority: 0 }])).toEqual(['c', 'b']);
  });

  it('prend tous les tickets pour nouveaux quand il n’y avait rien avant', () => {
    expect(changedIssueIds([], [a, b])).toEqual(['a', 'b']);
  });
});

/** Un tableau minimal : une carte par ticket, comme le fait le kanban (`data-card-id`). */
function Cards({ issues }: { issues: readonly Issue[] }) {
  const ref = useRef<HTMLUListElement>(null);
  useCardFlash(ref, issues);
  return (
    <ul ref={ref}>
      {issues.map((ticket) => (
        <li key={ticket.id} data-card-id={ticket.id}>
          {ticket.title}
        </li>
      ))}
    </ul>
  );
}

/** Un tableau où seule la carte `a` est affichée : les autres sont filtrées, ou dans le tiroir « En pause » fermé. */
function OnlyA({ issues }: { issues: readonly Issue[] }) {
  const ref = useRef<HTMLUListElement>(null);
  useCardFlash(ref, issues);
  return (
    <ul ref={ref}>
      <li data-card-id="a">A</li>
    </ul>
  );
}

describe('useCardFlash : la carte qui bouge', () => {
  const a = issue({ id: 'a', title: 'A' });
  const b = issue({ id: 'b', title: 'B' });
  const animate = vi.fn();

  beforeEach(() => {
    animate.mockReset();
    Element.prototype.animate = animate as unknown as typeof Element.prototype.animate;
  });

  afterEach(() => {
    delete (Element.prototype as { animate?: unknown }).animate;
  });

  const flashed = () => animate.mock.contexts.map((element) => (element as HTMLElement).dataset.cardId);

  it('ne fait rien au premier affichage : le tableau qui s’ouvre n’est pas un changement', () => {
    render(<Cards issues={[a, b]} />);

    expect(animate).not.toHaveBeenCalled();
  });

  it('ne fait rien quand la relecture ne change rien, que la liste soit la même ou une copie', () => {
    const view = render(<Cards issues={[a, b]} />);

    view.rerender(<Cards issues={[a, b]} />);
    view.rerender(<Cards issues={[{ ...a }, { ...b }]} />);

    expect(animate).not.toHaveBeenCalled();
  });

  it('met en valeur la carte d’un ticket qui change, et elle seule', () => {
    const view = render(<Cards issues={[a, b]} />);

    view.rerender(<Cards issues={[{ ...a, status: 'in_progress' }, b]} />);

    expect(flashed()).toEqual(['a']);
  });

  it('met en valeur une carte nouvelle', () => {
    const view = render(<Cards issues={[a]} />);

    view.rerender(<Cards issues={[a, b]} />);

    expect(flashed()).toEqual(['b']);
  });

  it('met en valeur chaque carte changée, une fois chacune', () => {
    const view = render(<Cards issues={[a, b]} />);

    view.rerender(<Cards issues={[{ ...a, priority: 0 }, { ...b, priority: 0 }]} />);

    expect(flashed().sort()).toEqual(['a', 'b']);
  });

  it('ne remet pas en valeur une carte déjà signalée quand la liste suivante ne la change plus', () => {
    const changed = { ...a, status: 'in_progress' };
    const view = render(<Cards issues={[a, b]} />);
    view.rerender(<Cards issues={[changed, b]} />);
    animate.mockClear();

    view.rerender(<Cards issues={[{ ...changed }, b]} />);

    expect(animate).not.toHaveBeenCalled();
  });

  it('ne cherche pas une carte absente de l’écran (filtrée, tiroir fermé)', () => {
    const view = render(<OnlyA issues={[a, b]} />);

    expect(() => view.rerender(<OnlyA issues={[a, { ...b, priority: 0 }]} />)).not.toThrow();
    expect(animate).not.toHaveBeenCalled();
  });

  it('anime en douceur : une couleur qui s’estompe sur moins de deux secondes, sans boucle', () => {
    const view = render(<Cards issues={[a]} />);

    view.rerender(<Cards issues={[{ ...a, priority: 0 }]} />);

    const [keyframes, options] = animate.mock.calls[0] as [Keyframe[], KeyframeAnimationOptions];
    expect(options.duration).toBe(FLASH_DURATION_MS);
    expect(FLASH_DURATION_MS).toBeLessThan(2_000);
    expect(options.iterations ?? 1).toBe(1);
    expect(keyframes.length).toBeGreaterThanOrEqual(2);
    expect(keyframes.some((frame) => 'backgroundColor' in frame)).toBe(true);
  });

  it('se limite à un fondu de couleur quand l’utilisateur demande moins de mouvement', () => {
    const view = render(<Cards issues={[a]} />);
    const matchMedia = window.matchMedia;
    window.matchMedia = ((query: string) => ({ ...matchMedia(query), matches: /prefers-reduced-motion:\s*reduce/.test(query) })) as typeof window.matchMedia;
    try {
      view.rerender(<Cards issues={[{ ...a, priority: 0 }]} />);
    } finally {
      window.matchMedia = matchMedia;
    }

    const [keyframes] = animate.mock.calls[0] as [Keyframe[]];
    expect(keyframes.some((frame) => 'transform' in frame)).toBe(false);
    expect(keyframes.some((frame) => 'backgroundColor' in frame)).toBe(true);
  });

  it('garde un léger mouvement sinon', () => {
    const view = render(<Cards issues={[a]} />);

    view.rerender(<Cards issues={[{ ...a, priority: 0 }]} />);

    const [keyframes] = animate.mock.calls[0] as [Keyframe[]];
    expect(keyframes.some((frame) => 'transform' in frame)).toBe(true);
  });

  it('ne plante pas là où les animations ne sont pas disponibles', () => {
    delete (Element.prototype as { animate?: unknown }).animate;
    const view = render(<Cards issues={[a]} />);

    expect(() => view.rerender(<Cards issues={[{ ...a, priority: 0 }]} />)).not.toThrow();
  });
});
