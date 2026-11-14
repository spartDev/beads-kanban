#!/usr/bin/env bash
# sandbox.sh <commit> <dir> : copie isolée du dépôt pour un sous-agent (bdesk-dgp). Compatible bash 3.2 (macOS).
#
#   <dir>/tree       le commit, extrait par `git archive` (aucun .git), avec son propre node_modules
#   <dir>/home       HOME privé          <dir>/tmp         TMPDIR privé
#   <dir>/dolt-root  DOLT_ROOT_PATH      <dir>/bin         lien vers le binaire dolt (et vers node/pnpm/git, voir plus bas)
#   <dir>/env.sh     à sourcer : exporte HOME, TMPDIR, DOLT_ROOT_PATH et un PATH sans `bd`
#
# `bd` doit rester injoignable : bd 1.3.1 migre les schémas même pour `bd show`. Le PATH du bac à sable est donc celui de l'appelant moins
# tout dossier qui contient `bd`. Si node, pnpm ou git vivaient dans un de ces dossiers (c'est le cas de /opt/homebrew/bin), ils y sont
# retrouvés par un lien dans <dir>/bin : l'agent garde la même chaîne d'outils que l'appelant, pas celle qui reste par hasard dans le PATH.
set -euo pipefail

# Outils que les gates utilisent et qu'il ne faut pas perdre en retirant un dossier du PATH.
KEEP_TOOLS="node pnpm git"

die() { printf 'sandbox.sh : %s\n' "$*" >&2; exit 1; }

if [ $# -ne 2 ] || [ -z "$1" ] || [ -z "$2" ]; then
  printf 'usage : scripts/sandbox.sh <commit> <dir>\n        puis : source <dir>/env.sh\n' >&2
  exit 2
fi
commit=$1
dir=$2

# Chemin absolu de l'exécutable $1 tel que le PATH courant le trouve ; rien si ce n'est pas un fichier (alias, fonction, absent).
abs_cmd() {
  local p
  p=$(command -v "$1" 2>/dev/null) || return 0
  case $p in
    /*) printf '%s\n' "$p" ;;
    */*) printf '%s/%s\n' "$(cd "$(dirname "$p")" && pwd -P)" "$(basename "$p")" ;;
  esac
}

# Le dépôt est celui du script : son dossier parent.
script_dir=$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd -P)
repo=$(git -C "$script_dir" rev-parse --show-toplevel) || die "pas de dépôt git autour de $script_dir"
sha=$(git -C "$repo" rev-parse --verify --quiet "$commit^{commit}") || die "commit introuvable dans $repo : $commit"

# node_modules d'origine : un vrai dossier (le chemin physique si c'est un lien, pour que cp copie le contenu et pas le lien).
[ -d "$repo/node_modules" ] || die "$repo/node_modules n'existe pas : lancez « pnpm install » dans le dépôt d'abord"
src_modules=$(cd "$repo/node_modules" && pwd -P)

mkdir -p "$dir"
dir=$(cd "$dir" && pwd -P)
[ ! -e "$dir/tree" ] || die "$dir/tree existe déjà : prenez un dossier neuf, ou supprimez celui-là"
tree=$dir/tree
mkdir "$tree"
mkdir -p "$dir/home" "$dir/tmp" "$dir/dolt-root" "$dir/bin"

# 1. Le commit, sans historique ni fichier ignoré.
git -C "$repo" archive --format=tar "$sha" | tar -x -C "$tree"

# 2. node_modules : un clone APFS (instantané, copie à l'écriture), jamais un lien : tsc se perd dans un lien symbolique.
clone=clone
if ! cp -Rc "$src_modules" "$tree/node_modules"; then
  printf 'sandbox.sh : cp -Rc a échoué (volume sans clonage ?), copie complète à la place\n' >&2
  [ -n "$tree" ] && rm -rf "$tree/node_modules"
  cp -R "$src_modules" "$tree/node_modules"
  clone=copie
fi
[ -d "$tree/node_modules" ] && [ ! -L "$tree/node_modules" ] || die "$tree/node_modules n'est pas un dossier réel"

# 3. Dossiers du PATH qui contiennent bd : ils seront retirés. Les outils qui y habitent sont épinglés dans <dir>/bin.
bd_dirs=""
old_ifs=$IFS
IFS=:
for d in $PATH; do
  [ -n "$d" ] || continue
  if [ -f "$d/bd" ] && [ -x "$d/bd" ]; then bd_dirs="${bd_dirs:+$bd_dirs }$d"; fi
done
IFS=$old_ifs

pinned=""
tools=""
for t in $KEEP_TOOLS; do
  p=$(abs_cmd "$t")
  [ -n "$p" ] || continue
  tools="${tools:+$tools }$t"
  for d in $bd_dirs; do
    if [ "$(dirname "$p")" = "$d" ]; then
      ln -sf "$p" "$dir/bin/$t"
      pinned="${pinned:+$pinned }$t"
      break
    fi
  done
done

# dolt : toujours un lien dans <dir>/bin, s'il existe.
dolt_src=$(abs_cmd dolt)
has_dolt=0
if [ -n "$dolt_src" ]; then
  ln -sf "$dolt_src" "$dir/bin/dolt"
  has_dolt=1
fi

# 4. env.sh : les valeurs d'abord (échappées par %q), puis la logique, qui se recalcule à chaque `source`.
{
  printf '# Généré par scripts/sandbox.sh pour le commit %s. À SOURCER : source %q\n' "$sha" "$dir/env.sh"
  printf '# Pas de set -e ici : ce fichier s'"'"'exécute dans le shell de l'"'"'appelant.\n'
  printf 'SANDBOX_DIR=%q\n' "$dir"
  printf 'SANDBOX_TOOLS=%q\n' "$tools"
  printf 'SANDBOX_DOLT=%s\n' "$has_dolt"
  cat <<'EOF'

export HOME="$SANDBOX_DIR/home"
export TMPDIR="$SANDBOX_DIR/tmp"
export DOLT_ROOT_PATH="$SANDBOX_DIR/dolt-root"

# PATH : celui de l'appelant, sans dossier qui contient `bd` (ni notre propre bin, pour ne pas le doubler), puis notre bin en tête.
__sb_path=""
__sb_ifs=$IFS
IFS=:
for __sb_d in $PATH; do
  [ -n "$__sb_d" ] || continue
  [ "$__sb_d" = "$SANDBOX_DIR/bin" ] && continue
  if [ -f "$__sb_d/bd" ] && [ -x "$__sb_d/bd" ]; then continue; fi
  __sb_path="${__sb_path:+$__sb_path:}$__sb_d"
done
IFS=$__sb_ifs
export PATH="$SANDBOX_DIR/bin${__sb_path:+:$__sb_path}"
hash -r
unset -f bd 2>/dev/null
unalias bd 2>/dev/null || true

# Garde-fous : bd injoignable, dolt qui répond, outils des gates présents.
__sb_ok=1
if command -v bd >/dev/null 2>&1; then
  echo "env.sh : « bd » reste joignable ($(command -v bd)) : bac à sable refusé" >&2
  __sb_ok=0
fi
if [ "$SANDBOX_DOLT" = 1 ] && ! dolt version >/dev/null 2>&1; then
  echo "env.sh : « dolt version » échoue avec ce HOME et ce DOLT_ROOT_PATH" >&2
  __sb_ok=0
fi
for __sb_t in $SANDBOX_TOOLS; do
  if ! command -v "$__sb_t" >/dev/null 2>&1; then
    echo "env.sh : « $__sb_t » est introuvable dans le PATH du bac à sable" >&2
    __sb_ok=0
  fi
done
unset __sb_path __sb_ifs __sb_d __sb_t
if [ "$__sb_ok" != 1 ]; then
  unset __sb_ok
  return 1
fi
unset __sb_ok
EOF
} >"$dir/env.sh"

# 5. Vérification indépendante, dans un sous-shell : bd injoignable, dolt répond.
# shellcheck source=/dev/null
( . "$dir/env.sh" >/dev/null && ! command -v bd >/dev/null 2>&1 ) || die "vérification de $dir/env.sh échouée (bd joignable ou dolt muet)"

# 6. Résumé.
files=$(find "$tree" -path "$tree/node_modules" -prune -o -type f -print | wc -l | tr -d ' ')
subject=$(git -C "$repo" log -1 --format='%h %s' "$sha")
dolt_line="absent du PATH : les tests d'intégration Dolt seront sautés"
if [ "$has_dolt" = 1 ]; then
  # shellcheck source=/dev/null
  dolt_line="$dolt_src -> $dir/bin/dolt ; $( ( . "$dir/env.sh" >/dev/null && dolt version 2>&1 | head -n 1 ) )"
fi
bd_line="introuvable dans le PATH du bac à sable"
[ -n "$bd_dirs" ] && bd_line="$bd_line (dossiers retirés : $bd_dirs)"
printf 'Bac à sable prêt : %s\n' "$dir"
printf '  commit        %s\n' "$subject"
printf '  tree          %s (%s fichiers suivis) ; node_modules : %s APFS, pas un lien\n' "$tree" "$files" "$clone"
printf '  home          %s/home\n  tmp           %s/tmp\n  dolt-root     %s/dolt-root\n' "$dir" "$dir" "$dir"
printf '  dolt          %s\n' "$dolt_line"
printf '  bd            %s\n' "$bd_line"
[ -n "$pinned" ] && printf '  outils épinglés dans bin : %s (ils vivaient dans un dossier retiré)\n' "$pinned"
printf 'Pour l'"'"'utiliser : source %s/env.sh && cd %s/tree\n' "$dir" "$dir"
