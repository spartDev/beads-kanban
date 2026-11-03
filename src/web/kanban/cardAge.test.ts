import { describe, expect, it } from 'vitest';
import { formatAge } from '../lib/relativeTime';
import { withTimeZone } from '../test/timeZone';
import { doneSince } from './columns';

/**
 * L'âge écrit sur une carte et la fenêtre de Terminé racontent le même calendrier. Une carte « hier » est dans Terminé
 * quand la fenêtre couvre 2 jours (aujourd'hui et hier) et pas quand elle n'en couvre qu'un ; « avant-hier », à 3 jours ;
 * « il y a N j », à N + 1. Chaque libellé est vérifié contre `doneSince`, qui donne le début de la fenêtre, dans des fuseaux
 * aux changements d'heure variés : un jour de 25 h ou de 23 h ne doit décaler aucun libellé.
 */

const HOUR = 3_600_000;
const MINUTE = 60_000;
const iso = (ms: number) => new Date(ms).toISOString();
/** ICU met une espace insécable fine entre le nombre et l'unité (« 3 j ») : on compare avec des espaces ordinaires. */
const clean = (text: string) => text.replace(/[\u202f\u00a0]/g, ' ');

/**
 * Ce qu'un libellé dit du jour : les jours calendaires qu'il couvre (de… à…, inclus), `'date'` pour une date écrite en
 * toutes lettres (30 jours et plus), `null` si ce n'est pas un libellé en jours (une durée écoulée).
 */
function daysSaid(label: string): readonly [from: number, to: number] | 'date' | null {
  if (label === 'aujourd’hui') return [0, 0];
  if (label === 'hier') return [1, 1];
  if (label === 'avant-hier') return [2, 2];
  const days = /^il y a (\d+) j$/.exec(label);
  if (days) return [Number(days[1]), Number(days[1])];
  const weeks = /^il y a (\d+) sem\.$/.exec(label);
  // De 14 à 29 jours, par semaines entières : à 30 jours, c'est une date.
  if (weeks) return [7 * Number(weeks[1]), Math.min(7 * Number(weeks[1]) + 6, 29)];
  return /^\d{1,2} \S+( \d{4})?$/.test(label) ? 'date' : null;
}

/** Le libellé dit-il le bon jour ? `then` tient entre le début de la fenêtre de `to + 1` jours et celui de la fenêtre de `from`. */
function sayTheRightDay(then: number, now: number, said: readonly [number, number] | 'date'): boolean {
  if (said === 'date') return then < doneSince(now, 30);
  const [from, to] = said;
  // `doneSince(now, 0)` est minuit du lendemain : la borne haute d'aujourd'hui.
  return then >= doneSince(now, to + 1) && then < doneSince(now, from);
}

// Des fenêtres qui contiennent un changement d'heure de ces fuseaux : fin octobre/début novembre, fin mars/début avril,
// début mars et fin septembre/début octobre.
const WINDOWS: [string, string][] = [
  ['2026-10-20T00:00:00Z', '2026-11-05T00:00:00Z'],
  ['2026-03-24T00:00:00Z', '2026-04-10T00:00:00Z'],
  ['2026-03-04T00:00:00Z', '2026-03-12T00:00:00Z'],
  ['2026-09-24T00:00:00Z', '2026-10-08T00:00:00Z'],
];

describe.each(['Europe/Paris', 'America/Havana', 'America/New_York', 'Australia/Lord_Howe', 'Pacific/Auckland'])(
  'à %s',
  (zone) => {
    withTimeZone(zone);

    it('dès que 24 h ont passé, le libellé dit le jour que la fenêtre de Terminé range la carte (aujourd’hui, hier, N jours, semaines, date)', () => {
      const wrong: string[] = [];
      let checked = 0;
      const seen = new Set<string>();
      for (const [from, to] of WINDOWS) {
        for (let now = Date.parse(from); now < Date.parse(to); now += 11 * HOUR) {
          for (let then = now - 40 * 24 * HOUR; then <= now - 24 * HOUR; then += 131 * MINUTE) {
            const label = clean(formatAge(iso(then), now));
            const said = daysSaid(label);
            checked++;
            seen.add(said === 'date' ? 'date' : said === null ? `durée : ${label}` : label.replace(/\d+/, 'N'));
            if (said === null || !sayTheRightDay(then, now, said)) wrong.push(`${iso(then)} vu de ${iso(now)} : « ${label} »`);
          }
        }
      }
      expect(checked).toBeGreaterThan(5_000);
      expect(wrong.slice(0, 5)).toEqual([]);
      // Tous les régimes ont été exercés, pas seulement l'un d'eux (« aujourd'hui » après 24 h n'arrive qu'un jour de 25 h :
      // les tests de `formatAge` le couvrent).
      expect([...seen]).toEqual(expect.arrayContaining(['avant-hier', 'date', 'hier', 'il y a N j', 'il y a N sem.']));
    });

    it('avant 24 h, le libellé est une durée écoulée, jamais un jour : « il y a 23 h » ne dit pas « hier »', () => {
      const wrong: string[] = [];
      for (const [from, to] of WINDOWS) {
        for (let now = Date.parse(from); now < Date.parse(to); now += 11 * HOUR) {
          for (let then = now - 24 * HOUR + 1; then <= now; then += 37 * MINUTE) {
            const label = clean(formatAge(iso(then), now));
            if (!/^(à l’instant|il y a \d+ (min|h))$/.test(label)) wrong.push(`${iso(then)} vu de ${iso(now)} : « ${label} »`);
          }
        }
      }
      expect(wrong.slice(0, 5)).toEqual([]);
    });
  },
);
