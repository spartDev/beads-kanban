import { formatDuration, spokenDuration } from './format';

/** Une valeur s'écrit avec un chevron quand elle borne plutôt qu'elle ne mesure : « < 1 min », « > 99,9 % ». */
const HAS_CHEVRON = /[<>]/;

/**
 * Un texte écrit autrement qu'il se dit. Le chevron d'« < 1 min » ou de « > 99,9 % » est compact et se lit d'un coup d'œil, mais
 * un lecteur d'écran le lit tel quel, ou l'omet selon son réglage de ponctuation. Pour un texte qui en porte un (une valeur, ou la
 * phrase qui la contient), l'écran garde l'écriture, cachée aux lecteurs d'écran (`aria-hidden`), et les mots (« moins d'une
 * minute », « plus de 99,9 % ») ne sont écrits que pour eux (`sr-only`) : chacun est lu une fois. Tout autre texte reste seul, tel
 * quel et sans balise de plus : « 124 j » se lit tel quel.
 *
 * Avec `spelledOut`, un texte sans chevron est aussi redit en toutes lettres, entre parenthèses, pour les lecteurs d'écran
 * (« 189 j (189 jours) ») : c'est l'habitude des listes d'âges, où l'abréviation « j » ne se lit pas bien seule. Un texte à chevron
 * n'est jamais redit deux fois : ses mots remplacent l'écriture.
 */
export function SpokenText({ written, spoken, spelledOut = false }: { written: string; spoken: string; spelledOut?: boolean }) {
  if (!HAS_CHEVRON.test(written)) {
    if (!spelledOut || spoken === '') return <>{written}</>;
    return (
      <>
        {written}
        <span className="sr-only"> ({spoken})</span>
      </>
    );
  }
  return (
    <>
      <span aria-hidden="true">{written}</span>
      <span className="sr-only">{spoken}</span>
    </>
  );
}

/** Une durée écrite comme `formatDuration`, et dite « moins d'une minute » là où elle s'écrit « < 1 min ». */
export function DurationText({ ms }: { ms: number | null | undefined }) {
  return <SpokenText written={formatDuration(ms)} spoken={typeof ms === 'number' ? spokenDuration(ms) : ''} />;
}
