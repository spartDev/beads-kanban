import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { brotliDecompressSync } from 'node:zlib';

/**
 * La largeur d'un texte dans les polices de l'application (Atkinson Hyperlegible Next et Mono, variables), lue dans leurs fichiers WOFF2 : jsdom ne
 * met rien en page et ne mesure aucun texte. La largeur est la somme des avances de ses caractères (tables `cmap` et `hmtx`), à la graisse demandée
 * (axe `wght` de `fvar`, normalisé par `avar`, variations d'avance de `HVAR`). Ce qu'elle ne voit pas : le crénage (`GPOS`, qui rapproche plus qu'il
 * n'écarte), les ligatures, l'arrondi au pixel du navigateur ; un caractère absent de la police (sous-ensemble latin) compte pour le glyphe vide.
 * layout.test.ts s'en sert pour dire si un libellé, une pastille ou un âge tient dans une colonne étroite du tableau.
 */

const FONTS = join(import.meta.dirname, '../../../node_modules/@fontsource-variable');
export const SANS_FILE = join(FONTS, 'atkinson-hyperlegible-next/files/atkinson-hyperlegible-next-latin-wght-normal.woff2');
export const MONO_FILE = join(FONTS, 'atkinson-hyperlegible-mono/files/atkinson-hyperlegible-mono-latin-wght-normal.woff2');

/** Les étiquettes connues des tables d'un WOFF2, dans l'ordre de leur index (spécification WOFF2, 5.1). */
const KNOWN_TAGS =
  'cmap head hhea hmtx maxp name OS/2 post cvt_ fpgm glyf loca prep CFF_ VORG EBDT EBLC gasp hdmx kern LTSH PCLT VDMX vhea vmtx BASE GDEF GPOS GSUB EBSC JSTF MATH CBDT CBLC COLR CPAL SVG_ sbix acnt avar bdat bloc bsln cvar fdsc feat fmtx fvar gvar hsty just lcar mort morx opbd prop trak Zapf Silf Glat Gloc Feat Sill'
    .split(' ')
    .map((tag) => tag.replace('_', ' '));

type Tables = Record<string, DataView>;

/** Les tables du fichier, décompressées. `glyf` et `loca` y restent transformées : ce module ne les lit pas. */
function tablesOf(path: string): Tables {
  const file = readFileSync(path);
  const view = new DataView(file.buffer, file.byteOffset, file.byteLength);
  const count = view.getUint16(12);
  const compressed = view.getUint32(20);
  let at = 48;
  const base128 = () => {
    let value = 0;
    for (let i = 0; i < 5; i++) {
      const byte = view.getUint8(at++);
      value = value * 128 + (byte & 0x7f);
      if (!(byte & 0x80)) return value;
    }
    throw new Error('WOFF2 : entier UIntBase128 trop long');
  };
  const entries: { tag: string; length: number }[] = [];
  for (let i = 0; i < count; i++) {
    const flags = view.getUint8(at++);
    let tag = KNOWN_TAGS[flags & 0x3f];
    if ((flags & 0x3f) === 63) {
      tag = String.fromCharCode(...file.subarray(at, at + 4));
      at += 4;
    }
    if (tag === undefined) throw new Error(`WOFF2 : étiquette de table inconnue (${flags & 0x3f})`);
    const version = flags >> 6;
    const length = base128();
    const transformed = tag === 'glyf' || tag === 'loca' ? version === 0 : version !== 0;
    entries.push({ tag, length: transformed ? base128() : length });
  }
  const data = brotliDecompressSync(file.subarray(at, at + compressed));
  const tables: Tables = {};
  let offset = 0;
  for (const { tag, length } of entries) {
    tables[tag] = new DataView(data.buffer, data.byteOffset + offset, length);
    offset += length;
  }
  return tables;
}

/** Le glyphe de chaque caractère : sous-table Unicode de `cmap`, format 4 ou 12. */
function glyphsOf(cmap: DataView): Map<number, number> {
  let chosen: number | undefined;
  for (let i = 0; i < cmap.getUint16(2); i++) {
    const [platform, encoding, offset] = [cmap.getUint16(4 + i * 8), cmap.getUint16(6 + i * 8), cmap.getUint32(8 + i * 8)];
    const unicode = platform === 0 || (platform === 3 && (encoding === 1 || encoding === 10));
    if (unicode && (chosen === undefined || cmap.getUint16(offset) === 12)) chosen = offset;
  }
  if (chosen === undefined) throw new Error('cmap : aucune sous-table Unicode');
  const glyphs = new Map<number, number>();
  const format = cmap.getUint16(chosen);
  if (format === 4) {
    const segments = cmap.getUint16(chosen + 6) / 2;
    const [ends, starts] = [chosen + 14, chosen + 16 + segments * 2];
    const [deltas, ranges] = [starts + segments * 2, starts + segments * 4];
    for (let s = 0; s < segments; s++) {
      const [end, start, delta, range] = [cmap.getUint16(ends + s * 2), cmap.getUint16(starts + s * 2), cmap.getInt16(deltas + s * 2), cmap.getUint16(ranges + s * 2)];
      for (let code = start; code <= end && code !== 0xffff; code++) {
        if (range === 0) glyphs.set(code, (code + delta) & 0xffff);
        else {
          const glyph = cmap.getUint16(ranges + s * 2 + range + (code - start) * 2);
          glyphs.set(code, glyph === 0 ? 0 : (glyph + delta) & 0xffff);
        }
      }
    }
  } else if (format === 12) {
    for (let i = 0; i < cmap.getUint32(chosen + 12); i++) {
      const at = chosen + 16 + i * 12;
      for (let code = cmap.getUint32(at); code <= cmap.getUint32(at + 4); code++) glyphs.set(code, cmap.getUint32(at + 8) + code - cmap.getUint32(at));
    }
  } else throw new Error(`cmap : format ${format} non lu`);
  return glyphs;
}

/** La coordonnée normalisée de chaque axe pour cette graisse (`fvar`, puis `avar`). */
function coordinatesOf(tables: Tables, weight: number): number[] {
  const fvar = tables['fvar'];
  if (!fvar) return [];
  const [first, count, size] = [fvar.getUint16(4), fvar.getUint16(8), fvar.getUint16(10)];
  const avar = tables['avar'];
  let avarAt = 8;
  const coordinates: number[] = [];
  for (let axis = 0; axis < count; axis++) {
    const at = first + axis * size;
    const tag = String.fromCharCode(fvar.getUint8(at), fvar.getUint8(at + 1), fvar.getUint8(at + 2), fvar.getUint8(at + 3));
    const [min, def, max] = [fvar.getInt32(at + 4) / 65536, fvar.getInt32(at + 8) / 65536, fvar.getInt32(at + 12) / 65536];
    const value = tag === 'wght' ? Math.min(max, Math.max(min, weight)) : def;
    let normalized = value < def ? (value - def) / (def - min) : value > def ? (value - def) / (max - def) : 0;
    if (avar) {
      const pairs = avar.getUint16(avarAt);
      const map = Array.from({ length: pairs }, (_, k) => [avar.getInt16(avarAt + 2 + k * 4) / 16384, avar.getInt16(avarAt + 4 + k * 4) / 16384] as const);
      avarAt += 2 + pairs * 4;
      for (let k = 1; k < map.length; k++) {
        const [[x0, y0], [x1, y1]] = [map[k - 1] as readonly [number, number], map[k] as readonly [number, number]];
        if (normalized <= x1) {
          normalized = x1 === x0 ? y0 : y0 + ((normalized - x0) * (y1 - y0)) / (x1 - x0);
          break;
        }
      }
    }
    coordinates.push(normalized);
  }
  return coordinates;
}

/** La variation d'avance d'un glyphe à ces coordonnées (`HVAR` : magasin de variations, table de correspondance des avances). */
function advanceDelta(hvar: DataView | undefined): (glyph: number, coordinates: readonly number[]) => number {
  if (!hvar) return () => 0;
  const [store, mapping] = [hvar.getUint32(4), hvar.getUint32(8)];
  const regionsAt = store + hvar.getUint32(store + 2);
  const [axes, regionCount] = [hvar.getUint16(regionsAt), hvar.getUint16(regionsAt + 2)];
  const regions = Array.from({ length: regionCount }, (_, r) =>
    Array.from({ length: axes }, (_, a) => {
      const at = regionsAt + 4 + (r * axes + a) * 6;
      return [hvar.getInt16(at) / 16384, hvar.getInt16(at + 2) / 16384, hvar.getInt16(at + 4) / 16384] as const;
    }),
  );
  const sets = Array.from({ length: hvar.getUint16(store + 6) }, (_, i) => {
    const at = store + hvar.getUint32(store + 8 + i * 4);
    const [words, indexCount] = [hvar.getUint16(at + 2), hvar.getUint16(at + 4)];
    const long = (words & 0x8000) !== 0;
    const wordCount = words & 0x7fff;
    const indexes = Array.from({ length: indexCount }, (_, k) => hvar.getUint16(at + 6 + k * 2));
    const rowSize = long ? wordCount * 4 + (indexCount - wordCount) * 2 : wordCount * 2 + (indexCount - wordCount);
    return { rows: at + 6 + indexCount * 2, wordCount, long, indexes, rowSize };
  });
  const indexOf = (glyph: number): [number, number] => {
    if (!mapping) return [0, glyph];
    const [format, entry] = [hvar.getUint8(mapping), hvar.getUint8(mapping + 1)];
    const count = format === 0 ? hvar.getUint16(mapping + 2) : hvar.getUint32(mapping + 2);
    const [size, innerBits] = [((entry & 0x30) >> 4) + 1, (entry & 0x0f) + 1];
    const at = mapping + (format === 0 ? 4 : 6) + Math.min(glyph, count - 1) * size;
    let value = 0;
    for (let b = 0; b < size; b++) value = value * 256 + hvar.getUint8(at + b);
    return [Math.floor(value / 2 ** innerBits), value % 2 ** innerBits];
  };
  return (glyph, coordinates) => {
    const [outer, inner] = indexOf(glyph);
    const set = sets[outer];
    if (!set) return 0;
    let at = set.rows + inner * set.rowSize;
    let total = 0;
    set.indexes.forEach((region, k) => {
      const word = k < set.wordCount;
      const delta = set.long ? (word ? hvar.getInt32(at) : hvar.getInt16(at)) : word ? hvar.getInt16(at) : hvar.getInt8(at);
      at += set.long ? (word ? 4 : 2) : word ? 2 : 1;
      let scalar = 1;
      (regions[region] ?? []).forEach(([start, peak, end], axis) => {
        const c = coordinates[axis] ?? 0;
        if (peak === 0 || c === peak) return;
        scalar *= c <= start || c >= end ? 0 : c < peak ? (c - start) / (peak - start) : (end - c) / (end - peak);
      });
      total += delta * scalar;
    });
    return total;
  };
}

/**
 * Ce que le crénage peut ajouter à une mesure sans crénage, par mot : moins d'un pixel aux tailles de l'interface, étalonné sur Chromium
 * (fontMetrics.test.ts). layout.test.ts l'ajoute à chaque mot qu'il mesure.
 */
export const KERNING_ALLOWANCE = 1;

export interface TextStyle {
  /** Taille de police, en px. */
  size: number;
  /** Graisse (`wght`) : 400 par défaut, 500 pour `font-medium`, 600 pour `font-semibold`. */
  weight?: number;
}

/** De quoi mesurer un texte dans cette police : sa largeur en px, à la taille et à la graisse données. */
export function textMeasurer(path: string): (text: string, style: TextStyle) => number {
  const tables = tablesOf(path);
  const [head, hhea, hmtx, cmap] = [tables['head'], tables['hhea'], tables['hmtx'], tables['cmap']];
  if (!head || !hhea || !hmtx || !cmap) throw new Error(`${path} : il manque head, hhea, hmtx ou cmap`);
  const unitsPerEm = head.getUint16(18);
  const metrics = hhea.getUint16(34);
  const glyphs = glyphsOf(cmap);
  const delta = advanceDelta(tables['HVAR']);
  const coordinates = new Map<number, number[]>();
  return (text, { size, weight = 400 }) => {
    if (!coordinates.has(weight)) coordinates.set(weight, coordinatesOf(tables, weight));
    const at = coordinates.get(weight) as number[];
    let units = 0;
    for (const character of text) {
      const glyph = glyphs.get(character.codePointAt(0) ?? 0) ?? 0;
      units += hmtx.getUint16(4 * Math.min(glyph, metrics - 1)) + delta(glyph, at);
    }
    return (units / unitsPerEm) * size;
  };
}
