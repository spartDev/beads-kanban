import { type RefObject, useEffect, useRef } from 'react';
import type { Issue } from '../data/types';

/** Durée du fondu : assez pour repérer la carte, trop peu pour gêner. */
export const FLASH_DURATION_MS = 1_800;

/**
 * Identifiants des tickets nouveaux ou modifiés entre deux relectures du Projet, dans l'ordre de la nouvelle liste. Un
 * ticket supprimé n'a plus de carte ; un ticket identique, même dans un nouvel objet, n'a rien de nouveau à montrer.
 * Toute différence compte : statut (la carte change de colonne), dépendances (elle passe en Blocage), titre, priorité,
 * assigné, date de mise à jour (un commentaire)… ce sont tous des champs que la carte affiche.
 */
export function changedIssueIds(previous: readonly Issue[], next: readonly Issue[]): string[] {
  const before = new Map(previous.map((issue) => [issue.id, JSON.stringify(issue)]));
  return next.filter((issue) => before.get(issue.id) !== JSON.stringify(issue)).map((issue) => issue.id);
}

const prefersReducedMotion = (): boolean =>
  typeof window !== 'undefined' && typeof window.matchMedia === 'function' && window.matchMedia('(prefers-reduced-motion: reduce)').matches;

/** Une teinte d'accent qui s'estompe jusqu'au fond de la carte ; un léger tassement au début, sauf demande contraire. */
function flashKeyframes(reducedMotion: boolean): Keyframe[] {
  const tint = 'color-mix(in oklab, var(--accent) 16%, var(--panel))';
  return reducedMotion
    ? [
        { offset: 0, backgroundColor: tint, boxShadow: '0 0 0 2px var(--accent)' },
        { offset: 1, backgroundColor: 'var(--panel)', boxShadow: '0 0 0 0 transparent' },
      ]
    : [
        { offset: 0, backgroundColor: tint, boxShadow: '0 0 0 2px var(--accent)', transform: 'scale(0.985)' },
        { offset: 0.12, transform: 'scale(1)' },
        { offset: 1, backgroundColor: 'var(--panel)', boxShadow: '0 0 0 0 transparent', transform: 'scale(1)' },
      ];
}

/**
 * La carte qui bouge : quand une relecture du Projet change des tickets, leurs cartes (déplacées d'une colonne, nouvelles,
 * modifiées) s'éclairent un instant. Rien au premier affichage, ni quand la relecture ne change rien : seuls les
 * changements qui arrivent pendant que le tableau est ouvert. `root` contient les cartes (`data-card-id`) ; une carte
 * absente de l'écran (filtrée, tiroir fermé) est ignorée. L'animation passe par l'API Web Animations : aucune classe
 * à ajouter, et rien à faire là où elle manque.
 */
export function useCardFlash(rootRef: RefObject<HTMLElement | null>, issues: readonly Issue[]): void {
  const previous = useRef(issues);

  useEffect(() => {
    const before = previous.current;
    previous.current = issues;
    if (before === issues) return;
    const changed = new Set(changedIssueIds(before, issues));
    const root = rootRef.current;
    if (changed.size === 0 || !root) return;

    const keyframes = flashKeyframes(prefersReducedMotion());
    for (const card of root.querySelectorAll<HTMLElement>('[data-card-id]')) {
      if (!changed.has(card.dataset.cardId ?? '') || typeof card.animate !== 'function') continue;
      card.animate(keyframes, { duration: FLASH_DURATION_MS, easing: 'ease-out' });
    }
  }, [issues, rootRef]);
}
