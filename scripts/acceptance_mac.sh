#!/usr/bin/env bash
# Does this Looker API key do only what it was issued to do?
#
# The same test as scripts/acceptance.py, for a machine with no Python. curl and bash only, both
# of which a Mac has out of the box.
#
#   curl -sO <this file>
#   bash acceptance_mac.sh --host https://example.cloud.looker.com --look 123
#
# It asks for the client ID and secret without echoing them (or reads LOOKER_CLIENT_ID and
# LOOKER_CLIENT_SECRET). Three things must hold:
#
#   run_look     the Look in the public folder runs.                          200 with rows
#   own query    a query the key builds itself, from that Look's own fields,
#                is refused. Needs explore, which the key must not have.      403
#   SQL Runner   the key cannot create a SQL Runner query. Never run.         403
#
# Nothing printed is data: status codes, row counts and counts of things. Never a field value,
# never a response body, never the key. Bodies go to a temp directory that is deleted on exit.
#
# Exit: 0 PASS, 1 FAIL, 2 INCONCLUSIVE, 3 could not run. The same codes as acceptance.py, and
# scripts/check-acceptance.mjs runs both against the same mock keys so they cannot disagree.

set -u

HOST=""
LOOK=""
CLIENT_FIELD=""
while [ $# -gt 0 ]; do
  case "$1" in
    --host) HOST="${2:-}"; shift 2 || exit 3 ;;
    --look) LOOK="${2:-}"; shift 2 || exit 3 ;;
    --client-field) CLIENT_FIELD="${2:-}"; shift 2 || exit 3 ;;
    *) echo "unknown option $1. Expected --host and --look."; exit 3 ;;
  esac
done
[ -n "$HOST" ] && [ -n "$LOOK" ] || { echo "usage: bash acceptance_mac.sh --host https://x.cloud.looker.com --look 123"; exit 3; }

# https only, except a loopback address, which is where the mock runs for rehearsal. The host is
# taken apart rather than matched with a glob: http://localhost* also matches
# http://localhost.attacker.example, and the key would have gone there in clear.
case "$HOST" in *://*) ;; *) HOST="https://$HOST" ;; esac
SCHEME="${HOST%%://*}"
REST="${HOST#*://}"
HOSTNAME_ONLY="${REST%%/*}"
# A bracketed IPv6 literal keeps its brackets; only a trailing :port comes off. Stripping from
# the first colon turned [::1] into [.
case "$HOSTNAME_ONLY" in
  \[*\]*) HOSTNAME_ONLY="${HOSTNAME_ONLY%%]*}]" ;;
  *) HOSTNAME_ONLY="${HOSTNAME_ONLY%%:*}" ;;
esac
case "$SCHEME" in
  https) ;;
  http)
    case "$HOSTNAME_ONLY" in
      localhost|127.0.0.1|'[::1]'|'::1') ;;
      *) echo "refusing http:// to $HOSTNAME_ONLY: the key would cross the network in clear"; exit 3 ;;
    esac ;;
  *) echo "refusing $SCHEME://: the key would cross the network in clear"; exit 3 ;;
esac
HOST="${HOST%/}"
HOST="${HOST%/api/4.0}"

CID="${LOOKER_CLIENT_ID:-}"
SEC="${LOOKER_CLIENT_SECRET:-}"
[ -n "$CID" ] || read -r -p "Client ID: " CID
[ -n "$SEC" ] || { read -r -s -p "Client secret: " SEC; echo; }

# 0700, and everything sensitive lives in here rather than on a command line: /proc/<pid>/cmdline
# is readable by anyone on the machine, and endpoint software commonly logs what it sees there.
# curl reads the credentials out of files and the token out of a config file.
TMP=$(mktemp -d)
# Not silent: a verdict of PASS while the token is still on disk would be a false one.
cleanup() {
  rm -rf "$TMP"
  if [ -d "$TMP" ]; then
    echo
    echo "COULD NOT CLEAN UP  $TMP still holds the login token. Delete it yourself."
    exit 3
  fi
}
trap cleanup EXIT

# No -L anywhere: curl does not follow redirects unless asked, and the token must not be carried
# to a host nobody configured.
api() { # method path outfile [extra curl args...]
  local method="$1" path="$2" out="$3"; shift 3
  curl -q -s -S -m 30 -o "$TMP/$out" -w "%{http_code}" -X "$method" \
    -K "$TMP/curlrc" "$HOST/api/4.0$path" "$@" 2>/dev/null
}

printf '\nLooker acceptance test   %s   Look %s\n\n' "$HOST" "$LOOK"

printf '%s' "$CID" > "$TMP/cid"
printf '%s' "$SEC" > "$TMP/sec"
code=$(curl -q -s -S -m 30 -o "$TMP/login.json" -w "%{http_code}" -X POST "$HOST/api/4.0/login" \
  --data-urlencode "client_id@$TMP/cid" --data-urlencode "client_secret@$TMP/sec" 2>/dev/null)
rm -f "$TMP/cid" "$TMP/sec"
TOKEN=$(tr ',' '\n' < "$TMP/login.json" 2>/dev/null | grep access_token | cut -d'"' -f4)
printf 'header = "Authorization: token %s"\n' "$TOKEN" > "$TMP/curlrc"
if [ "$code" != "200" ] || [ -z "$TOKEN" ]; then
  echo "  login     $code. Check the client ID and secret, and the host."
  exit 3
fi

FAILED=0
UNKNOWN=0
RAN=""

line() { # label outcome detail
  case "$2" in
    ok) mark="ok  " ;;
    FAIL) mark="FAIL"; FAILED=1; RAN="$RAN $1," ;;
    *) mark="??  "; UNKNOWN=1 ;;
  esac
  printf '  %s  %-12s  %s\n' "$mark" "$1" "$3"
}

rows_in() { # an array of flat row objects; [] is none
  local n
  if [ "$(tr -d ' \n' < "$1")" = "[]" ]; then n=0; else
    n=$(( $(grep -o '},{' "$1" | wc -l | tr -d ' ') + 1 ))
  fi
  if [ "$n" = "1" ]; then echo "1 row"; else echo "$n rows"; fi
}

# What a refusal came back as, for something the key must not be able to do.
classify() { # status file -> sets OUTCOME and DETAIL
  local code="$1" file="$2" first
  first=$(head -c1 "$file" 2>/dev/null)
  if [ "$code" = "403" ]; then OUTCOME=ok; DETAIL="403 refused"
  elif [ "$code" = "200" ] && [ "$first" = "[" ]; then
    OUTCOME=FAIL; DETAIL="200, ran and returned $(rows_in "$file")"
  elif [ "$code" = "200" ] && grep -q '"slug"' "$file" 2>/dev/null; then
    OUTCOME=FAIL; DETAIL="200, created (not run)"
  elif [ "$code" = "200" ]; then OUTCOME=??; DETAIL="200 with an error object, not a refusal"
  elif [ "$code" -ge 300 ] && [ "$code" -lt 400 ] 2>/dev/null; then
    OUTCOME=??; DETAIL="$code redirect, not followed"
  else OUTCOME=??; DETAIL="$code, not the 403 a missing permission gives"
  fi
}

# The Look's own model, explore and fields: what the probe is built from, and its folder.
code=$(api GET "/looks/$LOOK?fields=id,folder_id,query" look.json)
MODEL=""; VIEW=""; FOLDER=""
if [ "$code" = "200" ]; then
  # Split on braces as well as commas. "model" and "view" live inside "query":{...}, so a
  # comma-only split leaves `"query":{"model":"clarity"` and the fourth quoted field is the word
  # model, not clarity - which sent both probes at a model no instance has.
  FIELD_LINES=$(tr ',{}' '\n\n\n' < "$TMP/look.json")
  MODEL=$(echo "$FIELD_LINES" | grep '"model"' | head -1 | cut -d'"' -f4)
  VIEW=$(echo "$FIELD_LINES" | grep '"view"' | head -1 | cut -d'"' -f4)
  FOLDER=$(echo "$FIELD_LINES" | grep '"folder_id"' | head -1 | cut -d'"' -f4)
fi

code=$(api GET "/looks/$LOOK/run/json?apply_formatting=false&limit=500" rows.json)
first=$(head -c1 "$TMP/rows.json" 2>/dev/null)
if [ "$code" = "200" ] && [ "$first" = "[" ]; then
  line run_look ok "200, $(rows_in "$TMP/rows.json")"
elif [ "$code" = "200" ]; then
  line run_look '??' "200 with an error object: the Look did not run"
else
  line run_look '??' "$code: the key cannot run Look $LOOK"
fi

# The Look's own fields, as they came back, so the probe asks for nothing it could not see.
LOOK_FIELDS=$(tr '\n' ' ' < "$TMP/look.json" 2>/dev/null | sed -n 's/.*"fields":\[\([^]]*\)\].*/\1/p')
if [ -z "$MODEL" ] || [ -z "$VIEW" ] || [ -z "$LOOK_FIELDS" ]; then
  line "own query" '??' "could not read the Look's query to build the probe"
  line "SQL Runner" '??' "no model to probe with"
else
  if [ -n "$CLIENT_FIELD" ]; then FIELDS="\"$CLIENT_FIELD\""; else FIELDS="$LOOK_FIELDS"; fi
  code=$(api POST "/queries/run/json" probe.json -H "Content-Type: application/json" \
    -d "{\"model\":\"$MODEL\",\"view\":\"$VIEW\",\"fields\":[$FIELDS],\"limit\":\"1\"}")
  classify "$code" "$TMP/probe.json"; line "own query" "$OUTCOME" "$DETAIL"

  code=$(api POST "/sql_queries" sql.json -H "Content-Type: application/json" \
    -d "{\"model_name\":\"$MODEL\",\"sql\":\"SELECT 1\"}")
  classify "$code" "$TMP/sql.json"; line "SQL Runner" "$OUTCOME" "$DETAIL"
fi

# Where the account differs from the spec. Reported, not judged: the checks above are what
# decide. Read with grep rather than a JSON parser, so these are counts and nothing more.
code=$(api GET "/user?fields=id,group_ids,credentials_api3" user.json)
if [ "$code" = "200" ]; then
  groups=$(sed -n 's/.*"group_ids":[[:space:]]*\[\([^]]*\)\].*/\1/p' "$TMP/user.json")
  if [ -n "$groups" ]; then
    echo "  note  the API user is in $(( $(echo "$groups" | tr -cd ',' | wc -c | tr -d ' ') + 1 )) group(s); the spec said none"
  fi
  keys=$(grep -o '"is_disabled":[[:space:]]*false' "$TMP/user.json" | wc -l | tr -d ' ')
  [ "$keys" -gt 1 ] && echo "  note  the API user holds $keys active API keys; the spec said one"
else
  echo "  note  could not read the API user ($code)"
fi

code=$(api GET "/looks?fields=id,folder_id" looks.json)
if [ "$code" = "200" ]; then
  # The same sentences as acceptance.py, word for word. Whoever runs this is told to send back
  # any note line, so two copies phrasing the same finding differently is a question nobody
  # should have to answer twice.
  all_folders=$(grep -o '"folder_id":"[^"]*"' "$TMP/looks.json" | cut -d'"' -f4)
  count=$(echo "$all_folders" | grep -c .)
  if [ -z "$FOLDER" ]; then
    distinct=$(echo "$all_folders" | sort -u | grep -c .)
    echo "  note  $count Looks visible across $distinct folder(s)"
  else
    where=$(echo "$all_folders" | grep -vx "$FOLDER" | sort | uniq -c | awk '{printf "%sfolder %s: %s", (NR>1 ? ", " : ""), $2, $1}')
    [ -n "$where" ] && echo "  note  Looks visible outside folder $FOLDER ($where)"
  fi
else
  echo "  note  could not list visible Looks ($code)"
fi

code=$(curl -q -s -S -m 30 -o /dev/null -w "%{http_code}" -X DELETE -K "$TMP/curlrc" "$HOST/api/4.0/logout" 2>/dev/null)
case "$code" in
  200|204) ;;
  *) echo "  note  logout returned $code: this session's token stays valid until it expires" ;;
esac

echo
if [ "$FAILED" = "1" ]; then
  echo "FAIL  Do not store this key. It can do more than it was issued for."
  echo "      Ran when it should have been refused:${RAN%,}."
  echo "      For Bitfocus: the role should carry access_data and see_looks only —"
  echo "      no explore, no use_sql_runner, no group inheritance."
  exit 1
fi
if [ "$UNKNOWN" = "1" ]; then
  echo "INCONCLUSIVE  Nothing ran that should not have, but the test did not prove the"
  echo "      key is scoped. Do not store it yet. The ?? lines say what came back."
  exit 2
fi
echo "PASS  The key runs its Look and is refused everything else."
exit 0
