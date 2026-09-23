#!/usr/bin/env bash
#
# Gate 4 real IndexCore E2E for the Reference Web.
#
# Reproduces every Phase C scenario end to end:
#   real rclone source -> IndexCore scan -> PostgreSQL canonical -> IndexCore /v1
#   -> Reference Web server-side client -> rendered browser page.
#
# The consumer repository stays free of Go / PostgreSQL / canonical-mutation
# coupling: the controlled COMPLETE snapshots needed for Q7 (removed) and Q5
# (path ambiguity) are seeded by a verification fixture that lives in
# index-core (internal/runtime/e2e) and that uses only the accepted safe
# ingress (CreateDraftSnapshot -> SubmitAndAdmitSnapshot -> ProcessHead).
#
# Prerequisites and full instructions: docs/E2E-RUNBOOK.md
#
# Required env:
#   INDEXCORE_SRC   path to an index-core checkout that contains the Gate 4
#                   verification fixture (see docs/E2E-RUNBOOK.md)
# Optional env:
#   INDEXCORE_BASE_URL   default http://127.0.0.1:8080
#   INDEXCORE_CONTAINER  default index-core-indexcore-1 (the `indexcore serve` container)
#   WEB_PORT             default 3100
#   GO_IMAGE             default golang:1.27-alpine
#   E2E_PG_DSN           override the fixture DB DSN (default: container env)
#
set -euo pipefail

BASE_URL="${INDEXCORE_BASE_URL:-http://127.0.0.1:8080}"
CONTAINER="${INDEXCORE_CONTAINER:-index-core-indexcore-1}"
INDEXCORE_SRC="${INDEXCORE_SRC:-}"
WEB_PORT="${WEB_PORT:-3100}"
WEB_URL="http://127.0.0.1:${WEB_PORT}"
GO_IMAGE="${GO_IMAGE:-golang:1.27-alpine}"
PG_DSN_OVERRIDE="${E2E_PG_DSN:-}"
FIXTURE_TEST="internal/runtime/e2e/gate4_reference_consumer_fixture_test.go"

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_DIR="$(cd "${SCRIPT_DIR}/.." && pwd)"

PASS=0
FAIL=0
WEB_PID=""
RESTORE_CONTAINER=0

say() { printf '\n== %s\n' "$*"; }
ok()  { printf '  PASS  %s\n' "$*"; PASS=$((PASS + 1)); }
bad() { printf '  FAIL  %s\n' "$*"; FAIL=$((FAIL + 1)); }
die() {
  printf '\nE2E ABORTED: %s\n' "$*" >&2
  exit 1
}
cleanup() {
  if [ -n "$WEB_PID" ] && kill -0 "$WEB_PID" 2>/dev/null; then
    kill "$WEB_PID" 2>/dev/null || true
    wait "$WEB_PID" 2>/dev/null || true
  fi
  if [ "$RESTORE_CONTAINER" = "1" ]; then
    docker start "$CONTAINER" >/dev/null 2>&1 || true
  fi
}
trap cleanup EXIT

require_cmd() { command -v "$1" >/dev/null 2>&1 || die "missing required command: $1"; }
curl_body() { curl -fsS -m 20 "$1"; }
unescape_amp() { printf '%s' "$1" | sed 's/&amp;/\&/g'; }

expect_contains() {
  local url="$1" needle="$2" label="$3" body
  if ! body="$(curl_body "$url")"; then
    bad "$label (request failed: $url)"
    return
  fi
  if printf '%s' "$body" | grep -qF -- "$needle"; then ok "$label"; else bad "$label (missing: $needle)"; fi
}

expect_absent() {
  local url="$1" needle="$2" label="$3" body
  if ! body="$(curl_body "$url")"; then
    bad "$label (request failed: $url)"
    return
  fi
  if printf '%s' "$body" | grep -qF -- "$needle"; then bad "$label (unexpected: $needle)"; else ok "$label"; fi
}

# expect_body_contains <body> <needle> <label>
expect_body_contains() {
  local body="$1" needle="$2" label="$3"
  if printf '%s' "$body" | grep -qF -- "$needle"; then ok "$label"; else bad "$label (missing: $needle)"; fi
}

new_uuid() {
  if [ -r /proc/sys/kernel/random/uuid ]; then
    cat /proc/sys/kernel/random/uuid
  else
    docker exec "$CONTAINER" cat /proc/sys/kernel/random/uuid
  fi
}

wait_ready() {
  local url="$1" tries="${2:-30}" i
  for i in $(seq 1 "$tries"); do
    if curl -fsS -m 3 "$url" >/dev/null 2>&1; then return 0; fi
    sleep 1
  done
  return 1
}

require_cmd docker
require_cmd curl
require_cmd npm
require_cmd tar

[ -n "$INDEXCORE_SRC" ] || die "INDEXCORE_SRC must point to an index-core checkout (see docs/E2E-RUNBOOK.md)"
[ -f "$INDEXCORE_SRC/$FIXTURE_TEST" ] || die "INDEXCORE_SRC does not contain the Gate 4 verification fixture ($FIXTURE_TEST)"

# ---------------------------------------------------------------------------
say "Preflight"
# ---------------------------------------------------------------------------
docker inspect "$CONTAINER" >/dev/null 2>&1 || die "container not found: $CONTAINER"
curl -fsS -m 5 "$BASE_URL/readyz" >/dev/null || die "IndexCore is not ready at $BASE_URL"
ok "IndexCore reachable at $BASE_URL"
BASE_HOSTPORT="$(printf '%s' "$BASE_URL" | sed -E 's#^https?://##; s#/.*$##')"

GOMODCACHE_DIR="${GOMODCACHE:-$HOME/go/pkg/mod}"
GOMODCACHE_MOUNT=()
if [ -d "$GOMODCACHE_DIR" ]; then
  GOMODCACHE_MOUNT=(-v "${GOMODCACHE_DIR}:/go/pkg/mod")
fi

# ---------------------------------------------------------------------------
say "Build and start the Reference Web on ${WEB_URL}"
# ---------------------------------------------------------------------------
( cd "$REPO_DIR" && npm run build >/dev/null ) || die "next build failed"
ok "next build"
( cd "$REPO_DIR" && INDEXCORE_BASE_URL="$BASE_URL" PORT="$WEB_PORT" \
    exec ./node_modules/.bin/next start -p "$WEB_PORT" >/tmp/gate4-reference-web.log 2>&1 ) &
WEB_PID=$!
wait_ready "$WEB_URL/" 40 || die "Reference Web did not start (see /tmp/gate4-reference-web.log)"
ok "Reference Web is serving"

# ---------------------------------------------------------------------------
say "Prepare real rclone sources and roots"
# ---------------------------------------------------------------------------
ROOT_A="$(new_uuid)"
ROOT_B="$(new_uuid)"
ROOT_C="$(new_uuid)"
ROOT_D="$(new_uuid)"
ROOT_E="$(new_uuid)"

docker exec -u root "$CONTAINER" sh -c '
rm -rf /e2e
mkdir -p /e2e/rootA/docs/deep /e2e/rootA/media /e2e/rootB/sub
mkdir -p /e2e/rootD/sub /e2e/rootE/esub
printf "top level file\n" > /e2e/rootA/top.txt
printf "report body\n" > /e2e/rootA/docs/report.txt
printf "notes body\n" > /e2e/rootA/docs/notes.txt
printf "deep nested\n" > /e2e/rootA/docs/deep/nested.txt
head -c 2048 /dev/zero > /e2e/rootA/media/movie.bin
printf "b only\n" > /e2e/rootB/only-b.txt
printf "b sub\n" > /e2e/rootB/sub/bsub.txt
printf "deprecated doc\n" > /e2e/rootD/d-doc.txt
printf "deprecated deep\n" > /e2e/rootD/sub/deep.txt
printf "deleted doc\n" > /e2e/rootE/e-doc.txt
printf "deleted deep\n" > /e2e/rootE/esub/edeep.txt
'

docker exec "$CONTAINER" sh -c "
set -e
indexcore root create --root-id $ROOT_A --lifecycle ACTIVE
indexcore root create --root-id $ROOT_D --lifecycle ACTIVE
indexcore root create --root-id $ROOT_E --lifecycle ACTIVE
indexcore root config set --root-id $ROOT_A --grace 1h --move-horizon 1h --min-consecutive 1 --min-independent 1
indexcore root config set --root-id $ROOT_D --grace 1h --move-horizon 1h --min-consecutive 1 --min-independent 1
indexcore root config set --root-id $ROOT_E --grace 1h --move-horizon 1h --min-consecutive 1 --min-independent 1
indexcore root adapter set --root-id $ROOT_A --collector rclone --config '{\"remote\":\"\",\"path\":\"/e2e/rootA\"}'
indexcore root adapter set --root-id $ROOT_D --collector rclone --config '{\"remote\":\"\",\"path\":\"/e2e/rootD\"}'
indexcore root adapter set --root-id $ROOT_E --collector rclone --config '{\"remote\":\"\",\"path\":\"/e2e/rootE\"}'
indexcore scan --root $ROOT_A
indexcore scan --root $ROOT_D
indexcore scan --root $ROOT_E
indexcore root deprecate --root-id $ROOT_D
indexcore root delete --root-id $ROOT_E
" >/dev/null
ok "roots created; A/D/E scanned through the real rclone path; D deprecated and E deleted"

# ---------------------------------------------------------------------------
say "Seed controlled COMPLETE snapshots via the index-core verification fixture"
# ---------------------------------------------------------------------------
if [ -n "$PG_DSN_OVERRIDE" ]; then
  DSN="$PG_DSN_OVERRIDE"
else
  DSN="$(docker exec "$CONTAINER" printenv INDEXCORE_DATABASE_URL)"
fi
[ -n "$DSN" ] || die "could not determine the IndexCore database DSN"
NET="$(docker inspect -f '{{range $k,$v := .NetworkSettings.Networks}}{{$k}}{{"\n"}}{{end}}' "$CONTAINER" | head -1)"
[ -n "$NET" ] || die "could not determine the IndexCore container network"

# Copy the index-core checkout so the fixture build never writes to it.
TMP_SRC="$(mktemp -d)"
tar -C "$INDEXCORE_SRC" --exclude=.git -cf - . | tar -x -C "$TMP_SRC"

RESTORE_CONTAINER=1
docker stop "$CONTAINER" >/dev/null
docker run --rm --network "$NET" \
  -v "$TMP_SRC:/src" \
  ${GOMODCACHE_MOUNT[@]+"${GOMODCACHE_MOUNT[@]}"} \
  -e GOPATH=/go -e GOFLAGS=-mod=mod \
  -e INDEXCORE_GATE4_FIXTURE=1 -e INDEXCORE_DATABASE_URL="$DSN" \
  -e E2E_ROOT_B="$ROOT_B" -e E2E_ROOT_C="$ROOT_C" \
  -w /src "$GO_IMAGE" \
  sh -c "go test ./internal/runtime/e2e -run TestGate4ReferenceConsumerFixture -count=1"
docker start "$CONTAINER" >/dev/null
RESTORE_CONTAINER=0
rm -rf "$TMP_SRC"
wait_ready "$BASE_URL/readyz" 30 || die "IndexCore did not come back after seeding"
ok "controlled COMPLETE fixtures seeded (removal + ambiguity)"

# ---------------------------------------------------------------------------
say "Assert rendered pages against the real IndexCore"
# ---------------------------------------------------------------------------
expect_absent   "$WEB_URL/" "$BASE_HOSTPORT" "home page never leaks the IndexCore internal address"
expect_contains "$WEB_URL/" "Runtime status" "home page renders"
expect_contains "$WEB_URL/roots" "$ROOT_A" "Q2 /roots lists root A"

expect_contains "$WEB_URL/roots/$ROOT_A" "Hierarchy (Q4 list_resources)" "Q4 hierarchy view"
expect_contains "$WEB_URL/roots/$ROOT_A" "top.txt" "Q4 shows a root-level resource"
expect_absent   "$WEB_URL/roots/$ROOT_A" "nested.txt" "Q4 root level is not flattened"

expect_contains "$WEB_URL/roots/$ROOT_A?view=active" "Active resources (Q6 list_active_resources)" "Q6 active view is rendered"
expect_contains "$WEB_URL/roots/$ROOT_A?view=active" "nested.txt" "Q6 lists whole-root resources (nested included)"

DOCS_ID="$(curl_body "$BASE_URL/v1/roots/$ROOT_A/resolve?path=/docs" | grep -oE '"resource_id":"[^"]+"' | head -1 | cut -d'"' -f4 || true)"
[ -n "$DOCS_ID" ] || die "could not resolve /docs via Q5"
DEEP_ID="$(curl_body "$BASE_URL/v1/roots/$ROOT_A/resolve?path=/docs/deep" | grep -oE '"resource_id":"[^"]+"' | head -1 | cut -d'"' -f4 || true)"
[ -n "$DEEP_ID" ] || die "could not resolve /docs/deep via Q5"
expect_contains "$WEB_URL/resources/$DOCS_ID" "canonical path" "Q3 resource detail"
expect_contains "$WEB_URL/resources/$DOCS_ID" "/docs" "Q3 canonical path is shown"
expect_contains "$WEB_URL/roots/$ROOT_A?parent=$DOCS_ID" "report.txt" "Q4 children via parent"
expect_contains "$WEB_URL/roots/$ROOT_A?parent=$DEEP_ID" "nested.txt" "Q4 multi-level nesting via parent"

expect_contains "$WEB_URL/resolve?root=$ROOT_C&path=/amb.txt" "Ambiguous path" "Q5 ambiguity is surfaced (not guessed)"
expect_contains "$WEB_URL/removed?root=$ROOT_B" "removal-target.txt" "Q7 removed resource is listed"
expect_contains "$WEB_URL/removed?root=$ROOT_B" "REMOVED" "Q7 presence is REMOVED"
expect_contains "$WEB_URL/journal?root=$ROOT_B" "resource-removed" "Q8 journal shows the removal event"

# Journal pagination must not skip the event after the page boundary.
J_LIMIT=3
J_PAGE="$(curl_body "$WEB_URL/journal?root=$ROOT_A&limit=$J_LIMIT")"
NEXT_AFTER="$(printf '%s' "$J_PAGE" | grep -oE 'after_seq=[0-9]+' | head -1 | cut -d= -f2 || true)"
LAST_SEQ="$(curl_body "$BASE_URL/v1/roots/$ROOT_A/journal?limit=$J_LIMIT" | grep -oE '"event_seq":[0-9]+' | tail -1 | cut -d: -f2 || true)"
[ -n "$NEXT_AFTER" ] || die "journal page did not expose a next link"
if [ "$NEXT_AFTER" = "$LAST_SEQ" ]; then
  ok "Q8 journal pagination uses the last event_seq (no skipped event)"
else
  bad "Q8 journal pagination off-by-one (after_seq=$NEXT_AFTER, last_seq=$LAST_SEQ)"
fi

# Removed resources: the link from /removed must keep include_removed=true.
REMOVED_PAGE="$(curl_body "$WEB_URL/removed?root=$ROOT_B")"
R_RES="$(printf '%s' "$REMOVED_PAGE" | grep -oE '/resources/[0-9a-fA-F-]+\?include_removed=1' | head -1 || true)"
if [ -n "$R_RES" ]; then
  expect_contains "$WEB_URL$R_RES" "canonical path" "removed resource detail reachable with include_removed"
else
  bad "removed resource link does not preserve include_removed=true"
fi

# Stale cursor: page 2 is valid on the current generation, then must be refused.
P1="$(curl_body "$WEB_URL/roots/$ROOT_A?limit=1")"
CURSOR="$(printf '%s' "$P1" | grep -oE 'cursor=[A-Za-z0-9_-]+' | head -1 | cut -d= -f2 || true)"
[ -n "$CURSOR" ] || die "hierarchy page 1 did not expose a cursor"
P2_URL="$WEB_URL/roots/$ROOT_A?limit=1&cursor=$CURSOR"
expect_absent "$P2_URL" "Data changed while paging" "stale cursor: page 2 is valid before the generation advances"

docker exec -u root "$CONTAINER" sh -c 'printf "changed after page1\n" > /e2e/rootA/late.txt'
docker exec "$CONTAINER" indexcore scan --root "$ROOT_A" >/dev/null
expect_contains "$P2_URL" "Data changed while paging" "stale cursor is surfaced after the generation advances"

# ---------------------------------------------------------------------------
say "Assert deprecated/deleted retained-partition navigation"
# ---------------------------------------------------------------------------
expect_absent   "$WEB_URL/roots" "$ROOT_D" "default root list hides the deprecated root"
expect_absent   "$WEB_URL/roots" "$ROOT_E" "default root list hides the deleted root"
ROOTS_ALL="$(curl_body "$WEB_URL/roots?include_deprecated=1&include_deleted=1")"
expect_body_contains "$ROOTS_ALL" "$ROOT_D" "root list shows the deprecated root when requested"
expect_body_contains "$ROOTS_ALL" "$ROOT_E" "root list shows the deleted root when requested"

D_LINK="$(printf '%s' "$ROOTS_ALL" | grep -oE "/roots/$ROOT_D\?[^\"']*" | head -1 || true)"
[ -n "$D_LINK" ] || die "deprecated root link missing from /roots"
D_DETAIL="$(curl_body "$WEB_URL$(unescape_amp "$D_LINK")")"
expect_body_contains "$D_DETAIL" "d-doc.txt" "deprecated root detail lists its resources"
D_DIR_LINK="$(printf '%s' "$D_DETAIL" | grep -oE "/roots/$ROOT_D\?[^\"']*parent=[0-9a-fA-F-]+" | head -1 || true)"
[ -n "$D_DIR_LINK" ] || die "deprecated root directory link missing"
D_NESTED="$(curl_body "$WEB_URL$(unescape_amp "$D_DIR_LINK")")"
expect_body_contains "$D_NESTED" "deep.txt" "deprecated root nested directory keeps visibility"
if printf '%s' "$D_NESTED" | grep -qF "href=\"/roots/$ROOT_D?include_deprecated_root=1"; then
  ok "deprecated root breadcrumb keeps visibility"
else
  bad "deprecated root breadcrumb dropped include_deprecated_root"
fi
D_RES_LINK="$(printf '%s' "$D_DETAIL" | grep -oE "/resources/[0-9a-fA-F-]+\?[^\"']*" | head -1 || true)"
[ -n "$D_RES_LINK" ] || die "deprecated root resource link missing"
if printf '%s' "$D_RES_LINK" | grep -qF "include_deprecated_root=1"; then
  ok "deprecated root resource link keeps visibility"
else
  bad "deprecated root resource link dropped include_deprecated_root"
fi
expect_contains "$WEB_URL$(unescape_amp "$D_RES_LINK")" "/d-doc.txt" "deprecated root resource detail keeps visibility"

E_LINK="$(printf '%s' "$ROOTS_ALL" | grep -oE "/roots/$ROOT_E\?[^\"']*" | head -1 || true)"
[ -n "$E_LINK" ] || die "deleted root link missing from /roots"
E_DETAIL="$(curl_body "$WEB_URL$(unescape_amp "$E_LINK")")"
expect_body_contains "$E_DETAIL" "e-doc.txt" "deleted root detail lists its resources"
E_RES_LINK="$(printf '%s' "$E_DETAIL" | grep -oE "/resources/[0-9a-fA-F-]+\?[^\"']*" | head -1 || true)"
[ -n "$E_RES_LINK" ] || die "deleted root resource link missing"
if printf '%s' "$E_RES_LINK" | grep -qF "include_deleted_root=1"; then
  ok "deleted root resource link keeps visibility"
else
  bad "deleted root resource link dropped include_deleted_root"
fi
expect_contains "$WEB_URL$(unescape_amp "$E_RES_LINK")" "/e-doc.txt" "deleted root resource detail keeps visibility"

# ---------------------------------------------------------------------------
say "Assert IndexCore unavailable and independent restart"
# ---------------------------------------------------------------------------
docker stop "$CONTAINER" >/dev/null
expect_contains "$WEB_URL/" "IndexCore is not fully available" "home page shows a degraded state when IndexCore is down"
expect_absent   "$WEB_URL/" "$BASE_HOSTPORT" "degraded home page does not leak the internal address"
expect_contains "$WEB_URL/roots" "IndexCore is unreachable" "root list reports unreachable"
CODE="$(curl -s -o /dev/null -w '%{http_code}' -m 10 "$WEB_URL/roots")"
if [ "$CODE" = "200" ]; then ok "Reference Web still serves (HTTP 200) while IndexCore is down"; else bad "Reference Web returned HTTP $CODE while IndexCore was down"; fi

docker start "$CONTAINER" >/dev/null
wait_ready "$BASE_URL/readyz" 30 || die "IndexCore did not restart"
expect_contains "$WEB_URL/" "$ROOT_A" "home page recovers after an independent IndexCore restart"

# ---------------------------------------------------------------------------
say "Summary"
# ---------------------------------------------------------------------------
printf 'PASS=%d FAIL=%d\n' "$PASS" "$FAIL"
if [ "$FAIL" -ne 0 ]; then
  exit 1
fi
echo "E2E: PASS"
