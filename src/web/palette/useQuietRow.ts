import { useRef, useState, type KeyboardEvent, type PointerEvent } from 'react';

/** Valeur de cmdk qui ne désigne aucune ligne : tant qu'il la porte, il ne choisit pas de ligne d'office quand une ligne se monte. */
const NO_ROW = 'none:';

/** Les touches par lesquelles cmdk déplace la sélection : un choix de l'utilisateur. */
const CHOOSING_KEYS: ReadonlySet<string> = new Set(['ArrowDown', 'ArrowUp', 'Home', 'End']);

/**
 * Tient une ligne en retrait : tant que `quiet` est vrai, cmdk ne la sélectionne pas d'office, ni quand elle se monte ni à la frappe
 * suivante, et seul un choix de l'utilisateur (flèche, Début/Fin, survol) la sélectionne. Une ligne qui ne sert qu'à sortir d'une
 * impasse (« Chercher … dans tous les Projets », revenue parce que les tickets tardent) ne doit pas garder la sélection quand les
 * vraies lignes arrivent au-dessus : Entrée en ferait un mauvais choix. Sans sélection, ces lignes la prennent à leur arrivée comme
 * toute première ligne, et rien ne saute sous les yeux.
 *
 * cmdk n'a pas d'option pour cela. Il choisit d'office dans deux cas : quand une ligne se monte alors qu'il n'a aucune valeur, et à
 * chaque frappe. Au premier on répond en lui donnant une valeur qui ne désigne aucune ligne ; au second en refusant ce qu'il annonce par
 * `onValueChange` quand ce n'est pas un choix de l'utilisateur. Comme cmdk ne remet sa valeur à celle de la prop que lorsqu'elle change,
 * chaque refus change la valeur « aucune ligne ».
 *
 * Tout cela suppose le comportement interne de cmdk 1.1.1 (lu dans `dist/index.mjs`) : d'où la version épinglée dans `package.json`
 * (`"cmdk": "1.1.1"`, et non `^1.1.1`). Une montée de version se fait en connaissance de cause : les tests de non-sélection de
 * `CommandPalette.test.tsx` échouent si ce comportement change.
 */
export function useQuietRow({
  quiet,
  row,
  selected,
  select,
}: {
  /** La ligne est en retrait. */
  quiet: boolean;
  /** La valeur cmdk de la ligne (le `value` de son `Command.Item`). */
  row: string;
  /** La valeur sélectionnée, telle que la palette la tient (vide : aucune). */
  selected: string;
  select: (value: string) => void;
}) {
  // Un choix de l'utilisateur depuis la dernière frappe. Un ref : il ne change rien à l'affichage, seulement à ce qu'on accepte de cmdk.
  const chosen = useRef(false);
  const [refusals, setRefusals] = useState(0);

  return {
    /** À donner à `Command`. */
    commandProps: {
      value: quiet && selected === '' ? `${NO_ROW}${refusals}` : selected,
      onValueChange: (value: string) => {
        if (quiet && value === row && !chosen.current) setRefusals((count) => count + 1);
        else select(value);
      },
      // En phase de capture : avant que cmdk déplace la sélection, donc avant son `onValueChange`.
      onKeyDownCapture: (event: KeyboardEvent) => {
        if (CHOOSING_KEYS.has(event.key)) chosen.current = true;
      },
      onPointerMoveCapture: (event: PointerEvent) => {
        if (event.target instanceof Element && event.target.closest('[cmdk-item]')) chosen.current = true;
      },
    },
    /** À appeler à chaque changement de la saisie : cmdk choisit alors d'office, et le choix d'avant ne compte plus. */
    typed: () => {
      chosen.current = false;
    },
  };
}
