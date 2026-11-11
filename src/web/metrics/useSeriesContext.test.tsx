import { render, renderHook } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import type { Project } from '../data/types';
import { ProjectTile } from '../ui/ProjectTile';
import { useSeriesContext } from './useSeriesContext';

/**
 * La couleur d'un Projet dans les graphiques (bdesk-38k.73). Elle est celle de sa pastille dans la barre latérale : tirée de son préfixe, sinon de son nom. Un Projet sans préfixe dont le dossier
 * n'a pas de nom qu'on voie s'appelle « Sans titre » pour tous (bdesk-38k.65) : tiré de ce mot, tous prenaient la même couleur, dans les légendes, les points et les lignes du découpage par Projet. Sa
 * couleur vient du chemin de son dossier, comme celle de sa pastille. Les attendus sont écrits en dur, relevés sur HEAD (173b090) pour les Projets dont le nom se voit.
 */

const project = (overrides: Partial<Project> = {}): Project => ({
  id: 'bdesk',
  name: 'beads-desktop',
  path: '/dev/beads-desktop',
  prefix: 'bdesk',
  mode: 'embedded',
  status: 'ok',
  ...overrides,
});
const unnamed = (overrides: Partial<Project> = {}): Project => project({ id: 'projet', name: 'Sans titre', unnamed: true, path: '/dev/\u3164', prefix: '', ...overrides });

const contextOf = (known: Project[] | undefined, measured = known?.map(({ id, name, unnamed: blank }) => ({ id, name, ...(blank ? { unnamed: true as const } : {}) })) ?? []) =>
  renderHook(() => useSeriesContext(measured, known)).result.current;

describe('la couleur d’un Projet dans les graphiques, avec la liste des Projets', () => {
  it('diffère d’un Projet sans préfixe ni nom à l’autre : plus la même couleur pour tous', () => {
    const ctx = contextOf([unnamed({ id: 'projet', path: '/dev/\u3164' }), unnamed({ id: 'projet-2', path: '/dev/\u200b' })]);

    expect(ctx.projectHue('projet')).toBe(187);
    expect(ctx.projectHue('projet-2')).toBe(66);
  });

  it('n’est plus la teinte du mot de repli (229 pour « Sans titre »)', () => {
    const ctx = contextOf([unnamed({ id: 'projet', path: '/dev/\u3164' }), unnamed({ id: 'projet-2', path: '/dev/\u200b' })]);

    expect(ctx.projectHue('projet')).not.toBe(229);
    expect(ctx.projectHue('projet-2')).not.toBe(229);
  });

  it('suit le chemin du dossier et non l’identifiant, que la sortie d’un frère sans nom renumérote', () => {
    const before = contextOf([unnamed({ id: 'projet', path: '/dev/\u3164' })]);
    const after = contextOf([unnamed({ id: 'projet-3', path: '/dev/\u3164' })]);

    expect(before.projectHue('projet')).toBe(after.projectHue('projet-3'));
  });

  it('reste celle du préfixe quand le Projet sans nom en a un', () => {
    expect(contextOf([unnamed({ prefix: 'bdesk' })]).projectHue('projet')).toBe(11);
  });

  // [nom, préfixe, teinte] : relevé sur HEAD (173b090), `projectHue(préfixe || nom)`.
  it.each<[string, string, number]>([
    ['beads-desktop', 'bdesk', 11],
    ['My-Prompt-Manager', 'mpm', 330],
    ['beads-desktop', '', 260],
    ['legacy-api', '', 158],
    ['Mon Projet', '', 96],
    ['été', '', 222],
    ['-', '', 45],
    ['Sans titre', '', 229],
    ['Sans titre', 'bdesk', 11],
  ])('garde au Projet « %s » (préfixe « %s ») sa teinte %i', (name, prefix, hue) => {
    expect(contextOf([project({ id: 'p', name, prefix })]).projectHue('p')).toBe(hue);
  });

  it('nomme toujours le Projet « Sans titre » dans les légendes', () => {
    expect(contextOf([unnamed()]).projectName('projet')).toBe('Sans titre');
  });

  it('est la teinte que la pastille du même Projet pose, pour chacun : barre latérale et graphiques disent la même couleur', () => {
    const known = [
      project(),
      project({ id: 'mpm', name: 'My-Prompt-Manager', prefix: 'mpm', path: '/dev/mpm' }),
      project({ id: 'nu', name: 'legacy-api', prefix: '', path: '/dev/legacy-api' }),
      project({ id: 'st', name: 'Sans titre', prefix: '', path: '/dev/Sans titre' }),
      unnamed({ id: 'projet', path: '/dev/\u3164' }),
      unnamed({ id: 'projet-2', path: '/dev/\u200b', prefix: 'ghost' }),
      unnamed({ id: 'projet-3', path: '/dev/\u2800' }),
    ];
    const ctx = contextOf(known);

    for (const subject of known) {
      const { container, unmount } = render(<ProjectTile project={subject} />);
      const painted = (container.firstElementChild as HTMLElement).style.getPropertyValue('--h');
      unmount();
      expect(String(ctx.projectHue(subject.id)), subject.id).toBe(painted);
    }
  });
});

describe('la couleur d’un Projet dans les graphiques, sans la liste des Projets', () => {
  it('reste celle du nom que la réponse des métriques donne, pour un Projet dont le nom se voit', () => {
    const ctx = contextOf(undefined, [{ id: 'bdesk', name: 'beads-desktop' }]);

    expect(ctx.projectHue('bdesk')).toBe(260);
  });

  it('se tire de l’identifiant pour un Projet sans nom, faute de chemin : plus la même couleur pour tous', () => {
    const ctx = contextOf(undefined, [
      { id: 'projet', name: 'Sans titre', unnamed: true },
      { id: 'projet-2', name: 'Sans titre', unnamed: true },
    ]);

    expect(ctx.projectHue('projet')).toBe(300);
    expect(ctx.projectHue('projet-2')).toBe(329);
  });

  it('garde la teinte du nom à un dossier qui s’appelle vraiment « Sans titre »', () => {
    expect(contextOf(undefined, [{ id: 'sans-titre', name: 'Sans titre' }]).projectHue('sans-titre')).toBe(229);
  });
});
