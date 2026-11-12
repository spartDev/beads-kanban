import { afterEach, describe, expect, it } from 'vitest';
import { faultsOf } from './idLayout';

/**
 * Ce que `faultsOf` (test/idLayout.ts) voit, sur des lignes écrites ici plutôt que sur les composants de l'application : le test de mise en page des identifiants longs (pages/longIdentifiers.layout.test.tsx) ne vaut que par ce qu'il sait
 * refuser, et chaque refus tient ici à une classe de plus ou de moins sur un conteneur et son identifiant (bdesk-38k.90, revue). Les deux faiblesses que la revue a prouvées par mutants : un plafond `max-w-full` jugé suffisant sur une boîte flex qui ne passe pas
 * à la ligne (le panneau d'un ticket défilait de 818 px pour 670 avec `flex-wrap` ôté de la ligne des relations), et un `max-width` lu sur un élément en ligne, où il ne fait rien (la région du tableau de données défilait de 1 309 px pour 589 sans la boîte flex du lien).
 *
 * Les classes ne sont que celles de la feuille de style de production (Tailwind lit aussi ce fichier : une autre y ferait naître sa règle) ; ce qui n'y est pas, comme un `flex-flow` d'écriture libre, s'écrit en morceaux.
 */

afterEach(() => {
  document.body.innerHTML = '';
});

/** Une ligne : `<li><tag-parent class=row><tag class=id style=…>152 caractères</tag></tag-parent></li>`. */
function line(row: string, id: string, { tag = 'span', parent = 'a', style = '' }: { tag?: string; parent?: string; style?: string } = {}) {
  const item = document.createElement('li');
  const box = document.createElement(parent);
  if (row) box.className = row;
  const identifier = document.createElement(tag);
  if (id) identifier.className = id;
  if (style) identifier.setAttribute('style', style);
  identifier.textContent = 'k'.repeat(152);
  box.append(identifier);
  item.append(box);
  document.body.append(item);
  return { within: item, identifier };
}

const faults = async (...args: Parameters<typeof line>) => {
  const { within, identifier } = line(...args);
  return faultsOf(identifier, { within, viewport: 375 });
};

describe('une boîte flex qui range en ligne : l’identifiant rétrécit, ou il est plafonné sur une ligne qui passe à la ligne', () => {
  it('plafonné à la largeur de la ligne, sur une boîte qui passe à la ligne : rien à dire', async () => {
    expect(await faults('flex flex-wrap', 'max-w-full shrink-0 wrap-anywhere')).toEqual([]);
  });

  it('plafonné, mais sur une boîte qui ne passe pas à la ligne : ses voisins prennent la place, la ligne déborde', async () => {
    expect(await faults('flex', 'max-w-full shrink-0 wrap-anywhere')).toEqual([expect.stringMatching(/plafonné à la largeur de sa ligne.*ne passe pas à la ligne \(flex-wrap\)/)]);
  });

  it('qui rétrécit (largeur minimale nulle, facteur 1) : rien à dire, que la boîte passe à la ligne ou non', async () => {
    expect(await faults('flex', 'min-w-0 wrap-anywhere')).toEqual([]);
    expect(await faults('flex flex-wrap', 'min-w-0 wrap-anywhere')).toEqual([]);
  });

  it('qui rétrécit parce que le texte se coupe n’importe où, la largeur minimale restant « auto » : rien à dire', async () => {
    expect(await faults('flex', 'wrap-anywhere')).toEqual([]);
  });

  it('qui ne rétrécit pas (facteur nul) et n’est pas plafonné, que la boîte passe à la ligne ou non : refusé', async () => {
    expect(await faults('flex', 'shrink-0 wrap-anywhere')).toEqual([expect.stringMatching(/ne rétrécit pas \(facteur 0.*n'est pas plafonné/)]);
    expect(await faults('flex flex-wrap', 'shrink-0 wrap-anywhere')).toEqual([expect.stringMatching(/ne rétrécit pas \(facteur 0.*n'est pas plafonné/)]);
  });

  it('dont la largeur minimale est posée par une classe (autre que nulle) : on ne la croit pas assez petite, même si le texte se coupe n’importe où', async () => {
    const fixed = ['min', 'w', '40'].join('-');

    expect(await faults('flex flex-wrap', `${fixed} wrap-anywhere`)).toEqual([expect.stringMatching(/ne rétrécit pas \(facteur 1, largeur minimale calc\(.*\* 40\)\)/)]);
  });

  it('plafonné à autre chose que la largeur de la ligne (`max-w-[40ch]`) : la ligne peut être plus étroite que 40 caractères, refusé s’il ne rétrécit pas', async () => {
    expect(await faults('flex flex-wrap', 'max-w-[40ch] shrink-0 wrap-anywhere')).toEqual([expect.stringMatching(/ne rétrécit pas \(facteur 0.*n'est pas plafonné/)]);
  });

  it('dont la largeur minimale est celle du texte (`break-word` ne la réduit pas) : refusé', async () => {
    expect(await faults('flex', 'wrap-break-word')).toEqual([expect.stringMatching(/ne rétrécit pas \(facteur 1, largeur minimale celle du texte\)/)]);
  });

  it('dont la largeur minimale est posée en ligne et non plafonnée : refusé ; plafonnée à la largeur de la ligne : rien à dire', async () => {
    expect(await faults('flex flex-wrap', 'max-w-full shrink-0 wrap-anywhere', { style: 'min-width: 152ch' })).toEqual([expect.stringMatching(/largeur minimale de 152ch en ligne/)]);
    expect(await faults('flex flex-wrap', 'max-w-full shrink-0 wrap-anywhere', { style: 'min-width: min(152ch, 100%)' })).toEqual([]);
  });

  it('dans une boîte flex en colonne, ou hors d’une boîte flex : la largeur est celle du conteneur, rien à dire', async () => {
    expect(await faults('flex flex-col', 'shrink-0 wrap-anywhere')).toEqual([]);
    expect(await faults('', 'shrink-0 wrap-anywhere')).toEqual([]);
  });
});

describe('le texte doit pouvoir se couper et passer à la ligne', () => {
  it('sans coupure possible (ni `anywhere`, ni `break-word`, ni `break-all`) : refusé', async () => {
    expect(await faults('flex flex-wrap', 'min-w-0')).toEqual([expect.stringMatching(/le texte ne peut pas se couper/)]);
  });

  it('`break-all` coupe n’importe où, comme `anywhere`', async () => {
    expect(await faults('flex', 'break-all')).toEqual([]);
  });

  it('sur une ligne qui ne passe pas à la ligne (`whitespace-nowrap`), hérité d’un ancêtre ou posé sur l’identifiant : refusé', async () => {
    expect(await faults('flex flex-wrap', 'max-w-full shrink-0 wrap-anywhere whitespace-nowrap')).toEqual([expect.stringMatching(/le texte ne passe pas à la ligne : white-space vaut « nowrap »/)]);
    expect(await faults('flex flex-wrap whitespace-nowrap', 'max-w-full shrink-0 wrap-anywhere')).toEqual([expect.stringMatching(/white-space vaut « nowrap »/)]);
  });
});

describe('une largeur maximale ne s’applique qu’à une boîte', () => {
  // Le tableau de données plafonne l'identifiant à 40 caractères par `max-width` : le lien qui le porte est une boîte flex en colonne.
  it('sur un élément d’une boîte flex en colonne : elle s’applique', async () => {
    expect(await faults('flex flex-col', 'max-w-[40ch] wrap-break-word')).toEqual([]);
  });

  it('sur un `span` en ligne, dont le parent n’est pas une boîte flex : elle ne fait rien, refusé', async () => {
    expect(await faults('', 'max-w-[40ch] wrap-break-word')).toEqual([expect.stringMatching(/déclare max-width: 40ch, qui ne s'applique pas à un élément en ligne/)]);
  });

  it('une largeur minimale nulle (`min-w-0`) de même : elle ne fait rien sur un `span` en ligne, hors d’une boîte flex', async () => {
    expect(await faults('', 'min-w-0 wrap-anywhere')).toEqual([expect.stringMatching(/déclare min-width: .*ne s'applique pas à un élément en ligne/)]);
    expect(await faults('flex flex-col', 'min-w-0 wrap-anywhere')).toEqual([]);
    expect(await faults('', 'min-w-0 wrap-anywhere block')).toEqual([]);
  });

  it('sur un élément que sa classe rend bloc ou en ligne-bloc : elle s’applique', async () => {
    expect(await faults('', 'max-w-[40ch] wrap-break-word block')).toEqual([]);
    expect(await faults('', 'max-w-[40ch] wrap-break-word inline-block')).toEqual([]);
  });

  it('sur un élément que le navigateur met déjà en bloc (`div`, `p`) : elle s’applique', async () => {
    expect(await faults('', 'max-w-[40ch] wrap-break-word', { tag: 'div', parent: 'div' })).toEqual([]);
    expect(await faults('', 'max-w-[40ch] wrap-break-word', { tag: 'p', parent: 'div' })).toEqual([]);
  });

  it('sur un élément que sa classe remet en ligne, dans un bloc : refusé', async () => {
    expect(await faults('', 'max-w-[40ch] wrap-break-word inline', { tag: 'div', parent: 'div' })).toEqual([expect.stringMatching(/ne s'applique pas à un élément en ligne/)]);
  });
});

describe('ce que le test ne sait pas lire le fait échouer, au lieu de passer en silence', () => {
  it('un conteneur en grille', async () => {
    await expect(faults('grid', 'max-w-full wrap-anywhere')).rejects.toThrow(/Conteneur en grille/);
  });

  it('un conteneur ou un élément `display: contents`', async () => {
    await expect(faults('contents', 'max-w-full wrap-anywhere')).rejects.toThrow(/display: contents/);
  });

  it('un `style` en ligne qui pose une propriété lue', async () => {
    await expect(faults('flex flex-wrap', 'max-w-full shrink-0 wrap-anywhere', { style: 'flex-wrap: nowrap' })).rejects.toThrow(/Style en ligne que ce test ne sait pas lire/);
    await expect(faults('flex flex-wrap', 'max-w-full shrink-0 wrap-anywhere', { style: 'display: block' })).rejects.toThrow(/Style en ligne/);
  });

  it('une écriture qu’il n’ouvre pas : le raccourci `flex-flow` du rangement, une largeur logique', async () => {
    await expect(faults(['[flex-flow', 'row_wrap]'].join(':') + ' flex', 'max-w-full shrink-0 wrap-anywhere')).rejects.toThrow(/flex-flow, que ce test ne lit pas/);
    await expect(faults('flex flex-wrap', 'shrink-0 wrap-anywhere ' + ['[max-inline-size', '100%]'].join(':'))).rejects.toThrow(/max-inline-size, que ce test ne lit pas/);
  });

  it('une valeur de coupure qu’il ne connaît pas', async () => {
    await expect(faults('flex flex-wrap', ['[overflow-wrap', 'inherit]'].join(':') + ' max-w-full shrink-0')).rejects.toThrow(/overflow-wrap que ce test ne sait pas lire/);
  });
});
