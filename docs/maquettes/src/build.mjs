/* global console */
/*
 * Assemble les maquettes. Chaque page de `src/` reçoit en ligne la feuille commune, les données et les outils : elle tient
 * alors dans un seul fichier, et s'ouvre partout (double-clic, panneau de fichiers, pièce jointe) sans ses voisins.
 * La page de comparaison, `index.html`, embarque les cinq variantes.
 *
 *   node docs/maquettes/src/build.mjs
 *
 * On modifie les fichiers de `src/`, jamais ceux du dossier parent : ils sont réécrits à chaque assemblage.
 */
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const src = dirname(fileURLToPath(import.meta.url));
const out = join(src, '..');
const read = (name) => readFileSync(join(src, name), 'utf8');

/** Les cinq variantes, dans l'ordre de la comparaison. `sample` : ce que la page de comparaison écrit dans leur police. */
const VARIANTS = [
  {
    file: '1-le-fil.html',
    name: 'Le fil',
    fonts: 'Atkinson Hyperlegible Next',
    family: "'Atkinson Hyperlegible Next', sans-serif",
    idea: 'Le parcours d’un ticket dessiné comme un fil de perles : les chiffres sont posés là où ils se produisent.',
    type: 'Dessinée pour que chaque caractère se distingue des autres. Lisibilité maximale, chiffres sans ambiguïté.',
  },
  {
    file: '2-grands-chiffres.html',
    name: 'Grands chiffres',
    fonts: 'Bricolage Grotesque',
    family: "'Bricolage Grotesque', sans-serif",
    idea: 'Quatre nombres lisibles depuis l’autre bout de la pièce. Le reste se tient en retrait.',
    type: 'Une grotesque française de caractère, qui change de dessin entre le texte et les très grands corps.',
  },
  {
    file: '3-le-point.html',
    name: 'Le point',
    fonts: 'Fraunces + Figtree',
    family: "'Fraunces', serif",
    idea: 'La page répond en phrases aux quatre questions qu’on se pose, les chiffres surlignés selon qu’ils progressent ou non.',
    type: 'Une sérif douce pour les réponses, une sans claire pour l’interface : la page se lit comme un compte rendu.',
  },
  {
    file: '4-bilan.html',
    name: 'Bilan',
    fonts: 'Nunito',
    family: "'Nunito', sans-serif",
    idea: 'Un bilan de santé : un indicateur par ligne, une perle de couleur et un verdict lisible sans connaître la métrique.',
    type: 'Des terminaisons arrondies, des chiffres ronds : la plus chaleureuse des cinq.',
  },
  {
    file: '5-nuit.html',
    name: 'Nuit',
    fonts: 'Lexend',
    family: "'Lexend', sans-serif",
    idea: 'La version sombre, refaite : une grille où les tuiles importantes sont physiquement plus grandes.',
    type: 'Large et ouverte, conçue pour réduire l’effort de lecture. Elle tient bien sur fond sombre.',
  },
];

/** Remplace les feuilles et les scripts locaux d'une page par leur contenu. */
function inline(html, page) {
  const done = html
    .replace(/<link rel="stylesheet" href="([\w.-]+\.css)">/g, (_, name) => '<style>\n' + read(name) + '</style>')
    .replace(/<script src="([\w.-]+\.js)"><\/script>/g, (_, name) => {
      const code = read(name);
      if (/<\/script/i.test(code)) throw new Error(`${name} contient « </script » : il fermerait la balise qui l'accueille.`);
      return '<script>\n' + code + '</script>';
    });
  const left = done.match(/(?:src|href)="(?!https?:|#|data:)[^"]+\.(?:js|css)"/);
  if (left) throw new Error(`${page} : ressource locale non intégrée (${left[0]}).`);
  return done;
}

const built = [];
for (const variant of VARIANTS) {
  if (!existsSync(join(src, variant.file))) {
    console.log(`  (à venir)  ${variant.file}`);
    continue;
  }
  const html = inline(read(variant.file), variant.file);
  writeFileSync(join(out, variant.file), html);
  built.push({ ...variant, html });
  console.log(`  ${String(Math.round(html.length / 1024)).padStart(4)} Ko  ${variant.file}`);
}

if (existsSync(join(src, 'index.html'))) {
  // Les variantes voyagent dans la page comme des chaînes : « < » est échappé pour qu'aucun « </script> » ne ferme la balise.
  const payload = JSON.stringify(built).replace(/</g, '\\u003c');
  const page = inline(read('index.html'), 'index.html');
  if (!page.includes('/*VARIANTES*/[]')) throw new Error('index.html : repère /*VARIANTES*/[] introuvable.');
  const html = page.replace('/*VARIANTES*/[]', () => payload);
  writeFileSync(join(out, 'index.html'), html);
  console.log(`  ${String(Math.round(html.length / 1024)).padStart(4)} Ko  index.html (${built.length} variantes)`);
}
