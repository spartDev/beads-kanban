#!/usr/bin/env bash
# gates.sh [dir] : typecheck, lint, build puis test dans <dir> (défaut : dossier courant). Compatible bash 3.2 (macOS).
#
# Les quatre portes tournent toujours, dans cet ordre, même si l'une échoue : le résumé donne le code de chacune.
# Logs dans <dir>/.gates/ ; sha256 de chaque fichier de dist/ (liste triée) dans <dir>/dist.sha256.
# Vitest tourne sur 3 workers : `pnpm -s test --maxWorkers=3`, SANS « -- ». Avec « pnpm test -- --maxWorkers=3 », pnpm transmet le « -- » à
# `vitest run` et vitest ignore ce qui le suit (mesuré : pic de 9 workers avec « -- », 3 sans, pnpm 10.0.0 et vitest 3.2.7).
# Vitest : si un échec ne vient que d'un « Timeout calling "onTaskUpdate" » (aucune ligne « Tests … failed »), il est relancé, deux fois au plus.
# Code de sortie : 0 seulement si tout est passé.
set -u -o pipefail

die() { printf 'gates.sh : %s\n' "$*" >&2; exit 2; }

[ $# -le 1 ] || die 'usage : scripts/gates.sh [dir]'
dir=${1:-.}
[ -d "$dir" ] || die "dossier introuvable : $dir"
dir=$(cd "$dir" && pwd -P)
[ -f "$dir/package.json" ] || die "pas de package.json dans $dir"
command -v pnpm >/dev/null 2>&1 || die 'pnpm est introuvable dans le PATH (source <dir>/env.sh ?)'
cd "$dir" || exit 2

logs=$dir/.gates
mkdir -p "$logs"
rm -f "$logs"/*.log "$logs"/summary.txt

failed=0
summary=""
add_line() { summary="$summary$1"$'\n'; }

# Retire les séquences de couleur ANSI du log $1 (vitest en met quand FORCE_COLOR traîne).
plain() { LC_ALL=C sed $'s/\033\\[[0-9;]*[A-Za-z]//g' "$1"; }

# run_gate <nom> <commande…> : lance, journalise dans .gates/<nom>.log, met le code dans $rc et la durée dans $secs.
run_gate() {
  local name=$1 start
  shift
  printf '[gates] %-9s ' "$name"
  start=$SECONDS
  "$@" >"$logs/$name.log" 2>&1 </dev/null
  rc=$?
  secs=$((SECONDS - start))
  if [ "$rc" -eq 0 ]; then printf 'ok (%ss)\n' "$secs"; else printf 'ÉCHEC code %s (%ss), voir %s\n' "$rc" "$secs" ".gates/$name.log"; fi
}

record() { # record <nom> <code> <durée> [note]
  add_line "$(printf '  %-10s code %-3s %5ss' "$1" "$2" "$3")${4:+  $4}"
  [ "$2" -eq 0 ] || failed=1
}

for name in typecheck lint build; do
  run_gate "$name" pnpm -s "$name"
  record "$name" "$rc" "$secs"
  [ "$rc" -eq 0 ] || { printf -- '--- fin de .gates/%s.log ---\n' "$name"; tail -n 25 "$logs/$name.log"; printf -- '---\n'; }
  case $name in build) build_rc=$rc ;; esac
done

# test : une relance si, et seulement si, le seul problème est le délai « onTaskUpdate » de vitest.
is_task_update_timeout() { # $1 = log
  grep -aqF 'Timeout calling "onTaskUpdate"' "$1" || return 1
  plain "$1" | grep -aqE 'Tests .* failed' && return 1
  return 0
}
attempt=0
test_log=$logs/test.log
total=0
while :; do
  printf '[gates] %-9s ' "test$([ "$attempt" -gt 0 ] && printf ' (relance %s)' "$attempt")"
  start=$SECONDS
  pnpm -s test --maxWorkers=3 >"$test_log" 2>&1 </dev/null
  rc=$?
  secs=$((SECONDS - start))
  total=$((total + secs))
  if [ "$rc" -eq 0 ]; then printf 'ok (%ss)\n' "$secs"; else printf 'ÉCHEC code %s (%ss), voir %s\n' "$rc" "$secs" ".gates/$(basename "$test_log")"; fi
  if [ "$rc" -ne 0 ] && [ "$attempt" -lt 2 ] && is_task_update_timeout "$test_log"; then
    attempt=$((attempt + 1))
    echo '[gates]           seul « Timeout calling "onTaskUpdate" », aucun test en échec : on relance'
    test_log=$logs/test.rerun$attempt.log
    continue
  fi
  break
done
note=""
[ "$attempt" -gt 0 ] && note="$attempt relance(s) pour « Timeout calling \"onTaskUpdate\" »"
record test "$rc" "$total" "$note"
if [ "$rc" -ne 0 ]; then printf -- '--- fin de %s ---\n' ".gates/$(basename "$test_log")"; tail -n 40 "$test_log"; printf -- '---\n'; fi

# dist.sha256 : une ligne « sha256  dist/chemin » par fichier de dist/, triées par chemin.
if command -v shasum >/dev/null 2>&1; then sha_cmd=(shasum -a 256); else sha_cmd=(sha256sum); fi
rm -f "$dir/dist.sha256"
if [ "${build_rc:-1}" -eq 0 ]; then
  if [ -d dist ] && [ -n "$(find dist -type f -print -quit)" ]; then
    if find dist -type f -print0 | LC_ALL=C sort -z | xargs -0 "${sha_cmd[@]}" -- >"$dir/dist.sha256" 2>"$logs/dist.log"; then
      count=$(wc -l <"$dir/dist.sha256" | tr -d ' ')
      digest=$("${sha_cmd[@]}" "$dir/dist.sha256" | cut -d' ' -f1)
      add_line "  dist.sha256 $count fichiers, empreinte de la liste $digest"
      [ -s "$logs/dist.log" ] || rm -f "$logs/dist.log"
    else
      failed=1
      add_line '  dist.sha256 : échec du calcul, voir .gates/dist.log'
    fi
  else
    failed=1
    add_line '  dist.sha256 : build réussi mais dist/ est vide'
  fi
else
  add_line '  dist.sha256 : non écrit (le build a échoué)'
fi

{
  printf 'Résumé des gates dans %s\n' "$dir"
  printf '%s' "$summary"
  if [ "$failed" -eq 0 ]; then echo 'GATES OK'; else echo 'GATES EN ÉCHEC'; fi
} | tee "$logs/summary.txt"

exit "$failed"
