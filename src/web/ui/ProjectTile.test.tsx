import { render } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import type { Project } from '../data/types';
import { ProjectTile } from './ProjectTile';

/**
 * La pastille d'un Projet (bdesk-38k.73). Un Projet dont le dossier n'a pas de nom qu'on voie s'écrit « Sans titre » (bdesk-38k.65) ; sa pastille, elle, prenait les initiales de ce repli (« ST ») et sa
 * teinte (la même pour tous les Projets sans préfixe ni nom, tirée du mot « Sans titre »). Elle porte maintenant un signe neutre, « ? », et une teinte tirée du chemin de son dossier. Les Projets dont le nom
 * se voit gardent leurs initiales et leur teinte, à l'identique : les attendus ci-dessous sont écrits en dur, relevés sur HEAD (173b090) avant le correctif, et non recalculés par le code qu'ils éprouvent.
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

/** Un Projet dont le nom du dossier ne se voit pas, tel que les données le donnent à l'interface : « Sans titre », et `unnamed` pour dire que c'est un repli. */
const unnamed = (overrides: Partial<Project> = {}): Project =>
  project({ id: 'projet', name: 'Sans titre', unnamed: true, path: '/dev/\u3164', prefix: '', ...overrides });

/** Ce que la pastille écrit, et la teinte qu'elle pose pour sa couleur (`--h`). */
function tile(subject: Project) {
  const { container, unmount } = render(<ProjectTile project={subject} />);
  const span = container.firstElementChild as HTMLElement;
  const seen = { text: span.textContent, hue: span.style.getPropertyValue('--h'), classes: span.className };
  unmount();
  return seen;
}

describe('les initiales de la pastille d’un Projet dont le nom ne se voit pas', () => {
  it('est un signe neutre, « ? » : ni « ST », les initiales de « Sans titre », qui ressembleraient à un Projet nommé ST', () => {
    expect(tile(unnamed()).text).toBe('?');
  });

  it('est « ? » aussi quand le Projet a un préfixe : le préfixe n’est pas son nom', () => {
    expect(tile(unnamed({ prefix: 'bdesk' })).text).toBe('?');
  });

  it('est « ? » aussi quand le Projet est illisible, sur sa pastille grisée', () => {
    const seen = tile(unnamed({ status: 'unreadable', reason: 'Base Dolt verrouillée' }));

    expect(seen.text).toBe('?');
    expect(seen.classes).toContain('bg-press');
  });
});

describe('les initiales de la pastille d’un Projet dont le nom se voit', () => {
  // [nom du dossier, préfixe, initiales, teinte] : relevé sur HEAD (173b090), `projectMonogram(nom)` et `projectHue(préfixe || nom)`.
  const HEAD: [string, string, string, number][] = [
    ['beads-desktop', 'bdesk', 'BD', 11],
    ['My-Prompt-Manager', 'mpm', 'MP', 330],
    ['beads-desktop', '', 'BD', 260],
    ['legacy-api', '', 'LA', 158],
    ['Mon Projet', '', 'MP', 96],
    ['projet_sans_espace', '', 'PS', 282],
    ['été', '', 'ÉT', 222],
    ['ÉCOLE', '', 'ÉC', 222],
    ['日本語', '', '日本', 143],
    ['ñandú', '', 'ÑA', 348],
    ['a', '', 'A', 97],
    ['AB', '', 'AB', 281],
    ['Ab Cd', '', 'AC', 32],
    ['2024-notes', '', '2N', 268],
    ['0', '', '0', 48],
    ['Zebra', '', 'ZE', 350],
    [' lead', '', 'LE', 108],
    ['trail ', '', 'TR', 242],
    ['Kan\u200bban', '', 'KB', 284],
    ['Mon  Projet', '', 'MP', 16],
    // Sans lettre ni chiffre : « ? » était déjà le signe de la pastille d’un tel nom.
    ['-', '', '?', 45],
    [':', '', '?', 58],
    ['???', '', '?', 279],
    // Un dossier qui s’appelle vraiment « Sans titre » a un nom qui se voit : ce n’est pas un Projet sans nom, il garde ses initiales et sa teinte.
    ['Sans titre', '', 'ST', 229],
    ['Sans titre', 'bdesk', 'ST', 11],
    ['Sans Titre', '', 'ST', 317],
    ['sans-titre', '', 'ST', 144],
  ];

  it.each(HEAD)('« %s » (préfixe « %s ») garde les initiales « %s » et la teinte %i', (name, prefix, monogram, hue) => {
    const seen = tile(project({ name, prefix }));

    expect(seen.text).toBe(monogram);
    expect(seen.hue).toBe(String(hue));
  });
});

describe('la teinte de la pastille d’un Projet sans préfixe ni nom', () => {
  // Relevé sur HEAD : la teinte de « Sans titre », la même pour tous.
  const FALLBACK_HUE = 229;

  it('est tirée du chemin de son dossier, un identifiant qui ne change pas d’un Projet à l’autre : /dev/\u3164 donne 187', () => {
    expect(tile(unnamed({ path: '/dev/\u3164' })).hue).toBe('187');
  });

  it('diffère d’un Projet sans nom à l’autre : /dev/\u3164 et /dev/ (U+200B) ne prennent plus la même couleur', () => {
    const first = tile(unnamed({ id: 'projet', path: '/dev/\u3164' })).hue;
    const second = tile(unnamed({ id: 'projet-2', path: '/dev/\u200b' })).hue;

    expect(first).toBe('187');
    expect(second).toBe('66');
    expect(second).not.toBe(first);
  });

  it('n’est plus celle du mot de repli : elle ne vient pas du libellé affiché', () => {
    expect(tile(unnamed({ path: '/dev/\u3164' })).hue).not.toBe(String(FALLBACK_HUE));
    expect(tile(unnamed({ path: '/dev/\u200b' })).hue).not.toBe(String(FALLBACK_HUE));
  });

  it('suit le chemin et non l’identifiant : un autre identifiant pour le même dossier (un frère sans nom est apparu, `projet` devient `projet-2`) garde la couleur', () => {
    expect(tile(unnamed({ id: 'projet', path: '/dev/\u3164' })).hue).toBe(tile(unnamed({ id: 'projet-2', path: '/dev/\u3164' })).hue);
  });

  it('suit le chemin : un autre dossier, une autre couleur, quel que soit l’identifiant', () => {
    expect(tile(unnamed({ id: 'projet', path: '/dev/\u3164' })).hue).not.toBe(tile(unnamed({ id: 'projet', path: '/dev/\u200b' })).hue);
  });

  it('reste celle du préfixe quand le Projet sans nom en a un : le préfixe est un identifiant qui se voit, et c’était déjà la règle', () => {
    expect(tile(unnamed({ prefix: 'bdesk' })).hue).toBe('11');
    expect(tile(unnamed({ prefix: 'mpm', path: '/dev/\u200b' })).hue).toBe('330');
  });

  it('reste celle du nom pour un dossier qui s’appelle vraiment « Sans titre » et n’a pas de préfixe : son nom se voit', () => {
    const real = project({ name: 'Sans titre', prefix: '', path: '/dev/Sans titre' });

    expect(tile(real).hue).toBe(String(FALLBACK_HUE));
  });
});
