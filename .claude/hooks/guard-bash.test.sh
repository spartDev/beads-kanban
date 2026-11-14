#!/usr/bin/env bash
# guard-bash.test.sh : cas de test du hook guard-bash.sh. Usage : .claude/hooks/guard-bash.test.sh [-v]   (-v : montre aussi le message des refus)
# Chaque cas passe deux fois, par le chemin jq puis, avec un PATH réduit à python3, par le chemin python3 -I. Code 0 si tout est conforme.
# Compatible bash 3.2 : lancez-le aussi avec /bin/bash.

# Les commandes de test portent des $ littéraux : elles sont entre apostrophes exprès.
# shellcheck disable=SC2016
here=$(cd "$(dirname "$0")" && pwd -P)
hook=${GUARD_HOOK:-$here/guard-bash.sh} # GUARD_HOOK : tester une variante du hook (mutation)
verbose=0
[ "${1:-}" = -v ] && verbose=1

# Un PATH sans jq : python3 seul, pour forcer le chemin python3.
work=$(mktemp -d "${TMPDIR:-/tmp}/guard-bash-test.XXXXXX") || exit 2
trap 'rm -rf "$work"' EXIT
mkdir "$work/pybin"
ln -s "$(command -v python3)" "$work/pybin/python3"
have_jq=0
command -v jq >/dev/null 2>&1 && have_jq=1

json() { # json <commande> [outil] : le JSON qu'envoie Claude Code à un hook PreToolUse
  python3 -I -c 'import json, sys
print(json.dumps({"session_id": "s", "cwd": "/tmp/x", "hook_event_name": "PreToolUse", "tool_name": sys.argv[2],
                  "tool_input": {"command": sys.argv[1], "description": "d"}, "tool_use_id": "t"}))' "$1" "${2:-Bash}"
}

pass=0
fail=0
run() { # run <mode> <json> : écrit le code de sortie dans $code et le stderr dans $err
  if [ "$1" = jq ]; then
    err=$(printf '%s' "$2" | /bin/bash "$hook" 2>&1 >/dev/null)
  else
    err=$(printf '%s' "$2" | PATH="$work/pybin" /bin/bash "$hook" 2>&1 >/dev/null)
  fi
  code=$?
}
expect() { # expect <code attendu> <commande> [outil]
  local want=$1 cmd=$2 mode modes label
  modes=python
  [ $have_jq -eq 1 ] && modes="jq python"
  label=$(printf '%s' "$cmd" | tr '\n' '~' | cut -c1-78)
  for mode in $modes; do
    run "$mode" "$(json "$cmd" "${3:-Bash}")"
    if [ "$code" -eq "$want" ]; then
      pass=$((pass + 1))
      printf 'ok    exit %s  [%-6s] %s\n' "$code" "$mode" "$label"
      if [ $verbose -eq 1 ] && [ "$code" -eq 2 ] && [ "$mode" = python ]; then printf '%s\n' "$err" | sed 's/^/                 | /'; fi
    else
      fail=$((fail + 1))
      printf 'FAIL  exit %s au lieu de %s  [%s] %s\n' "$code" "$want" "$mode" "$label"
      [ -n "$err" ] && printf '%s\n' "$err" | sed 's/^/                 | /'
    fi
  done
}
blocked() { expect 2 "$@"; }
allowed() { expect 0 "$@"; }

echo "== refusés (exit 2) =="
blocked 'find / -name x'
blocked "find ~ -name '*.ts'"
blocked 'find $HOME -name x'
blocked 'find "$HOME" -type f'
blocked 'find ${HOME}/ -name x'
blocked 'find /Users -name x'
blocked "find /Users/e0538224 -name '*.log'"
blocked 'find /Users/e0538224/ -maxdepth 3 -name x'
blocked 'find -L / -name x'
blocked 'cd src && find / -name x 2>/dev/null | head'
blocked '/usr/bin/find / -name x'
blocked 'time find ~ -name x'
blocked 'echo x | xargs -I{} find / -name {}'
blocked 'bash -c "find / -name x"'
blocked 'echo "$(find ~ -name x)"'
blocked 'FILES=$(find /Users/e0538224 -name x)'
blocked $'echo ok\nfind / -name x'
blocked 'pkill -f vitest'
blocked 'pkill node'
blocked 'pgrep -f "vite"'
blocked 'kill $(pgrep -fl node)'
blocked 'rm -rf /'
blocked 'rm -rf ~'
blocked 'rm -rf $HOME'
blocked 'rm -fr "$HOME/"'
blocked 'rm -rf /*'
blocked 'rm -r -f ~/'
blocked 'sudo rm -rf --no-preserve-root /'
blocked 'FOO=bar find / -x'
blocked 'find . / -name x'
blocked 'if find / -name x; then echo y; fi'
blocked 'for f in $(find ~ -name x); do echo "$f"; done'
blocked 'timeout 5 pkill -f x'
blocked "sh -c 'pgrep -fa node'"
blocked "bash -lc 'rm -rf \$HOME'"
blocked $'cat <<\'EOF\'\nbody\nEOF\nfind / -name x'

echo "== laissés passer (exit 0) =="
allowed 'find . -name x'
allowed 'find "$S" -name "*.ts"'
allowed 'find "$S/tree/src" -name x'
allowed 'find ~/Developer/beads-desktop/src -name x'
allowed 'find /Users/e0538224/Developer/beads-desktop -name x'
allowed 'find $HOME/Developer -name x'
allowed 'find . -path ./node_modules -prune -o -name x -print'
allowed 'kill 123'
allowed 'kill "$(cat "$S/pid")"'
allowed 'git status'
allowed 'git commit -m "bloque find / et pkill -f"'
allowed $'git commit -F - <<\'EOF\'\nfix: le hook refuse find / et pkill -f\nrm -rf ~\nEOF'
allowed 'pnpm test'
allowed 'pnpm -s typecheck && pnpm -s lint'
allowed 'grep -r foo src'
allowed 'pgrep -x node'
allowed 'pgrep node'
allowed 'rm -rf "$S/tree"'
allowed 'rm -rf ./dist node_modules'
allowed 'rm -rf /tmp/x'
allowed 'rm -f notes.txt'
allowed "echo 'pkill -f x; find / -name y'"
allowed 'echo "find / -name x"'
allowed 'git log --oneline | grep -i "find /"'
allowed '# find / -name x'
allowed 'command -v find'
allowed 'ls -la ~'
allowed 'bash script.sh -c "find /"'
allowed "ssh host 'find / -name x'"
allowed 'rm -rf ~/Library/Caches/x'
allowed 'xargs -0 rm -rf'
allowed 'git rm -rf ~/x'
allowed 'echo "guillemet jamais fermé'
allowed $'cat <<EOF\nfind /\nrm -rf ~\nEOF\nls'
allowed $'cat <<A <<B\nfind /\nA\npkill -f x\nB\nls'
allowed 'find / -name x' Read

echo "== entrée anormale =="
printf '%s' 'pas du json' | /bin/bash "$hook" >/dev/null 2>&1
code=$?
if [ $code -eq 1 ]; then pass=$((pass + 1)); echo "ok    exit 1  JSON illisible : erreur du hook, qui ne bloque pas"; else fail=$((fail + 1)); echo "FAIL  JSON illisible : exit $code au lieu de 1"; fi

echo
echo "$pass cas conformes, $fail en écart"
[ $fail -eq 0 ]
