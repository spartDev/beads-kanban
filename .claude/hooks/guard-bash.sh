#!/usr/bin/env bash
# guard-bash.sh : hook PreToolUse de Claude Code (matcher « Bash »), bdesk-dgp. Compatible bash 3.2 (macOS).
#
# Entrée : le JSON de l'appel sur stdin, {"tool_name":"Bash","tool_input":{"command":"…"},"cwd":"…",…}.
# Sortie : exit 0 laisse passer ; exit 2 refuse l'appel, et Claude lit le message écrit sur stderr.
# Tout autre code est une erreur du hook qui ne bloque rien (l'appel passe, un avis s'affiche).
#
# Refuse, avec ce qu'il faut faire à la place :
#   - find dont une racine est /, ~, ~nom, $HOME, /Users ou /Users/<nom> (le home) : parcours du disque entier ;
#   - pkill, et pgrep avec -f : tuer par motif peut abattre le processus d'un autre agent ;
#   - rm -r (donc rm -rf) sur /, ~, $HOME ou /Users/<nom>.
# Laisse tout le reste, git compris (l'orchestrateur commite dans le dépôt vivant).
#
# La commande est lue mot à mot : guillemets, \ , ; & | ( ) $( ) `…` et corps de heredoc sont respectés, de sorte qu'un message de commit ou un
# ticket qui CITE « find / » ne soit pas pris pour un appel. On regarde le premier mot de chaque commande simple, après les préfixes usuels
# (VAR=x, sudo, env, time, nohup, xargs…), et on descend dans `bash -c '…'`, `eval` et les sous-commandes.
# Ne voit pas : un chemin calculé (`find "$X"` avec X=/), ni `cd ~ && find .`.

# Motifs littéraux voulus ('~', '$HOME', '\' : on compare du texte, on ne développe rien) et entiers sûrs non cités dans [ ] et seg[$i].
# shellcheck disable=SC2088,SC2016,SC1003,SC2086,SC2004
LC_ALL=C
export LC_ALL

# ---- 1. Lire le JSON : jq s'il est là, sinon python3 -I. Un seul appel, tool_name et command séparés par \001. ----
# Tout stdin, sans dépendre de cat (le JSON ne contient pas de NUL, read s'arrête donc à la fin du flux, avec le code 1).
IFS= read -r -d '' input
sep=$'\001'
if command -v jq >/dev/null 2>&1; then
  parsed=$(printf '%s' "$input" | jq -j '(.tool_name // ""), "\u0001", (.tool_input.command // "")' 2>/dev/null) || parsed=""
elif command -v python3 >/dev/null 2>&1; then
  parsed=$(printf '%s' "$input" | python3 -I -c 'import json, sys
d = json.load(sys.stdin)
ti = d.get("tool_input") or {}
sys.stdout.write(str(d.get("tool_name") or "") + "\x01" + str(ti.get("command") or ""))' 2>/dev/null) || parsed=""
else
  echo "guard-bash : ni jq ni python3 dans le PATH, la commande n'est pas vérifiée" >&2
  exit 1
fi
case $parsed in
  *"$sep"*) ;;
  *)
    echo "guard-bash : entrée illisible (JSON attendu sur stdin), la commande n'est pas vérifiée" >&2
    exit 1
    ;;
esac
tool=${parsed%%"$sep"*}
cmd=${parsed#*"$sep"}
[ -z "$tool" ] || [ "$tool" = Bash ] || exit 0

# Chemin rapide : rien qui ressemble aux trois règles.
case $cmd in
  *find* | *pgrep* | *pkill* | *rm*) ;;
  *) exit 0 ;;
esac

# ---- 2. Analyse ----
DEPTH=0
MSG=""
BAD=""

# Le mot $1 désigne-t-il /, ~, ~nom, $HOME, /Users ou /Users/<nom> (ou leur contenu direct, /* ~/* $HOME/*) ? Les sous-dossiers précis passent.
is_wide() {
  local p=$1
  while [ ${#p} -gt 1 ] && [ "${p%/}" != "$p" ]; do p=${p%/}; done
  case $p in
    / | '/*' | '~' | '~/*' | '$HOME' | '$HOME/*' | '${HOME}' | '${HOME}/*' | /Users | '/Users/*') return 0 ;;
    /Users/*/* | '~'*/*) return 1 ;;
    /Users/* | '~'*) return 0 ;;
  esac
  return 1
}

# find : les racines sont les mots avant la première expression (-name, !, (…) ; -H -L -P -E -X -d -s -x -O* -D x -f chemin s'écrivent avant.
check_find() {
  local a skip=0 want=0
  for a in "$@"; do
    if [ $skip -eq 1 ]; then
      skip=0
      continue
    fi
    if [ $want -eq 1 ]; then
      want=0
      if is_wide "$a"; then MSG=find BAD=$a; return 1; fi
      continue
    fi
    case $a in
      -H | -L | -P | -E | -X | -d | -s | -x | -O*) ;;
      -D) skip=1 ;;
      -f) want=1 ;;
      -* | '!' | '(') return 0 ;;
      *) if is_wide "$a"; then MSG=find BAD=$a; return 1; fi ;;
    esac
  done
  return 0
}

# pgrep : refusé avec -f (seul ou dans un groupe : -fl, -lf, -af) ou --full ; sans -f il ne vise que le nom du processus.
check_pgrep() {
  local a
  for a in "$@"; do
    case $a in
      --) return 0 ;;
      --full) MSG=pkill BAD='pgrep --full'; return 1 ;;
      --*) ;;
      -*f*) MSG=pkill BAD="pgrep $a"; return 1 ;;
    esac
  done
  return 0
}

# rm : récursif (-r, -R, -rf, --recursive…) avec un opérande « large ».
check_rm() {
  local a rec=0 dd=0 target=""
  for a in "$@"; do
    if [ $dd -eq 0 ]; then
      case $a in
        --) dd=1; continue ;;
        --recursive) rec=1; continue ;;
        --*) continue ;;
        -*) case $a in *[rR]*) rec=1 ;; esac; continue ;;
      esac
    fi
    if is_wide "$a"; then target=$a; fi
  done
  if [ $rec -eq 1 ] && [ -n "$target" ]; then MSG=rm BAD=$target; return 1; fi
  return 0
}

# bash -c '…', sh -c, zsh -c… : on analyse la chaîne. Les mots reçus sont ceux qui suivent le nom du shell.
check_shell() {
  while [ $# -gt 0 ]; do
    case $1 in
      --) return 0 ;;
      --*) ;;
      -o | -O | +o | +O) shift ;;
      -*c*)
        if [ $# -ge 2 ]; then
          scan_nested "$2"
          return $?
        fi
        return 0
        ;;
      -* | +*) ;;
      *) return 0 ;;
    esac
    shift
  done
  return 0
}

# La commande simple formée des mots $@ : préfixes, puis règles selon le premier mot.
check_segment() {
  local -a w
  w=("$@")
  local n=$# i=0 cmd base
  while [ $i -lt $n ]; do
    cmd=${w[$i]}
    case $cmd in
      [A-Za-z_]*=*) i=$((i + 1)) ;;
      '!' | '{' | '}' | if | then | else | elif | do | while | until | coproc) i=$((i + 1)) ;;
      time | command | builtin | exec | nohup)
        i=$((i + 1))
        while [ $i -lt $n ]; do
          case ${w[$i]} in -*) i=$((i + 1)) ;; *) break ;; esac
        done
        ;;
      sudo | doas)
        i=$((i + 1))
        while [ $i -lt $n ]; do
          case ${w[$i]} in
            -u | -g | -h | -p | -C | -T | -D | -R | -U | -r | -t) i=$((i + 2)) ;;
            -* | [A-Za-z_]*=*) i=$((i + 1)) ;;
            *) break ;;
          esac
        done
        ;;
      env)
        i=$((i + 1))
        while [ $i -lt $n ]; do
          case ${w[$i]} in
            -u | -C | -S | -P) i=$((i + 2)) ;;
            -* | [A-Za-z_]*=*) i=$((i + 1)) ;;
            *) break ;;
          esac
        done
        ;;
      nice)
        i=$((i + 1))
        case ${w[$i]:-} in -n) i=$((i + 2)) ;; -[0-9]*) i=$((i + 1)) ;; esac
        ;;
      timeout)
        i=$((i + 1))
        while [ $i -lt $n ]; do
          case ${w[$i]} in
            -s | -k) i=$((i + 2)) ;;
            -*) i=$((i + 1)) ;;
            *) break ;;
          esac
        done
        i=$((i + 1))
        ;;
      xargs)
        i=$((i + 1))
        while [ $i -lt $n ]; do
          case ${w[$i]} in
            -I | -J | -n | -L | -P | -s | -d | -E | -R | -S) i=$((i + 2)) ;;
            -*) i=$((i + 1)) ;;
            *) break ;;
          esac
        done
        ;;
      *) break ;;
    esac
  done
  [ $i -lt $n ] || return 0
  cmd=${w[$i]}
  base=${cmd##*/}
  case $base in
    find) check_find "${w[@]:$((i + 1))}" ;;
    pkill) MSG=pkill BAD=$cmd; return 1 ;;
    pgrep) check_pgrep "${w[@]:$((i + 1))}" ;;
    rm) check_rm "${w[@]:$((i + 1))}" ;;
    bash | sh | zsh | dash | ksh) check_shell "${w[@]:$((i + 1))}" ;;
    eval) scan_nested "${w[*]:$((i + 1))}" ;;
    *) return 0 ;;
  esac
}

# MATCH_END : indice du « ) » qui ferme le « ( » placé à l'indice $2 de $1 (ou la longueur de $1 s'il manque).
match_paren() {
  local s=$1 j=$2 n=${#1} depth=0 c
  while [ $j -lt $n ]; do
    c=${s:$j:1}
    case $c in
      \\) j=$((j + 1)) ;;
      "'")
        j=$((j + 1))
        while [ $j -lt $n ] && [ "${s:$j:1}" != "'" ]; do j=$((j + 1)); done
        ;;
      '"')
        j=$((j + 1))
        while [ $j -lt $n ] && [ "${s:$j:1}" != '"' ]; do
          [ "${s:$j:1}" = '\' ] && j=$((j + 1))
          j=$((j + 1))
        done
        ;;
      '(') depth=$((depth + 1)) ;;
      ')')
        depth=$((depth - 1))
        if [ $depth -eq 0 ]; then MATCH_END=$j; return 0; fi
        ;;
    esac
    j=$((j + 1))
  done
  MATCH_END=$n
}

# MATCH_END : indice de l'accent grave qui ferme celui qui précède l'indice $2 de $1 (ou la longueur).
match_backtick() {
  local s=$1 j=$2 n=${#1}
  while [ $j -lt $n ]; do
    case ${s:$j:1} in
      \\) j=$((j + 1)) ;;
      '`') MATCH_END=$j; return 0 ;;
    esac
    j=$((j + 1))
  done
  MATCH_END=$n
}

scan_nested() {
  local rc
  [ $DEPTH -lt 5 ] || return 0
  DEPTH=$((DEPTH + 1))
  scan "$1"
  rc=$?
  DEPTH=$((DEPTH - 1))
  return $rc
}

# Ces deux-là travaillent sur les variables locales de scan (portée dynamique) : le mot en cours, et les mots de la commande en cours.
end_word() {
  if [ -n "$word" ] || [ $inword -eq 1 ]; then
    seg[$segn]=$word
    segn=$((segn + 1))
  fi
  word=""
  inword=0
}
end_seg() {
  local rc=0
  if [ $segn -gt 0 ]; then
    check_segment "${seg[@]}"
    rc=$?
  fi
  seg=()
  segn=0
  return $rc
}

# Découpe $1 en commandes simples et passe chacune à check_segment. Code 1 dès qu'une règle refuse (MSG et BAD disent laquelle).
scan() {
  local s=$1 n=${#1} i=0 c nx mode=n word="" inword=0 rest pre j k p line cmpl ch delim dash
  local -a seg hd hdd
  local segn=0 nhd=0
  seg=()
  hd=()
  hdd=()
  while [ $i -lt $n ]; do
    c=${s:$i:1}
    case $mode in
      s)
        # Entre apostrophes : tout est littéral jusqu'à la prochaine.
        rest=${s:$i}
        pre=${rest%%\'*}
        if [ ${#pre} -eq ${#rest} ]; then
          word="$word$rest"
          i=$n
          break
        fi
        word="$word$pre"
        i=$((i + ${#pre}))
        mode=n
        ;;
      d)
        case $c in
          '"') mode=n ;;
          \\)
            nx=${s:$((i + 1)):1}
            case $nx in
              '"' | '\' | '$' | '`') word="$word$nx" ;;
              $'\n' | '') ;;
              *) word="$word\\$nx" ;;
            esac
            i=$((i + 1))
            ;;
          '$')
            if [ "${s:$((i + 1)):1}" = '(' ]; then
              match_paren "$s" $((i + 1))
              scan_nested "${s:$((i + 2)):$((MATCH_END - i - 2))}" || return 1
              word="${word}X"
              i=$MATCH_END
            else
              word="$word$c"
            fi
            ;;
          '`')
            match_backtick "$s" $((i + 1))
            scan_nested "${s:$((i + 1)):$((MATCH_END - i - 1))}" || return 1
            word="${word}X"
            i=$MATCH_END
            ;;
          *) word="$word$c" ;;
        esac
        ;;
      n)
        case $c in
          ' ' | $'\t') end_word ;;
          $'\n')
            end_word
            end_seg || return 1
            # Corps de heredoc : on saute jusqu'à la ligne qui porte le délimiteur, pour chaque << en attente.
            if [ $nhd -gt 0 ]; then
              p=$((i + 1))
              k=0
              while [ $k -lt $nhd ] && [ $p -lt $n ]; do
                while [ $p -lt $n ]; do
                  rest=${s:$p}
                  line=${rest%%$'\n'*}
                  p=$((p + ${#line} + 1))
                  cmpl=$line
                  if [ "${hdd[$k]}" = 1 ]; then
                    while [ "${cmpl#$'\t'}" != "$cmpl" ]; do cmpl=${cmpl#$'\t'}; done
                  fi
                  [ "$cmpl" = "${hd[$k]}" ] && break
                done
                k=$((k + 1))
              done
              nhd=0
              i=$((p - 1))
            fi
            ;;
          ';' | '&' | '|' | '(' | ')')
            end_word
            end_seg || return 1
            ;;
          "'") mode=s; inword=1 ;;
          '"') mode=d; inword=1 ;;
          \\)
            nx=${s:$((i + 1)):1}
            if [ "$nx" != $'\n' ]; then
              word="$word$nx"
              inword=1
            fi
            i=$((i + 1))
            ;;
          '`')
            match_backtick "$s" $((i + 1))
            scan_nested "${s:$((i + 1)):$((MATCH_END - i - 1))}" || return 1
            word="${word}X"
            inword=1
            i=$MATCH_END
            ;;
          '$')
            if [ "${s:$((i + 1)):1}" = '(' ]; then
              match_paren "$s" $((i + 1))
              scan_nested "${s:$((i + 2)):$((MATCH_END - i - 2))}" || return 1
              word="${word}X"
              inword=1
              i=$MATCH_END
            else
              word="$word$c"
            fi
            ;;
          '#')
            if [ -z "$word" ] && [ $inword -eq 0 ]; then
              rest=${s:$i}
              pre=${rest%%$'\n'*}
              i=$((i + ${#pre} - 1))
            else
              word="$word$c"
            fi
            ;;
          '<')
            if [ "${s:$((i + 1)):1}" = '<' ] && [ "${s:$((i + 2)):1}" != '<' ]; then
              # << ou <<- : on retient le délimiteur (guillemets ôtés), dont le corps est sauté au prochain retour à la ligne.
              j=$((i + 2))
              dash=0
              if [ "${s:$j:1}" = '-' ]; then dash=1; j=$((j + 1)); fi
              while [ "${s:$j:1}" = ' ' ] || [ "${s:$j:1}" = $'\t' ]; do j=$((j + 1)); done
              delim=""
              while [ $j -lt $n ]; do
                ch=${s:$j:1}
                case $ch in
                  ' ' | $'\t' | $'\n' | ';' | '&' | '|' | '(' | ')' | '<' | '>') break ;;
                  "'")
                    j=$((j + 1))
                    while [ $j -lt $n ] && [ "${s:$j:1}" != "'" ]; do delim="$delim${s:$j:1}"; j=$((j + 1)); done
                    ;;
                  '"')
                    j=$((j + 1))
                    while [ $j -lt $n ] && [ "${s:$j:1}" != '"' ]; do delim="$delim${s:$j:1}"; j=$((j + 1)); done
                    ;;
                  \\)
                    j=$((j + 1))
                    delim="$delim${s:$j:1}"
                    ;;
                  *) delim="$delim$ch" ;;
                esac
                j=$((j + 1))
              done
              hd[$nhd]=$delim
              hdd[$nhd]=$dash
              nhd=$((nhd + 1))
              end_word
              i=$((j - 1))
            else
              word="$word$c"
            fi
            ;;
          *) word="$word$c" ;;
        esac
        ;;
    esac
    i=$((i + 1))
  done
  end_word
  end_seg
}

if scan "$cmd"; then
  exit 0
fi

# ---- 3. Refus : exit 2 et le message sur stderr ----
case $MSG in
  find)
    {
      echo "BLOQUÉ (guard-bash) : « find » avec la racine « $BAD » parcourt tout le disque ou tout le répertoire personnel."
      echo "Une recherche de ce genre est restée bloquée 2 heures."
      echo "À faire plutôt : cherchez depuis le dossier du projet ou du bac à sable (find . -name …, grep -r motif src, git ls-files | grep …),"
      echo "ou nommez le sous-dossier précis (find \"\$S/tree/src\" -name …)."
    } >&2
    ;;
  pkill)
    {
      echo "BLOQUÉ (guard-bash) : « $BAD » vise un motif, pas un processus : il peut abattre le serveur d'un autre agent ou de l'orchestrateur."
      echo "À faire plutôt : tue par PID noté. Relevez le PID au lancement (cmd & echo \$! > \"\$S/pid\"), puis kill \"\$(cat \"\$S/pid\")\"."
    } >&2
    ;;
  rm)
    {
      echo "BLOQUÉ (guard-bash) : « rm -r » sur « $BAD » efface le disque ou tout le répertoire personnel."
      echo "À faire plutôt : supprimez un dossier précis, sous un chemin que vous avez créé (rm -rf \"\$S/tree\"), jamais la racine ni le home."
    } >&2
    ;;
  *)
    echo "BLOQUÉ (guard-bash) : commande refusée." >&2
    ;;
esac
exit 2
